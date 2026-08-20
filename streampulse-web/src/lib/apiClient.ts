import {
  DEFAULT_BACKEND_URL,
  getBackendUrlOverride,
  getBetaKey,
} from './auth'

export type ApiErrorKind =
  | 'unreachable'
  | 'aborted'
  | 'timeout'
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
  /** Parsed Retry-After delay in ms when present (especially 429). */
  retryAfterMs?: number
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

const DEFAULT_TIMEOUT_MS = 8_000

export function getBackendUrl(): string {
  return (getBackendUrlOverride() ?? DEFAULT_BACKEND_URL).replace(/\/+$/, '')
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

export function normalizeApiError(
  status: number,
  body: unknown,
  retryAfterHeader?: string | null,
): ApiError {
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
  let retryAfterMs: number | undefined
  if (retryAfterHeader?.trim()) {
    const raw = retryAfterHeader.trim()
    if (/^\d+$/.test(raw)) {
      const sec = Number(raw)
      if (Number.isFinite(sec) && sec >= 0) {
        retryAfterMs = Math.min(120_000, Math.max(1_000, Math.round(sec * 1000)))
      }
    } else {
      const when = Date.parse(raw)
      if (Number.isFinite(when)) {
        retryAfterMs = Math.min(120_000, Math.max(1_000, when - Date.now()))
      }
    }
  }

  if (status === 401) return { kind: 'unauthorized', message, status, code, body, hint, retryAfterMs }
  if (status === 429) return { kind: 'rate_limited', message, status, code, body, hint, retryAfterMs }
  if (status >= 500) return { kind: 'server', message, status, code, body, hint, retryAfterMs }
  return { kind: 'bad_request', message, status, code, body, hint, retryAfterMs }
}

function parseCacheHeader(value: string | null): ApiClientResult<unknown>['cache'] {
  if (!value) return undefined
  const upper = value.toUpperCase()
  if (upper.includes('HIT')) return 'HIT'
  if (upper.includes('MISS')) return 'MISS'
  if (upper.includes('BYPASS')) return 'BYPASS'
  return undefined
}

export function isApiError(value: unknown): value is ApiError {
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

  if (callerSignal?.aborted) {
    throw abortedApiError(callerSignal.reason)
  }

  let lastError: ApiError | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => {
      controller.abort(callerSignal?.reason ?? new DOMException('request aborted', 'AbortError'))
    }
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    const timer = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('request timeout', 'TimeoutError'))
    }, timeoutMs)

    try {
      const response = await fetch(url, {
        ...rest,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      })

      const payload = await readBody(response)
      const cache = parseCacheHeader(response.headers.get('X-Cache'))

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:rejected'))
        throw normalizeApiError(401, payload, response.headers.get('Retry-After'))
      }

      if (!response.ok) {
        const error = normalizeApiError(response.status, payload, response.headers.get('Retry-After'))
        if (response.status >= 500 && attempt === 0) {
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
      if (callerSignal?.aborted) throw abortedApiError(callerSignal.reason)
      if (timedOut || controller.signal.aborted) {
        throw {
          kind: 'timeout',
          message: 'Request timed out',
          status: 0,
        } satisfies ApiError
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw abortedApiError(error)
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
      globalThis.clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }
  }

  throw lastError ?? { kind: 'server', message: 'Request failed' }
}

function abortedApiError(reason: unknown): ApiError {
  return {
    kind: 'aborted',
    message: reason instanceof Error ? reason.message : 'Request aborted',
    status: 0,
  }
}
