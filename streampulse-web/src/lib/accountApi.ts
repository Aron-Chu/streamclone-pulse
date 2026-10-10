type AccountPath = '/auth/start' | '/auth/complete' | '/auth/logout' | '/auth/twitch/start' | '/auth/twitch/complete' | '/identities/twitch/link' | '/history/list' | '/history/forget' | '/saves/list' | '/me' | '/devices' | `/devices?cursor=${string}` | '/devices/revoke' | '/sessions/revoke-all' | '/device-links/inspect' | '/device-links/approve'
export class AccountError extends Error {
  /** Seconds from a Retry-After header, when the server sent a usable one. */
  constructor(public status: number, public code?: string, public retryAfterSeconds?: number, public attemptId?: string) { super('Account request failed') }
}
export async function accountRequest(path: AccountPath, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return sessionRequest('/v1/account' + path, body)
}
export async function billingRequest(path: '/supporter' | '/checkout' | '/portal' | `/checkout/${string}`, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return sessionRequest('/v1/billing' + path, body)
}
/** Recovery approval is authorized by its single-use secret, never a cookie. */
export async function restoreRequest(path: '/inspect' | '/approve', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (path !== '/inspect' && path !== '/approve') throw new AccountError(400, 'invalid_request_path')
  return requestJson('/v1/account/restores' + path, body, 'omit', false)
}
// The edge relay allows billing POSTs 30 s (Stripe session creation) and
// everything else 12 s; the client waits slightly longer so the edge answers first.
export const ACCOUNT_REQUEST_TIMEOUT_MS = 12_000
export const BILLING_POST_TIMEOUT_MS = 35_000
const SLOW_BILLING_POSTS = new Set(['/v1/billing/checkout', '/v1/billing/portal'])
async function sessionRequest(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Validate URL-derived IDs at runtime, including calls from JavaScript.
  const allowed = /^\/v1\/(?:account\/(?:auth\/(?:start|complete|logout|twitch\/(?:start|complete))|identities\/twitch\/link|history\/(?:list|forget)|saves\/list|me|devices(?:\?cursor=[0-9a-fA-F-]{36}|\/revoke)?|sessions\/revoke-all|device-links\/(?:inspect|approve))|billing\/(?:supporter|portal|checkout(?:\/[0-9a-fA-F-]{36})?))$/
  if (!allowed.test(path) || path.includes('\n') || path.includes('\r')) throw new AccountError(400, 'invalid_request_path')
  return requestJson(path, body, 'same-origin', true)
}
async function requestJson(path: string, body: Record<string, unknown> | undefined, credentials: RequestCredentials, withCsrf: boolean): Promise<Record<string, unknown>> {
  const csrf = withCsrf ? document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('__Host-pulse_csrf='))?.slice('__Host-pulse_csrf='.length) : undefined
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials, redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(body && SLOW_BILLING_POSTS.has(path) ? BILLING_POST_TIMEOUT_MS : ACCOUNT_REQUEST_TIMEOUT_MS),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf && /^[a-f0-9]{64}$/.test(csrf) ? { 'X-Pulse-CSRF': csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let code: string | undefined
    let attemptId: string | undefined
    try {
      const errorBody: unknown = await response.json()
      if (errorBody && typeof errorBody === 'object' && !Array.isArray(errorBody) && typeof (errorBody as { error?: unknown }).error === 'string') code = (errorBody as { error: string }).error
      // A pending or expired checkout names its own attempt so the page can follow it.
      const attempt = errorBody && typeof errorBody === 'object' ? (errorBody as { attemptId?: unknown }).attemptId : undefined
      if (typeof attempt === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attempt)) attemptId = attempt
    } catch { /* Generic status handling is intentional for malformed provider responses. */ }
    const retryAfter = Number(response.headers?.get?.('Retry-After'))
    // Checkout and portal sessions have a daily budget too (backend #162), so
    // their wait can be honest up to a day; everything else stays within 15 min.
    const retryCap = body && SLOW_BILLING_POSTS.has(path) ? 86_400 : 900
    throw new AccountError(response.status, code, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, retryCap) : undefined, attemptId)
  }
  if (response.status === 204) return {}
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AccountError(503)
  return data as Record<string, unknown>
}
export function accountErrorText(error: unknown): string {
  if (error instanceof AccountError) {
    if (error.status === 429) return 'Too many attempts. Wait a few minutes, then try again.'
    if ((error.status === 400 || error.status === 401) && error.code === 'link_invalid_or_expired') return 'This link has expired or is no longer valid. Request a new sign-in link.'
    if (error.status === 401) return 'This session or link has expired. Sign in again to continue.'
    if (error.status === 403) return 'This request could not be verified. Reload the page and try again.'
    if (error.status === 503 && error.code === 'delivery_unavailable') return 'Email delivery is temporarily unavailable. Please try again later.'
  }
  return 'Account services are unavailable right now. Please try again later.'
}
