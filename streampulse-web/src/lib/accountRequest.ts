/**
 * The same-origin JSON request the website's /v1/account calls share: the
 * session cookie, the `__Host-pulse_csrf` cookie echoed as X-Pulse-CSRF on
 * writes (only when it is 64 hex characters), no caching, no redirects, no
 * referrer, and a 12 s timeout combined with the caller's own signal.
 *
 * Each caller passes the error it throws, so its pages keep catching their own
 * class. The code comes from the JSON `error` field; Retry-After comes from the
 * header, else from the body's `retryAfterSeconds`, capped at a day.
 */

const REQUEST_TIMEOUT_MS = 12_000
const MAX_RETRY_AFTER_SECONDS = 86_400

export type AccountErrorFactory = (status: number, code: string | undefined, retryAfterSeconds: number | undefined) => Error

const retrySeconds = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_RETRY_AFTER_SECONDS) : undefined

export async function accountJsonRequest(
  method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, makeError: AccountErrorFactory,
  body?: Record<string, unknown>, signal?: AbortSignal,
): Promise<unknown> {
  const write = method !== 'GET'
  const csrf = write ? document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('__Host-pulse_csrf='))?.slice('__Host-pulse_csrf='.length) : undefined
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(path, {
    method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf && /^[a-f0-9]{64}$/.test(csrf) ? { 'X-Pulse-CSRF': csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let code: string | undefined
    let bodyRetry: number | undefined
    try {
      const data: unknown = await response.json()
      if (data && typeof data === 'object') {
        const { error, retryAfterSeconds } = data as { error?: unknown; retryAfterSeconds?: unknown }
        if (typeof error === 'string' && error.length <= 64) code = error
        bodyRetry = retrySeconds(retryAfterSeconds)
      }
    } catch { /* A body that isn't JSON leaves only the status. */ }
    const header = retrySeconds(Number(response.headers?.get?.('Retry-After')))
    throw makeError(response.status, code, header ?? bodyRetry)
  }
  if (response.status === 204) return null
  return response.json()
}
