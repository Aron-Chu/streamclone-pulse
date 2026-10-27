import { isModuleLoadError, reloadAfterPortalError } from './PortalErrorBoundary'

/** Set once this tab has reloaded itself for a missing chunk; it lasts as long as the tab's session. */
export const STALE_BUILD_RELOAD_KEY = 'sp:staleBuildReload:v1'

/**
 * A tab left open across a deploy still runs the old build, so its next lazy
 * page asks for chunks (or their CSS) that the new deploy no longer serves.
 * Reload once onto the current build instead of leaving the error panel up.
 * The session flag allows one reload per tab: a chunk that is really missing
 * falls back to the panel instead of looping, and so does blocked storage.
 */
export function reloadOnceForStaleBuild(error: unknown, reload?: () => void): boolean {
  if (!isModuleLoadError(error)) return false
  try {
    const storage = window.sessionStorage
    if (storage.getItem(STALE_BUILD_RELOAD_KEY) !== null) return false
    storage.setItem(STALE_BUILD_RELOAD_KEY, '1')
    if (storage.getItem(STALE_BUILD_RELOAD_KEY) === null) return false
  } catch {
    return false
  }
  reloadAfterPortalError(reload)
  return true
}

/**
 * Vite fires `vite:preloadError` when a lazy chunk or its CSS fails to load.
 * The error still reaches the page's error boundary, which shows until the
 * reload lands (or stays, when no reload happens).
 */
export function installStaleBuildReload(reload?: () => void): () => void {
  const onPreloadError = (event: Event) => {
    reloadOnceForStaleBuild((event as Event & { payload?: unknown }).payload, reload)
  }
  window.addEventListener('vite:preloadError', onPreloadError)
  return () => window.removeEventListener('vite:preloadError', onPreloadError)
}
