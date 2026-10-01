/**
 * Same-origin, cross-tab hints that this browser's account session changed.
 *
 * The email link opens in a new tab. The tab where the user started (holding an
 * extension code in memory, or waiting on billing) listens here and re-checks
 * the server session, so nobody has to reopen anything. Messages carry no
 * identity, code or secret: they only say "check again". The server session
 * remains the only authority.
 */
const CHANNEL = 'pulse-account-session-v1'
const SIGNED_IN_KEY = 'pulse.account.signedInAt.v1'
/** The server's recent-sign-in window for linking and billing changes. */
export const RECENT_SIGN_IN_MS = 10 * 60_000

type Signal = 'signed-in' | 'signed-out'

function post(signal: Signal): void {
  try {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage(signal)
    channel.close()
  } catch { /* Older browsers fall back to the storage event below. */ }
}

export function announceAccountSignedIn(): void {
  // A timestamp only, so a waiting tab can tell a stale session from a bad code.
  try { localStorage.setItem(SIGNED_IN_KEY, String(Date.now())) } catch { /* storage denied */ }
  post('signed-in')
}

export function announceAccountSignedOut(): void {
  try { localStorage.removeItem(SIGNED_IN_KEY) } catch { /* storage denied */ }
  post('signed-out')
}

/** Milliseconds since this browser last completed a sign-in, or null if unknown. */
export function accountSignInAge(): number | null {
  try {
    const at = Number(localStorage.getItem(SIGNED_IN_KEY))
    const age = Date.now() - at
    return Number.isFinite(at) && at > 0 && age >= 0 ? age : null
  } catch { return null }
}

/** Calls `listener` when another tab signs in or out; returns an unsubscribe. */
export function onAccountSessionSignal(listener: (signal: Signal) => void): () => void {
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = event => { if (event.data === 'signed-in' || event.data === 'signed-out') listener(event.data) }
  } catch { channel = null }
  const storage = (event: StorageEvent) => {
    if (event.key !== SIGNED_IN_KEY) return
    listener(event.newValue ? 'signed-in' : 'signed-out')
  }
  // The storage event duplicates the channel message; listeners re-check the
  // server, which is idempotent, so a double notification costs one read.
  if (!channel) window.addEventListener('storage', storage)
  return () => {
    channel?.close()
    window.removeEventListener('storage', storage)
  }
}
