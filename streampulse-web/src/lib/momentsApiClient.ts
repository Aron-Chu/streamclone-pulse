import { DEFAULT_BACKEND_URL, getBackendUrlOverride, getBetaKey } from './auth'

export type ApiErrorKind = 'unreachable' | 'aborted' | 'timeout' | 'response_too_large' | 'unauthorized' | 'rate_limited' | 'server' | 'bad_request'
export interface ApiError { kind: ApiErrorKind; message: string; status: number; code?: string; body?: unknown; hint?: string; retryAfterMs?: number }
export interface ApiClientOptions extends Omit<RequestInit, 'body'> {
  gated?: boolean
  /** Body credentials or personal data: enforce the destination without injecting a beta key. */
  sensitive?: boolean
  timeoutMs?: number
  maxResponseBytes?: number
  /** Enables mutation retry only when the server supports this idempotency key. */
  idempotencyKey?: string
  body?: BodyInit | Record<string, unknown> | null
}
export interface ApiClientResult<T> { data: T; cache?: 'HIT' | 'MISS' | 'BYPASS'; status: number }

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const GATED_PATH = /^\/v1\/(?:extension|analytics|portal|pulse)(?:\/|$)/

export function getBackendUrl(): string { return (getBackendUrlOverride() ?? DEFAULT_BACKEND_URL).replace(/\/+$/, '') }
function buildUrl(path: string): string { return new URL(path, `${getBackendUrl()}/`).toString() }
function assertCredentialDestination(url: string): void {
  const destination = new URL(url)
  const trusted = new URL(getBackendUrl())
  if (destination.origin !== trusted.origin || !GATED_PATH.test(destination.pathname)) {
    throw new TypeError('Credential-bearing API request is outside the trusted StreamPulse boundary')
  }
}
function jitter(ms: number): number { return ms + Math.floor(Math.random() * 400) }
function abortReason(signal: AbortSignal): unknown { return signal.reason ?? new DOMException('Aborted', 'AbortError') }
async function abortableSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw { kind: 'aborted', message: 'Request was cancelled', status: 0 } satisfies ApiError
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(done, ms)
    function done() { signal?.removeEventListener('abort', cancelled); resolve() }
    function cancelled() { window.clearTimeout(timer); reject({ kind: 'aborted', message: 'Request was cancelled', status: 0 } satisfies ApiError) }
    signal?.addEventListener('abort', cancelled, { once: true })
  })
}
function deadlineSignal(caller: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const forward = () => controller.abort(caller?.reason)
  if (caller?.aborted) forward(); else caller?.addEventListener('abort', forward, { once: true })
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')) }, timeoutMs)
  return { signal: controller.signal, timedOut: () => timedOut, dispose: () => { window.clearTimeout(timer); caller?.removeEventListener('abort', forward) } }
}
async function readBody(res: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  const declared = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel('response too large').catch(() => undefined)
    throw { kind: 'response_too_large', message: 'API response exceeds the allowed size', status: res.status } satisfies ApiError
  }
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let received = 0
  let rejectCancelled: ((reason?: unknown) => void) | undefined
  const onAbort = () => rejectCancelled?.(abortReason(signal))
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject
    if (signal.aborted) reject(abortReason(signal)); else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), cancelled])
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        void reader.cancel('response too large')
        throw { kind: 'response_too_large', message: 'API response exceeds the allowed size', status: res.status } satisfies ApiError
      }
      chunks.push(value)
    }
  } catch (error) {
    if (signal.aborted) void reader.cancel(abortReason(signal)).catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  const combined = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength }
  const text = new TextDecoder().decode(combined)
  if (!text) return null
  try { return JSON.parse(text) as unknown } catch { return { error: text } }
}
export function normalizeApiError(status: number, body: unknown, retryAfterHeader?: string | null): ApiError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const hint = typeof record.hint === 'string' ? record.hint : undefined
  const message = typeof record.error === 'string' ? record.error : typeof record.message === 'string' ? record.message : `HTTP ${status}`
  const code = typeof record.code === 'string' ? record.code : typeof record.error === 'string' ? record.error : undefined
  let retryAfterMs: number | undefined
  if (retryAfterHeader?.trim()) {
    const raw = retryAfterHeader.trim()
    if (/^\d+$/.test(raw)) retryAfterMs = Math.min(120_000, Math.max(1_000, Math.round(Number(raw) * 1000)))
    else { const when = Date.parse(raw); if (Number.isFinite(when)) retryAfterMs = Math.min(120_000, Math.max(1_000, when - Date.now())) }
  }
  if (status === 401) return { kind: 'unauthorized', message, status, code, body, hint, retryAfterMs }
  if (status === 429) return { kind: 'rate_limited', message, status, code, body, hint, retryAfterMs }
  if (status >= 500) return { kind: 'server', message, status, code, body, hint, retryAfterMs }
  return { kind: 'bad_request', message, status, code, body, hint, retryAfterMs }
}
function parseCacheHeader(value: string | null): ApiClientResult<unknown>['cache'] {
  const upper = value?.toUpperCase() ?? ''
  if (upper.includes('HIT')) return 'HIT'; if (upper.includes('MISS')) return 'MISS'; if (upper.includes('BYPASS')) return 'BYPASS'; return undefined
}
export function isApiError(value: unknown): value is ApiError { return typeof value === 'object' && value !== null && 'kind' in value && typeof (value as ApiError).kind === 'string' }

export async function apiClient<T = unknown>(path: string, options: ApiClientOptions = {}): Promise<ApiClientResult<T>> {
  const { gated = false, sensitive = false, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES, idempotencyKey, headers, body, signal: callerSignal, ...rest } = options
  const url = buildUrl(path)
  const requestHeaders = new Headers(headers)
  // A caller-supplied credential must obey the same boundary as an injected one.
  const credentialBearing = gated || sensitive || requestHeaders.has('Authorization') || requestHeaders.has('X-Streamclone-Beta-Key') || rest.credentials === 'include'
  if (credentialBearing) assertCredentialDestination(url)
  if (gated) { const betaKey = getBetaKey(); if (betaKey) requestHeaders.set('X-Streamclone-Beta-Key', betaKey) }
  if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'application/json')
  if (idempotencyKey?.trim()) requestHeaders.set('Idempotency-Key', idempotencyKey.trim())
  let requestBody: BodyInit | undefined
  if (body instanceof FormData || typeof body === 'string' || body instanceof Blob) requestBody = body
  else if (body != null) { requestHeaders.set('Content-Type', 'application/json'); requestBody = JSON.stringify(body) }
  const method = (rest.method ?? 'GET').toUpperCase()
  const retryable = SAFE_RETRY_METHODS.has(method) || Boolean(idempotencyKey?.trim())
  let lastError: ApiError | null = null
  // One budget spans all attempts, backoff and body reads, not a fresh deadline
  // per attempt. Credential-bearing redirects fail closed at the fetch boundary.
  const deadline = deadlineSignal(callerSignal, timeoutMs)
  try {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { ...rest, redirect: credentialBearing ? 'error' : rest.redirect, headers: requestHeaders, body: requestBody, cache: rest.cache ?? 'no-store', signal: deadline.signal })
      const payload = await readBody(response, deadline.signal, maxResponseBytes)
      const cache = parseCacheHeader(response.headers.get('X-Cache'))
      if (response.status === 401) { window.dispatchEvent(new CustomEvent('auth:rejected')); throw normalizeApiError(401, payload, response.headers.get('Retry-After')) }
      if (!response.ok) {
        const error = normalizeApiError(response.status, payload, response.headers.get('Retry-After'))
        if (response.status >= 500 && retryable && attempt === 0) { lastError = error; await abortableSleep(jitter(250), deadline.signal); continue }
        throw error
      }
      return { data: payload as T, cache, status: response.status }
    } catch (error) {
      if (isApiError(error)) throw error
      if (deadline.signal.aborted) throw error
      const unreachable: ApiError = { kind: 'unreachable', message: error instanceof Error ? error.message : 'Network error', status: 0 }
      if (retryable && attempt === 0) { lastError = unreachable; await abortableSleep(jitter(250), deadline.signal); continue }
      throw lastError ?? unreachable
    }
  }
  throw lastError ?? { kind: 'server', message: 'Request failed', status: 0 }
  } catch (error) {
    if (deadline.timedOut()) throw { kind: 'timeout', message: 'Request deadline exceeded', status: 0 } satisfies ApiError
    if (callerSignal?.aborted) throw { kind: 'aborted', message: 'Request was cancelled', status: 0 } satisfies ApiError
    throw error
  } finally { deadline.dispose() }
}
