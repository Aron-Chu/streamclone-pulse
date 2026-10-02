// Recovery secrets live only in this document's memory, never in markup,
// storage, a query string or an outgoing referrer.
let restoreSecret: string | null = null
let capturedAt = 0
export function captureAccountRestore(): void {
  if (window.location.pathname.replace(/\/+$/, '') !== '/account/restore') return
  const fragment = window.location.hash.slice(1)
  window.history.replaceState(null, '', '/account/restore')
  restoreSecret = /^[a-f0-9]{64}$/.test(fragment) ? fragment : null
  capturedAt = Date.now()
}
export function getAccountRestore(): string | null {
  if (Date.now() - capturedAt >= 15 * 60_000) clearAccountRestore()
  return restoreSecret
}
export function clearAccountRestore(): void { restoreSecret = null }

/** These routes must not bootstrap a cookie principal or diagnostics. */
export function isPrivateSupporterRoute(pathname: string): boolean {
  return pathname.startsWith('/account/') || pathname.replace(/\/+$/, '') === '/supporter/thanks'
}
