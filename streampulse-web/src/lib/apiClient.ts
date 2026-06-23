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

  if (status === 401) return { kind: 'unauthorized', message, hint }
  if (status === 429) return { kind: 'rate_limited', message, hint }
  if (status >= 500) return { kind: 'server', message, hint }
  return { kind: 'bad_request', message, hint }
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
  const { gated = false, timeoutMs = DEFAULT_TIMEOUT_MS, headers, body, ...rest } = options
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
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...rest,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      })
      window.clearTimeout(timer)

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
      window.clearTimeout(timer)
      if (isApiError(error)) throw error

      const unreachable: ApiError = {
        kind: 'unreachable',
        message: error instanceof Error ? error.message : 'Network error',
      }
      if (attempt === 0) {
        lastError = unreachable
        await sleep(jitter(250))
        continue
      }
      throw lastError ?? unreachable
    }
  }

  throw lastError ?? { kind: 'server', message: 'Request failed' }
}
