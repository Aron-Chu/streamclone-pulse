/**
 * Build-time switch for the Clips tab on /analytics/moments
 * (VITE_PUBLIC_NATIVE_CLIPS). Off unless the build sets it to `on` (or `1`).
 * Off, the Moments page is exactly master's. On, the tab reads
 * /v1/public/clips, which answers 404 until the backend's
 * PULSE_NATIVE_CLIPS_CATALOGUE_ENABLED is on; the tab says so.
 *
 * A production build reads the flag inline in AnalyticsMomentsPage instead,
 * where it folds away (see there); this is the read for tests and dev.
 */
export function nativeClipsEnabled(): boolean {
  const value = import.meta.env.VITE_PUBLIC_NATIVE_CLIPS
  return value === 'on' || value === '1'
}

/**
 * A clip's own page as a place a sign-in may come back to, or null. Exactly
 * /analytics/clips/<id> (the clip id rule in nativeClips.ts), and only in a
 * build that has the page: no query, no fragment, nothing encoded.
 */
export function clipPageReturnPath(value: unknown): string | null {
  return nativeClipsEnabled() && typeof value === 'string' && /^\/analytics\/clips\/[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null
}
