// The short human code can prepare a review, but cannot consume approval.
// Polling/access/refresh secrets remain in the extension worker.
let deviceCode = ''
let capturedAt = 0

export function captureAccountDeviceCode(): void {
  if (window.location.pathname.replace(/\/+$/, '') !== '/account/link-device') return
  const hash = window.location.hash
  const match = hash.length === 16 ? /^#code=([A-F0-9]{10})$/.exec(hash) : null
  deviceCode = match?.[1] ?? ''
  capturedAt = Date.now()
  // Strip even malformed fragments before the app or telemetry can observe them.
  window.history.replaceState(null, '', '/account/link-device')
}

export function getAccountDeviceCode(): string {
  const age = Date.now() - capturedAt
  return age >= 0 && age < 10 * 60_000 ? deviceCode : ''
}

export function clearAccountDeviceCode(): void {
  deviceCode = ''
  capturedAt = 0
}
