import {
  DEFAULT_BACKEND_URL,
  getBackendUrlOverride,
  getBetaKey,
} from './auth'

export type ApiErrorKind =
  | 'unreachable'
  | 'unauthorized'
  | 'rate_limited'
  | 'server'
  | 'bad_request'

export interface ApiError {
  kind: ApiErrorKind
  message: string
  status: number
  code?: string
  body?: unknown
  hint?: string
}

export interface ApiClientOptions extends Omit<RequestInit, 'body'> {
  gated?: boolean
  timeoutMs?: number
  body?: BodyInit | Record<string, unknown> | null
}

export interface ApiClientResult<T> {
  data: T
  cache?: 'HIT' | 'MISS' | 'BYPASS'
  status: number
}

export interface ComposedAbort {
  signal: AbortSignal
  cleanup: () => void
}

const DEFAULT_TIMEOUT_MS = 8_000

export function getBackendUrl(): string {
  return (getBackendUrlOverride() ?? DEFAULT_BACKEND_URL).replace(/\/+$/, '')
}

/**
 * Compose multiple AbortSignals so any abort cancels the shared signal.
 * Call `cleanup` when the request finishes so listeners are removed.
 */
export function composeAbortSignals(
  ...signals: Array<AbortSignal | null | undefined>
): ComposedAbort {
  const active = signals.filter((s): s is AbortSignal => s != null)
  if (active.length === 0) {
    return { signal: new AbortController().signal, cleanup: () => {} }
  }
  if (active.length === 1) {
    return { signal: active[0], cleanup: () => {} }
  }

  const controller = new AbortController()
  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort()
  }

  for (const signal of active) {
    if (signal.aborted) {
      onAbort()
      return { signal: controller.signal, cleanup: () => {} }
    }
  }

  for (const signal of active) {
    signal.addEventListener('abort', onAbort)
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of active) {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = getBackendUrl()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 400)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text }
  }
}

export function normalizeApiError(status: number, body: unknown): ApiError {
  const record =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const hint = typeof record.hint === 'string' ? record.hint : undefined
  const message =
    typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : `HTTP ${status}`
  const code = typeof record.code === 'string' ? record.code : typeof record.error === 'string' ? record.error : undefined

  if (status === 401) return { kind: 'unauthorized', message, status, code, body, hint }
  if (status === 429) return { kind: 'rate_limited', message, status, code, body, hint }
  if (status >= 500) return { kind: 'server', message, status, code, body, hint }
  return { kind: 'bad_request', message, status, code, body, hint }
}

function parseCacheHeader(value: string | null): ApiClientResult<unknown>['cache'] {
  if (!value) return undefined
  const upper = value.toUpperCase()
  if (upper.includes('HIT')) return 'HIT'
  if (upper.includes('MISS')) return 'MISS'
  if (upper.includes('BYPASS')) return 'BYPASS'
  return undefined
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as ApiError).kind === 'string'
  )
}

export async function apiClient<T = unknown>(
  path: string,
  options: ApiClientOptions = {},
): Promise<ApiClientResult<T>> {
  const {
    gated = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers,
    body,
    signal: callerSignal,
    ...rest
  } = options
  const url = buildUrl(path)
  const requestHeaders = new Headers(headers)

  if (gated) {
    const betaKey = getBetaKey()
    if (betaKey) requestHeaders.set('X-Streamclone-Beta-Key', betaKey)
  }
  if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'application/json')

  let requestBody: BodyInit | undefined
  if (body instanceof FormData || typeof body === 'string' || body instanceof Blob) {
    requestBody = body
  } else if (body != null) {
    requestHeaders.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }

  let lastError: ApiError | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (callerSignal?.aborted) {
      throw (
        lastError ?? {
          kind: 'unreachable',
          message: 'Aborted',
          status: 0,
        }
      )
    }

    const timeoutController = new AbortController()
    const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs)
    const composed = composeAbortSignals(callerSignal, timeoutController.signal)

    try {
      const response = await fetch(url, {
        ...rest,
        headers: requestHeaders,
        body: requestBody,
        signal: composed.signal,
      })

      const payload = await readBody(response)
      const cache = parseCacheHeader(response.headers.get('X-Cache'))

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:rejected'))
        throw normalizeApiError(401, payload)
      }

      if (!response.ok) {
        const error = normalizeApiError(response.status, payload)
        const retryable = response.status >= 500
        if (retryable && attempt === 0) {
          lastError = error
          await sleep(jitter(250))
          continue
        }
        throw error
      }

      return {
        data: payload as T,
        cache,
        status: response.status,
      }
    } catch (error) {
      if (isApiError(error)) throw error

      // Caller abort — do not retry.
      if (callerSignal?.aborted) {
        throw {
          kind: 'unreachable',
          message: error instanceof Error ? error.message : 'Aborted',
          status: 0,
        } satisfies ApiError
      }

      const unreachable: ApiError = {
        kind: 'unreachable',
        message: error instanceof Error ? error.message : 'Network error',
        status: 0,
      }
      if (attempt === 0) {
        lastError = unreachable
        await sleep(jitter(250))
        continue
      }
      throw lastError ?? unreachable
    } finally {
      window.clearTimeout(timer)
      composed.cleanup()
    }
  }

  throw lastError ?? { kind: 'server', message: 'Request failed' }
}
