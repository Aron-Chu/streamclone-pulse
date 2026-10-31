/**
 * IRC-2 pick A (candidate, 10-30): the one plain line the hub shows under the
 * activity header when the backend served its 30-minute live-pool fallback. It
 * says only what the payload states: which history is behind and what is shown.
 * No chat or ingest health claim. Never for the portal's own stand-in (IRC-10).
 */
import { hubActivityLastServedWords, isHubActivityBackendFallback } from './hubActivityHonesty'
import type { HubActivity } from './publicHub'

/** "24-hour" / "7-day": the requested window as a history length. */
function requestedHistoryWords(activity: HubActivity): string {
  const raw = activity.requestedWindowMinutes || activity.windowMinutes || 30
  const minutes = Math.max(1, Math.floor(raw))
  const day = 24 * 60
  if (minutes === day) return '24-hour'
  if (minutes % day === 0) return `${minutes / day}-day`
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

/** "24-hour history is behind right now": the line's first half, which the emote map's meta leads with (W1, 10-30). Null for anything else. */
export function hubActivityBehindWords(activity: HubActivity): string | null {
  if (!isHubActivityBackendFallback(activity)) return null
  return `${requestedHistoryWords(activity)} history is behind right now`
}

/** The line under the activity header for the backend's fallback. Null for anything else. */
export function hubActivityFallbackLine(activity: HubActivity): string | null {
  const behind = hubActivityBehindWords(activity)
  return behind ? `${behind}. Showing ${hubActivityLastServedWords(activity)}, live.` : null
}
