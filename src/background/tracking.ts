/**
 * Tracked-login registry only.
 * Recurring Pulse polling is owned by the content-script live poller while a
 * Twitch tab is open. The service worker must not start setInterval refreshers.
 */

interface TrackedLogin {
  login: string
}

const tracked = new Map<string, TrackedLogin>()

export function isTracked(login: string): boolean {
  return tracked.has(normalize(login))
}

/** Idempotent registration — safe to call repeatedly from ensureTracked / startup sync. */
export function trackLogin(login: string): void {
  const key = normalize(login)
  if (tracked.has(key)) return
  tracked.set(key, { login: key })
}

export function untrackLogin(login: string): void {
  tracked.delete(normalize(login))
}

export function listTrackedLogins(): string[] {
  return [...tracked.keys()]
}

function normalize(login: string): string {
  return login.trim().toLowerCase()
}
