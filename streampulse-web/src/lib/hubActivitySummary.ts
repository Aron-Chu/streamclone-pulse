import type { HubActivityPoint } from './publicHub'

/** All-provider emote uses for a hub activity bucket (7TV + Twitch + BTTV + FFZ). */
export function hubActivityEmoteCount(point: HubActivityPoint): number {
  return Math.max(point.emotes ?? 0, point.seventv ?? 0, point.twitch ?? 0, point.bttv ?? 0, point.ffz ?? 0)
}

/** Mirrors hubActivityMaxPoints in streamclone internal/analytics/hub_overview.go */
export const HUB_ACTIVITY_MAX_POINTS = 240

/**
 * Expected bucket width in minutes for a hub activity window.
 * Matches hubActivityBucketMinutes on the backend.
 */
export function bucketMinutes(windowMinutes: number): number {
  if (windowMinutes <= HUB_ACTIVITY_MAX_POINTS) return 1
  const bucket = Math.ceil(windowMinutes / HUB_ACTIVITY_MAX_POINTS)
  return bucket < 1 ? 1 : bucket
}

/** Bucket width in ms — matches fillActivityPoints / hubActivitySummary grid. */
export function activityBucketMs(windowMinutes: number): number {
  return Math.max(60_000, Math.ceil(Math.max(1, windowMinutes) / HUB_ACTIVITY_MAX_POINTS) * 60_000)
}

export function activityBucketKey(t: number, windowMinutes: number): number {
  const bucketMs = activityBucketMs(windowMinutes)
  return Math.floor(t / bucketMs) * bucketMs
}

/** True when the bucket period has not ended yet (API flag or client heuristic). */
export function isOpenActivityBucket(
  point: HubActivityPoint,
  windowMinutes: number,
  nowMs: number = Date.now(),
): boolean {
  if (point.bucketComplete === false) return true
  if (point.bucketComplete === true) return false
  const bucketMs = activityBucketMs(windowMinutes)
  return point.t + bucketMs > nowMs
}

/** Floor only the trailing open bucket — never paint a flat line across recent history. */
export function applyLivePoolViewerFloor(
  points: HubActivityPoint[],
  livePoolViewerSum: number | undefined,
  windowMinutes: number,
  nowMs: number = Date.now(),
): HubActivityPoint[] {
  if (!points.length || !livePoolViewerSum || livePoolViewerSum <= 0) {
    return points
  }
  const last = points[points.length - 1]
  if (!last || !isOpenActivityBucket(last, windowMinutes, nowMs)) {
    return points
  }
  const threshold = Math.floor(livePoolViewerSum / 5)
  if (last.viewers >= threshold) {
    return points
  }
  if (!(last.hasChatRollup || last.chat > 0 || (last.emotes ?? 0) > 0)) {
    return points
  }
  const out = points.slice()
  out[out.length - 1] = {
    ...last,
    viewers: livePoolViewerSum,
    hasViewerRollup: true,
  }
  return out
}

/** Drop the trailing in-progress bucket so chart peaks are not skewed by partial data. */
export function dropTrailingOpenBucket(
  points: HubActivityPoint[],
  windowMinutes: number,
  nowMs: number = Date.now(),
): HubActivityPoint[] {
  if (points.length === 0) return points
  const last = points[points.length - 1]
  if (last && isOpenActivityBucket(last, windowMinutes, nowMs)) {
    return points.slice(0, -1)
  }
  return points
}

/** Sparse API series → chart grid, omitting the open bucket and applying per-minute rates. */
export function chartActivityPoints(
  points: HubActivityPoint[],
  windowMinutes: number,
  nowMs?: number,
  livePoolViewerSum?: number,
): HubActivityPoint[] {
  const floored = applyLivePoolViewerFloor(points, livePoolViewerSum, windowMinutes)
  const trimmed = dropTrailingOpenBucket(floored, windowMinutes, nowMs ?? Date.now())
  return normalizeActivityPointsForChart(trimmed, windowMinutes)
}

/** Merge a sparse hub activity series onto an evenly spaced bucket grid for charting. */
export function fillActivityPoints(points: HubActivityPoint[], windowMinutes: number): HubActivityPoint[] {
  if (points.length === 0) return []
  const bucketMs = activityBucketMs(windowMinutes)
  const lastT = points[points.length - 1]?.t ?? Date.now()
  const alignedEnd = activityBucketKey(lastT, windowMinutes)
  const bucketCount = Math.min(HUB_ACTIVITY_MAX_POINTS, Math.max(2, Math.ceil(windowMinutes / bucketMinutes(windowMinutes))))
  const alignedStart = alignedEnd - (bucketCount - 1) * bucketMs

  const byBucket = new Map<number, HubActivityPoint>()
  for (const point of points) {
    const key = activityBucketKey(point.t, windowMinutes)
    const existing = byBucket.get(key)
    if (!existing || point.t >= existing.t) {
      byBucket.set(key, {
        ...point,
        // Preserve the API's three-valued measurement flags. Legacy payloads
        // omit these fields and must not be rewritten as explicit gap markers.
        hasChatRollup: point.hasChatRollup,
        hasViewerRollup: point.hasViewerRollup,
      })
    }
  }

  const filled: HubActivityPoint[] = []
  for (let i = 0; i < bucketCount; i += 1) {
    const t = alignedStart + i * bucketMs
    filled.push(
      byBucket.get(t) ?? {
        t,
        chat: 0,
        seventv: 0,
        viewers: 0,
        hasChatRollup: false,
        hasViewerRollup: false,
      },
    )
  }
  return filled
}

/** Coarse backend buckets store period totals; chart labels use per-minute rates. */
export function activityPointRates(point: HubActivityPoint, windowMinutes: number): HubActivityPoint {
  const bucketMin = bucketMinutes(windowMinutes)
  if (bucketMin <= 1) return point
  const scale = 1 / bucketMin
  return {
    ...point,
    chat: Math.round(point.chat * scale),
    seventv: Math.round((point.seventv ?? 0) * scale),
    twitch: point.twitch != null ? Math.round(point.twitch * scale) : undefined,
    bttv: point.bttv != null ? Math.round(point.bttv * scale) : undefined,
    ffz: point.ffz != null ? Math.round(point.ffz * scale) : undefined,
    emotes: point.emotes != null ? Math.round(point.emotes * scale) : undefined,
  }
}

export function normalizeActivityPointsForChart(
  points: HubActivityPoint[],
  windowMinutes: number,
): HubActivityPoint[] {
  const filled = fillActivityPoints(points, windowMinutes)
  if (bucketMinutes(windowMinutes) <= 1) return filled
  return filled.map((point) => activityPointRates(point, windowMinutes))
}

/** Peak concurrent global viewers — same series as HubActivityChart tooltips. */
export function peakActivityViewers(points: HubActivityPoint[], windowMinutes: number): number {
  return chartActivityPoints(points, windowMinutes).reduce(
    (max, point) => Math.max(max, point.viewers),
    0,
  )
}

/** Peak tracked IRC chat/min after coarse-bucket normalization — matches chart tooltip chat. */
export function peakActivityChatPerMin(points: HubActivityPoint[], windowMinutes: number): number {
  return chartActivityPoints(points, windowMinutes).reduce(
    (max, point) => Math.max(max, point.chat),
    0,
  )
}

/** Peak network emotes/min after coarse-bucket normalization — matches chart tooltip emotes. */
export function peakActivityEmotesPerMin(points: HubActivityPoint[], windowMinutes: number): number {
  return chartActivityPoints(points, windowMinutes).reduce(
    (max, point) => Math.max(max, hubActivityEmoteCount(point)),
    0,
  )
}

function chartPointHasSignal(point: HubActivityPoint): boolean {
  return (
    point.chat > 0 ||
    point.seventv > 0 ||
    (point.emotes ?? 0) > 0 ||
    (point.twitch ?? 0) > 0 ||
    point.viewers > 0
  )
}

/**
 * Resolve chart bucket click — no live-horizon guard; historical buckets are selectable.
 * Returns null to clear selection, undefined to ignore, or bucket timestamp to select.
 */
export function resolveChartBucketSelection(
  point: HubActivityPoint | undefined,
  selectedBucketT: number | null | undefined,
): number | null | undefined {
  if (!point) return undefined
  if (selectedBucketT != null && point.t === selectedBucketT) return null
  if (!chartPointHasSignal(point)) return undefined
  return point.t
}

/** Max gap between adjacent points before the chart breaks the line (aligned with HubActivityChart). */
export function maxConnectedGapMs(windowMinutes: number): number {
  return Math.max(5 * 60_000, activityBucketMs(windowMinutes) * 2.5)
}

/** Count corpus gaps where stored rollups are missing between adjacent buckets. */
export function internalGapCount(points: Pick<HubActivityPoint, 't'>[], windowMinutes: number): number {
  if (points.length < 2) return 0
  const maxGap = maxConnectedGapMs(windowMinutes)
  let gaps = 0
  for (let i = 1; i < points.length; i += 1) {
    if ((points[i]?.t ?? 0) - (points[i - 1]?.t ?? 0) > maxGap) gaps += 1
  }
  return gaps
}

function activePoint(point: HubActivityPoint): boolean {
  return point.chat > 0 || point.seventv > 0 || Math.max(point.emotes ?? 0, point.seventv ?? 0) > 0
}

export function formatActivityWindowLabel(minutes: number): string {
  if (minutes >= 60 * 24 * 365) {
    const n = Math.round(minutes / (60 * 24 * 365))
    return n === 1 ? '1 year' : `${n} years`
  }
  if (minutes >= 60 * 24 * 30) {
    const n = Math.round(minutes / (60 * 24 * 30))
    return n === 1 ? '1 month' : `${n} months`
  }
  if (minutes >= 60 * 24) {
    const n = Math.round(minutes / (60 * 24))
    return n === 1 ? '1 day' : `${n} days`
  }
  if (minutes >= 60) {
    const n = Math.round(minutes / 60)
    return n === 1 ? '1 hour' : `${n} hours`
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/** Format a hub activity chart x-axis tick based on the selected window width. */
export function formatActivityAxisTick(ts: number, windowMinutes: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const date = new Date(ts)
  if (windowMinutes <= 60 * 24) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  if (windowMinutes <= 60 * 24 * 7) {
    return date.toLocaleDateString([], { weekday: 'short', hour: 'numeric' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Evenly spaced point indices for hub activity chart x-axis ticks (max 8). */
export function activityAxisTickIndices(pointCount: number, maxTicks = 8): number[] {
  if (pointCount <= 0) return []
  if (pointCount === 1) return [0]
  const numTicks = Math.min(maxTicks, pointCount)
  const indices: number[] = []
  for (let i = 0; i < numTicks; i += 1) {
    indices.push(Math.round((i / (numTicks - 1)) * (pointCount - 1)))
  }
  return indices
}

export interface ActivitySummary {
  pointCount: number
  expectedBuckets: number
  missingBuckets: number
  coveragePct: number
  nonZeroCount: number
  gapCount: number
  bucketMinutes: number
  windowLabel: string
  footnote: string
}

export function summarizeActivity(
  points: HubActivityPoint[],
  windowMinutes: number,
  poolSize: number,
  updatedAgo?: string,
): ActivitySummary {
  const pointCount = points.length
  const safeWindow = Math.max(1, windowMinutes)
  const nonZeroCount = points.filter(activePoint).length
  const gapCount = internalGapCount(points, windowMinutes)
  const bucket = bucketMinutes(windowMinutes)
  const expectedBuckets = Math.min(HUB_ACTIVITY_MAX_POINTS, Math.ceil(safeWindow / bucket))
  const missingBuckets = Math.max(0, expectedBuckets - pointCount)
  const coveragePct = expectedBuckets > 0 ? (pointCount / expectedBuckets) * 100 : 0
  const windowLabel = formatActivityWindowLabel(windowMinutes)
  const updatedSuffix = updatedAgo ? ` · updated ${updatedAgo}` : ''
  const poolLabel = poolSize > 0 ? `${poolSize} channels in live pool` : 'live pool'
  const footnote = `${pointCount}/${expectedBuckets} buckets · ~${bucket} min each · network rollups · ${poolLabel}${updatedSuffix}`

  return {
    pointCount,
    expectedBuckets,
    missingBuckets,
    coveragePct,
    nonZeroCount,
    gapCount,
    bucketMinutes: bucket,
    windowLabel,
    footnote,
  }
}
