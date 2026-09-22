type AccountPath = '/auth/start' | '/auth/complete' | '/auth/logout' | '/me' | '/devices' | `/devices?cursor=${string}` | '/devices/revoke' | '/device-links/inspect' | '/device-links/approve'
export class AccountError extends Error {
  constructor(public status: number, public code?: string) { super('Account request failed') }
}
export async function accountRequest(path: AccountPath, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return sessionRequest('/v1/account' + path, body)
}
export async function billingRequest(path: '/supporter' | '/checkout' | '/portal' | `/checkout/${string}`, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return sessionRequest('/v1/billing' + path, body)
}
async function sessionRequest(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const csrf = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('__Host-pulse_csrf='))?.slice('__Host-pulse_csrf='.length)
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12_000),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf && /^[a-f0-9]{64}$/.test(csrf) ? { 'X-Pulse-CSRF': csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let code: string | undefined
    try {
      const errorBody: unknown = await response.json()
      if (errorBody && typeof errorBody === 'object' && !Array.isArray(errorBody) && typeof (errorBody as { error?: unknown }).error === 'string') code = (errorBody as { error: string }).error
    } catch { /* Generic status handling is intentional for malformed provider responses. */ }
    throw new AccountError(response.status, code)
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
