/**
 * Build-time switch for the checked Moments page (VITE_PUBLIC_MOMENTS_FEED).
 * Off unless the build sets it to `on` (or `1`). Off, /analytics/moments is
 * exactly master's page. On, the page reads /v1/public/moments, and falls back
 * to master's page when the feed is not there (404 while the backend flag is
 * off) or does not answer on the first load.
 *
 * A production build reads the flag inline in AnalyticsMomentsPage instead,
 * where it folds away (see there); this is the read for tests and dev.
 */
export function momentsFeedEnabled(): boolean {
  const value = import.meta.env.VITE_PUBLIC_MOMENTS_FEED
  return value === 'on' || value === '1'
}
