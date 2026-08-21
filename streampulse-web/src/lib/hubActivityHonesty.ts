import { formatActivityWindowLabel } from './hubActivitySummary'
import type { HubActivity, HubActivityPoint } from './publicHub'

/** Backend HubActivity.source when long-window projection is unavailable. */
export const HUB_ACTIVITY_SOURCE_LIVE_POOL_FALLBACK = 'live_pool_fallback'

/** Backend HubActivity.source for a complete historical projection. */
export const HUB_ACTIVITY_SOURCE_HISTORICAL_PROJECTION = 'historical_projection'

/** Backend HubActivity.reason for projection-ineligible long windows. */
export const HUB_ACTIVITY_REASON_HISTORICAL_UNAVAILABLE =
  'historical_projection_unavailable'

/** Backend / portal marker for an attested registered known-gap bucket. */
export const HUB_ACTIVITY_GAP_KIND_ATTESTED = 'attested'

/** Client chart-grid placeholder — not measured and not backend-attested. */
export const HUB_ACTIVITY_GAP_KIND_UNMEASURED = 'unmeasured'

function validWindowMinutes(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

/** Count of backend-attested gaps inside the served activity window. */
export function hubActivityRegisteredGapCount(activity: HubActivity): number {
  return nonNegativeInt(activity.registeredGapCount)
}

/**
 * True when the bucket is an attested registered gap (or an explicit client
 * fill placeholder). These must never be treated as measured zeros.
 */
export function isActivityGapMarker(point: Pick<HubActivityPoint, 'gapKind' | 'hasChatRollup'>): boolean {
  return (
    point.gapKind === HUB_ACTIVITY_GAP_KIND_ATTESTED ||
    point.gapKind === HUB_ACTIVITY_GAP_KIND_UNMEASURED
  )
}

/** True when the bucket is a backend-attested registered known gap. */
export function isAttestedActivityGap(point: Pick<HubActivityPoint, 'gapKind'>): boolean {
  return point.gapKind === HUB_ACTIVITY_GAP_KIND_ATTESTED
}

/**
 * True only for the explicit backend proof that the payload is a complete
 * historical projection for the requested range. Accounted coverage (data +
 * attested gaps) may satisfy the request; measured coverage alone must not
 * claim a full window when registered gaps exist.
 */
export function isHubActivityHealthyHistoricalProjection(activity: HubActivity): boolean {
  const requested = validWindowMinutes(activity.windowMinutes)
  if (
    activity.source !== HUB_ACTIVITY_SOURCE_HISTORICAL_PROJECTION ||
    activity.state !== 'healthy' ||
    requested == null
  ) {
    return false
  }

  const available = validWindowMinutes(activity.availableWindowMinutes)
  const accounted = validWindowMinutes(activity.accountedWindowMinutes)
  const measured = validWindowMinutes(activity.measuredWindowMinutes)
  const registeredGaps = hubActivityRegisteredGapCount(activity)

  // Served span must cover the request via accounted (preferred) or available.
  const coversRequest =
    accounted != null ? accounted >= requested : available === requested
  if (!coversRequest) return false

  // Dishonest contract: measured claims the full window while gaps are registered.
  if (registeredGaps > 0 && measured != null) {
    if (measured >= requested) return false
    if (accounted != null && measured >= accounted) return false
  }

  return true
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
 * True only when a healthy historical projection has no registered gaps and
 * measured coverage (when present) spans the full request. Never true when
 * registeredGapCount > 0.
 */
export function isHubActivityFullyMeasured(activity: HubActivity): boolean {
  if (!isHubActivityHealthyHistoricalProjection(activity)) return false
  if (hubActivityRegisteredGapCount(activity) > 0) return false
  const requested = validWindowMinutes(activity.windowMinutes)
  if (requested == null) return false
  const measured = validWindowMinutes(activity.measuredWindowMinutes)
  if (measured != null) return measured >= requested
  // Legacy healthy projection without measured/accounted fields and zero gaps.
  return true
}

/**
 * Chart / fill grid window. When degraded, use availableWindowMinutes so we do
 * not fabricate missing historical buckets across the requested 24h/7d/30d span.
 * When healthy with attested gaps, prefer accounted (else requested) so gap
 * markers remain visible in the served window.
 * Requested windowMinutes stays on the payload for range-tab identity.
 */
export function resolveHubActivityChartWindowMinutes(activity: HubActivity): number {
  const requested = Math.max(1, activity.windowMinutes || 30)
  if (isHubActivityHealthyHistoricalProjection(activity)) {
    const accounted = validWindowMinutes(activity.accountedWindowMinutes)
    return accounted != null ? Math.min(requested, accounted) : requested
  }

  const available = validWindowMinutes(activity.availableWindowMinutes)
  if (available != null) {
    // A contract-bearing payload that is not explicitly healthy must not expand
    // an available served span into a requested historical grid.
    return Math.min(requested, available)
  }
  if (isHubActivityLivePoolFallback(activity)) {
    return Math.min(requested, 30)
  }

  // Legacy payloads have no honesty metadata, but a long, timestamp-spanning
  // point series is enough evidence to preserve the requested chart grid.
  const firstPoint = activity.points?.[0]?.t
  const lastPoint = activity.points?.[activity.points.length - 1]?.t
  const pointSpanMs = (lastPoint ?? 0) - (firstPoint ?? 0)
  if (
    requested > 30 &&
    activity.points &&
    activity.points.length >= 20 &&
    Number.isFinite(pointSpanMs) &&
    pointSpanMs >= requested * 60_000 * 0.4
  ) {
    return requested
  }

  // Legacy / incomplete payloads without honesty metadata must not expand a
  // long requested window into a fabricated historical chart grid.
  return Math.min(requested, 30)
}

/** Short status chip / banner label for degraded pool-only activity. */
export function hubActivityHonestyChipLabel(activity: HubActivity): string | null {
  if (isHubActivityLivePoolFallback(activity)) return 'Recent live activity only'
  const gaps = hubActivityRegisteredGapCount(activity)
  if (gaps > 0 && isHubActivityHealthyHistoricalProjection(activity)) {
    return gaps === 1 ? '1 attested gap' : `${gaps} attested gaps`
  }
  return null
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

/** Longer explanation for title/tooltip when degraded or attested gaps exist. */
export function hubActivityHonestyDetail(activity: HubActivity): string | null {
  if (isHubActivityLivePoolFallback(activity)) {
    const requested = formatActivityWindowLabel(Math.max(1, activity.windowMinutes || 30))
    const availableMinutes = resolveHubActivityChartWindowMinutes(activity)
    const available = formatActivityWindowLabel(availableMinutes)
    return `Historical ${requested} projection unavailable — showing last ${available} of live-pool activity only. Missing history is not invented.`
  }

  const gaps = hubActivityRegisteredGapCount(activity)
  if (gaps > 0 && isHubActivityHealthyHistoricalProjection(activity)) {
    const measured =
      validWindowMinutes(activity.measuredWindowMinutes) ??
      Math.max(0, resolveHubActivityChartWindowMinutes(activity) - gaps)
    const accounted =
      validWindowMinutes(activity.accountedWindowMinutes) ??
      resolveHubActivityChartWindowMinutes(activity)
    return (
      `Accounted ${formatActivityWindowLabel(accounted)} includes ${gaps} attested gap` +
      `${gaps === 1 ? '' : 's'}; measured ${formatActivityWindowLabel(measured)}. ` +
      `Attested gaps are chart breaks — not interpolated or zero-filled as measured data.`
    )
  }
  return null
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
