// Keep the email secret in memory only, never markup or browser storage.
let confirmation: string | null = null
let capturedAt = 0
export function captureAccountConfirmation(): void {
  if (window.location.pathname !== '/account/confirm') return
  const hash = window.location.hash.slice(1)
  confirmation = /^[a-f0-9]{64}$/.test(hash) ? hash : null
  capturedAt = Date.now()
  window.history.replaceState(null, '', '/account/confirm')
}
export function getAccountConfirmation(): string | null {
  return Date.now() - capturedAt < 15 * 60_000 ? confirmation : null
}
export function clearAccountConfirmation(): void { confirmation = null }
