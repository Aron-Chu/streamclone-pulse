/**
 * Build-time switch for the Moments feed (VITE_PUBLIC_MOMENTS_FEED). Off unless
 * the build sets it to `on` (or `1`). Today it changes only the hub's Top
 * moments rail: on, the rail reads /v1/public/moments and keeps the hub's own
 * rows when the feed is not there (404 while the backend route is off).
 * /analytics/moments does not read it.
 *
 * A production build reads the flag inline in HubV5TopMoments instead, where
 * it folds away (see there); this is the read for tests and dev. Run
 * `npm run check:switch-routes` before a deploy that turns it on.
 */
export function momentsFeedEnabled(): boolean {
  const value = import.meta.env.VITE_PUBLIC_MOMENTS_FEED
  return value === 'on' || value === '1'
}
