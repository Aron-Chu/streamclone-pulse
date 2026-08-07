import { formatActivityWindowLabel } from './hubActivitySummary'
import type { HubActivity } from './publicHub'

/** Backend HubActivity.source when long-window projection is unavailable. */
export const HUB_ACTIVITY_SOURCE_LIVE_POOL_FALLBACK = 'live_pool_fallback'

/** Backend HubActivity.source for a complete historical projection. */
export const HUB_ACTIVITY_SOURCE_HISTORICAL_PROJECTION = 'historical_projection'

/** Backend HubActivity.reason for projection-ineligible long windows. */
export const HUB_ACTIVITY_REASON_HISTORICAL_UNAVAILABLE =
  'historical_projection_unavailable'

function validWindowMinutes(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

/**
 * True only for the explicit backend proof that the payload is a complete
 * historical projection for the requested range. Requires availableWindowMinutes
 * to equal the request (aligned with ops historical-activity smoke).
 */
export function isHubActivityHealthyHistoricalProjection(activity: HubActivity): boolean {
  const requested = validWindowMinutes(activity.windowMinutes)
  const available = validWindowMinutes(activity.availableWindowMinutes)
  return (
    activity.source === HUB_ACTIVITY_SOURCE_HISTORICAL_PROJECTION &&
    activity.state === 'healthy' &&
    requested != null &&
    available === requested
  )
}

/**
 * True when hub activity is pool-only / degraded rather than a complete
 * historical projection for the requested window.
 */
export function isHubActivityLivePoolFallback(activity: HubActivity): boolean {
  if (activity.source === HUB_ACTIVITY_SOURCE_LIVE_POOL_FALLBACK) return true
  return (
    activity.state === 'degraded' &&
    activity.reason === HUB_ACTIVITY_REASON_HISTORICAL_UNAVAILABLE
  )
}

/**
 * Chart / fill grid window. When degraded, use availableWindowMinutes so we do
 * not fabricate missing historical buckets across the requested 24h/7d/30d span.
 * Requested windowMinutes stays on the payload for range-tab identity.
 */
export function resolveHubActivityChartWindowMinutes(activity: HubActivity): number {
  const requested = Math.max(1, activity.windowMinutes || 30)
  if (isHubActivityHealthyHistoricalProjection(activity)) return requested

  const available = validWindowMinutes(activity.availableWindowMinutes)
  if (available != null) {
    // A contract-bearing payload that is not explicitly healthy must not expand
    // an available served span into a requested historical grid.
    return Math.min(requested, available)
  }
  if (isHubActivityLivePoolFallback(activity)) {
    return Math.min(requested, 30)
  }

  // Legacy / incomplete payloads without honesty metadata must not expand a
  // long requested window into a fabricated historical chart grid.
  return Math.min(requested, 30)
}

/** Short status chip / banner label for degraded pool-only activity. */
export function hubActivityHonestyChipLabel(activity: HubActivity): string | null {
  if (!isHubActivityLivePoolFallback(activity)) return null
  return 'Recent live activity only'
}

/**
 * Honest served-span label for ledes and peaks. Prefer this over formatting
 * requested windowMinutes when the payload is degraded.
 */
export function formatHubActivityServedLabel(activity: HubActivity): string {
  if (isHubActivityLivePoolFallback(activity)) {
    return 'Recent live activity only'
  }
  return formatActivityWindowLabel(resolveHubActivityChartWindowMinutes(activity))
}

/** Longer explanation for title/tooltip when degraded. */
export function hubActivityHonestyDetail(activity: HubActivity): string | null {
  if (!isHubActivityLivePoolFallback(activity)) return null
  const requested = formatActivityWindowLabel(Math.max(1, activity.windowMinutes || 30))
  const availableMinutes = resolveHubActivityChartWindowMinutes(activity)
  const available = formatActivityWindowLabel(availableMinutes)
  return `Historical ${requested} projection unavailable — showing last ${available} of live-pool activity only. Missing history is not invented.`
}

export function hubActivityHonestyEmptyCopy(
  activity: HubActivity,
): { title: string; description: string } | null {
  if (!isHubActivityLivePoolFallback(activity)) return null
  const requested = formatActivityWindowLabel(Math.max(1, activity.windowMinutes || 30))
  return {
    title: 'Recent live activity only',
    description: `Full ${requested} history is not available yet. Waiting for live-pool chat and emotes — empty buckets are not filled with historical placeholders.`,
  }
}
