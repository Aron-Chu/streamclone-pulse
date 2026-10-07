// Kept apart from publicHubCache and free of imports: every layout's error
// boundary uses it, and importing the hub parser there would pull it into a
// separate chunk that every public page loads up front.

export const STORAGE_PREFIX = 'sp:publicHub:v1:'
export const PROJECTION_STORAGE_PREFIX = 'sp:publicHubProjection:v1:'

/** Set once a page in this tab has crashed; a reload starts a fresh document. */
let writesStoppedAfterError = false

export function publicHubCacheWritesStopped(): boolean {
  return writesStoppedAfterError
}

/**
 * Clears all public hub cache entries. Error recovery calls this before
 * reloading so a snapshot that crashed the page is refetched, not re-hydrated.
 */
export function clearPublicHubCache(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX) || key?.startsWith(PROJECTION_STORAGE_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Storage blocked (private mode) — nothing was cached.
  }
}

/**
 * Called when an error boundary catches a crash. The snapshot behind it may
 * already be saved (a crash in an effect, or below the page that polls, commits
 * first), so clear the cache and stop saving snapshots in this tab: a retry, a
 * reload or a new tab then starts from a fresh hub read. Any crash counts, as a
 * boundary cannot tell which data caused it; the cost is the cached first paint
 * until the next reload.
 */
export function discardPublicHubCacheAfterError(): void {
  writesStoppedAfterError = true
  clearPublicHubCache()
}

/** Test helper — allows saving snapshots again after a test crashed a page. */
export function allowPublicHubCacheWritesForTests(): void {
  writesStoppedAfterError = false
}
