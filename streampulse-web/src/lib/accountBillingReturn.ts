const STORAGE_KEY = 'pulse.account.billingReturn.v1'
const MAX_AGE_MS = 15 * 60_000
const ATTEMPT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export function accountBillingReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256 || !/^\/account\/billing(?:\/return)?(?:\?[^#\\\s]*)?$/.test(value)) return null
  const url = new URL(value, 'https://streampulse.stream')
  const entries = [...url.searchParams.entries()]
  if (entries.length === 0) return url.pathname
  if (url.pathname !== '/account/billing/return') return null
  const attempts = url.searchParams.getAll('attempt')
  const cancelled = url.searchParams.getAll('cancelled')
  if (attempts.length !== 1 || !ATTEMPT_ID.test(attempts[0])
    || cancelled.length > 1 || cancelled.some(value => value !== '1')
    || entries.length !== attempts.length + cancelled.length) return null
  const query = new URLSearchParams({ attempt: attempts[0] })
  if (cancelled.length) query.set('cancelled', '1')
  return `${url.pathname}?${query}`
}

export function accountBillingReturnFromSearch(search: string): string | null {
  const values = new URLSearchParams(search).getAll('returnTo')
  return values.length === 1 ? accountBillingReturnPath(values[0]) : null
}

export function accountBillingSignInHref(returnTo: unknown): string {
  const path = accountBillingReturnPath(returnTo)
  return path ? `/account/sign-in?${new URLSearchParams({ returnTo: path })}` : '/account/sign-in'
}

// This navigation hint is shared across same-origin tabs. Never store identity or email-link secrets.
export function rememberAccountBillingReturn(returnTo: unknown): void {
  const path = accountBillingReturnPath(returnTo)
  try {
    if (path) localStorage.setItem(STORAGE_KEY, JSON.stringify({ path, expiresAt: Date.now() + MAX_AGE_MS }))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* Storage restrictions must not prevent sign-in. */ }
}

export function readAccountBillingReturn(): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (value && typeof value === 'object') {
      const { path, expiresAt } = value as { path?: unknown; expiresAt?: unknown }
      const now = Date.now()
      if (typeof expiresAt === 'number' && expiresAt > now && expiresAt <= now + MAX_AGE_MS) {
        const destination = accountBillingReturnPath(path)
        if (destination) return destination
      }
    }
  } catch { /* Missing, malformed, or inaccessible hints use the standard account flow. */ }
  rememberAccountBillingReturn(null)
  return null
}

export function consumeAccountBillingReturn(): string | null {
  const path = readAccountBillingReturn()
  rememberAccountBillingReturn(null)
  return path
}
