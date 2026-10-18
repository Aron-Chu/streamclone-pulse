import { isChannelRouteLogin } from './channelRoute'

/** Only local Moments URLs may be used as a broadcast return destination. */
export function analyticsReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value, 'https://portal.invalid')
    return url.origin === 'https://portal.invalid' && url.pathname === '/analytics/moments'
      ? url.pathname + url.search + url.hash : null
  } catch { return null }
}

/**
 * Where a retired Pulse Explorer (or older Newsroom) link lands. Their ids are
 * `pulse-{login}-{streamId}` (the backend's newsroomStoryID), and a Twitch login
 * has no hyphen, so the id names one stream page. Anything else goes to Moments.
 * Explorer's filters mean nothing on either page, so no query or hash carries over.
 */
export function retiredExplorerPath(id?: string): string {
  const match = id?.match(/^pulse-([a-z0-9_]{1,25})-([a-z0-9_-]{1,128})$/i)
  if (!match || !isChannelRouteLogin(match[1])) return '/analytics/moments'
  return `/analytics/${encodeURIComponent(match[1].toLowerCase())}/${encodeURIComponent(match[2])}`
}

export function broadcastTimelineHref(login: string, streamId: string, returnTo?: string, offset?: number): string {
  const back = analyticsReturnPath(returnTo)
  const query = back ? `?${new URLSearchParams({ returnTo: back })}` : ''
  const hash = offset != null && Number.isFinite(offset) && offset >= 0 ? `#t=${Math.floor(offset)}` : ''
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}${query}${hash}`
}
