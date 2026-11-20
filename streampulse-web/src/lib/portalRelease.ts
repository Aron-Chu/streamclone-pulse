/**
 * The portal's release name and the route names it reports under. No error
 * SDK here: the status page and the error boundary read these on first load,
 * while the SDK itself loads later (see sentry.ts).
 */

export function portalRelease(): string {
  return (import.meta.env.VITE_PORTAL_VERSION as string | undefined)?.trim() || 'dev'
}

/** Short form for status UI — full SHA remains in VITE_PORTAL_VERSION / Sentry release. */
export function portalReleaseShort(): string {
  const full = portalRelease()
  const m = /^streampulse-portal@([0-9a-f]{40})$/i.exec(full)
  if (!m) return full
  return `streampulse-portal@${m[1].slice(0, 7)}`
}

/**
 * Every fixed route in src/routes/index.tsx reports under its own name. Anything
 * else (typos, probes, removed pages) stays '/:unknown' so free-form paths never
 * become a tag value. Account pages are named here for navigation breadcrumbs
 * only: scrubPortalEvent still drops every event raised on them.
 */
const STATIC_ROUTE_NAMES = new Set([
  '/', '/help', '/docs', '/status', '/privacy', '/terms', '/refunds', '/support', '/feedback', '/discord',
  '/supporter', '/supporter/thanks', '/changelog',
  '/analytics', '/analytics/streams', '/analytics/moments', '/analytics/explore', '/analytics/newsroom',
  '/account', '/account/moments',
  '/account/sign-in', '/account/confirm', '/account/restore', '/account/link-device', '/account/settings',
  '/account/billing', '/account/billing/return',
])

export function sanitizePortalPath(pathname: string): string {
  let path = pathname.split(/[?#]/)[0] || '/'
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname } catch { return '/:unknown' }
  }
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (STATIC_ROUTE_NAMES.has(path)) return path
  // Fixed analytics pages first: otherwise /analytics/moments reads as a channel login.
  if (/^\/analytics\/explore\/[^/]+$/.test(path)) return '/analytics/explore/:broadcastId'
  if (/^\/analytics\/newsroom\/[^/]+$/.test(path)) return '/analytics/newsroom/:storyId'
  if (/^\/analytics\/[^/]+\/s\/[^/]+\/?$/.test(path)) return '/analytics/:login/s/:streamId'
  if (/^\/analytics\/[^/]+\/[^/]+\/?$/.test(path)) return '/analytics/:login/:streamId'
  if (/^\/analytics\/[^/]+\/?$/.test(path)) return '/analytics/:login'
  if (/^\/s\/[^/]+\/[^/]+\/?$/.test(path)) return '/s/:login/:streamId'
  return '/:unknown'
}
