// The short human code can prepare a review, but cannot consume approval.
// Polling/access/refresh secrets remain in the extension worker.
//
// The code lives only in this tab's memory. The link page takes it into its own
// state and empties this holder, then keeps it through an in-page sign-in, so
// the tab the extension opened continues once the user signs in. It is never
// written to storage, the URL or another tab; another tab recovers by reopening
// the link from the extension.
export type AccountDeviceContinuation = 'billing'

let deviceCode = ''
let continuation: AccountDeviceContinuation | null = null
let capturedAt = 0

export function captureAccountDeviceCode(): void {
  if (window.location.pathname.replace(/\/+$/, '') !== '/account/link-device') return
  const hash = window.location.hash
  // Exact shapes only: a code, optionally followed by one allowlisted flow name.
  const match = hash.length <= 30 ? /^#code=([A-F0-9]{10})(&then=billing)?$/.exec(hash) : null
  deviceCode = match?.[1] ?? ''
  continuation = match?.[2] ? 'billing' : null
  capturedAt = Date.now()
  // Strip even malformed fragments before the app or telemetry can observe them.
  window.history.replaceState(null, '', '/account/link-device')
}

function fresh(): boolean {
  const age = Date.now() - capturedAt
  return age >= 0 && age < 10 * 60_000
}

export function getAccountDeviceCode(): string {
  return fresh() ? deviceCode : ''
}

/** Where to continue after approval, only while the prepared code is fresh. */
export function getAccountDeviceContinuation(): AccountDeviceContinuation | null {
  return fresh() && deviceCode ? continuation : null
}

export function clearAccountDeviceCode(): void {
  deviceCode = ''
  continuation = null
  capturedAt = 0
}
