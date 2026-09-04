import type { HubActivityPoint, HubViewerCoverage } from './publicHub'

/** Client chart-grid placeholder — keep in sync with hubActivityHonesty. */
const GAP_KIND_UNMEASURED = 'unmeasured'

function isGapMarker(point: Pick<HubActivityPoint, 'gapKind'>): boolean {
  return point.gapKind === 'attested' || point.gapKind === GAP_KIND_UNMEASURED
}

/**
 * Chart transforms need a chronological series. The public API contract
 * normally returns points in order, but a stale/merged cache or a legacy
 * fallback can contain rows out of order. Keep the raw payload unchanged for
 * diagnostics; normalize only at the chart boundary so the latest row is
 * reliably treated as the trailing bucket and x positions never run
 * backwards.
 */
function sortActivityPoints(points: HubActivityPoint[]): HubActivityPoint[] {
  return points
    .map((point, index) => ({ point, index }))
    .sort((left, right) => left.point.t - right.point.t || left.index - right.index)
    .map(({ point }) => point)
}

/** All-provider emote uses for a hub activity bucket (7TV + Twitch + BTTV + FFZ). */
export function hubActivityEmoteCount(point: HubActivityPoint): number {
  // The backend's `emotes` field is the all-provider total. Provider columns
  // are supporting lanes and may be partial on legacy payloads, so never let a
  // larger individual lane overwrite an explicit total.
  if (typeof point.emotes === 'number' && Number.isFinite(point.emotes)) {
    return Math.max(0, point.emotes)
  }
  return Math.max(
    point.emotes ?? 0,
    point.seventv ?? 0,
    point.twitch ?? 0,
    point.bttv ?? 0,
    point.ffz ?? 0,
    point.other ?? 0,
  )
}

export type ViewerSampleQuality = 'complete' | 'partial' | 'unknown' | 'legacy'

export interface ViewerCoverageAssessment {
  /** A viewer observation exists, including an explicit measured zero. */
  sampled: boolean
  /** This observation can participate in a continuous global viewer line. */
  qualified: boolean
  quality: ViewerSampleQuality
  contributors?: number
  expectedContributors?: number
  coveragePct?: number
}

function nonNegativeFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function viewerCoverageDetail(point: HubActivityPoint): HubViewerCoverage | undefined {
  return point.viewerCoverageDetail
}

function explicitViewerCoverage(point: HubActivityPoint): boolean {
  return (
    point.viewerCoverage != null ||
    point.viewerCoveragePct != null ||
    point.viewerContributors != null ||
    point.viewerExpectedContributors != null ||
    point.viewerComplete != null ||
    point.viewerCoverageDetail != null
  )
}

function normalizeViewerCoverageState(value: unknown): ViewerSampleQuality | undefined {
  if (typeof value !== 'string') return undefined
  const state = value.trim().toLowerCase()
  if (state === 'complete' || state === 'full' || state === 'qualified' || state === 'measured') return 'complete'
  if (state === 'partial' || state === 'incomplete' || state === 'sparse' || state === 'degraded') return 'partial'
  if (state === 'unknown' || state === 'unavailable' || state === 'none') return 'unknown'
  return undefined
}

/**
 * Resolve the viewer truth contract without guessing from the magnitude of a
 * sum. Explicit backend coverage metadata wins; legacy rows are retained as a
 * compatibility state until the backend emits the new fields.
 */
export function assessViewerCoverage(point: HubActivityPoint): ViewerCoverageAssessment {
  const detail = viewerCoverageDetail(point)
  const contributors = nonNegativeFinite(point.viewerContributors ?? detail?.contributors)
  const expectedContributors = nonNegativeFinite(
    point.viewerExpectedContributors ?? detail?.expectedContributors,
  )
  const coveragePct = nonNegativeFinite(point.viewerCoveragePct ?? detail?.coveragePct)
  const state = normalizeViewerCoverageState(point.viewerCoverage ?? detail?.state)
  const explicitComplete = point.viewerComplete ?? detail?.complete
  const hasValue = point.viewers > 0 || point.hasViewerRollup === true
  const explicitMeasuredZero = point.hasViewerRollup === true
  const sampled = explicitMeasuredZero || hasValue || contributors != null
  const derivedCoveragePct =
    contributors != null && expectedContributors != null && expectedContributors > 0
      ? Math.min(100, (contributors / expectedContributors) * 100)
      : undefined
  const resolvedCoveragePct = coveragePct ?? derivedCoveragePct

  if (!sampled) {
    return {
      sampled: false,
      qualified: false,
      quality: state ?? 'unknown',
      contributors,
      expectedContributors,
      coveragePct,
    }
  }

  if (explicitComplete === true || state === 'complete') {
    return {
      sampled: true,
      qualified: true,
      quality: 'complete',
      contributors,
      expectedContributors,
      coveragePct: resolvedCoveragePct,
    }
  }
  if (explicitComplete === false || state === 'partial') {
    return {
      sampled: true,
      qualified: false,
      quality: 'partial',
      contributors,
      expectedContributors,
      coveragePct: resolvedCoveragePct,
    }
  }
  if (state === 'unknown') {
    return { sampled: true, qualified: false, quality: 'unknown', contributors, expectedContributors, coveragePct }
  }

  if (contributors != null && expectedContributors != null && expectedContributors > 0) {
    const complete = contributors >= expectedContributors
    return {
      sampled: true,
      qualified: complete,
      quality: complete ? 'complete' : 'partial',
      contributors,
      expectedContributors,
      coveragePct: resolvedCoveragePct,
    }
  }
  if (coveragePct != null) {
    const complete = coveragePct >= 100
    return {
      sampled: true,
      qualified: complete,
      quality: complete ? 'complete' : 'partial',
      contributors,
      expectedContributors,
      coveragePct,
    }
  }

  // Legacy viewer rows are known observations but have no population
  // denominator. Older payloads often omitted `hasViewerRollup` and only
  // carried a positive value, so keep that compatibility path plottable while
  // exposing the legacy quality to callers so the UI can label it honestly.
  if (!explicitViewerCoverage(point) && (point.hasViewerRollup === true || point.viewers > 0)) {
    return { sampled: true, qualified: true, quality: 'legacy' }
  }
  return { sampled: true, qualified: false, quality: 'unknown', contributors, expectedContributors, coveragePct }
}

export function hasViewerSample(point: HubActivityPoint): boolean {
  return assessViewerCoverage(point).sampled
}

export function isViewerCoverageQualified(point: HubActivityPoint): boolean {
  return assessViewerCoverage(point).qualified
}

export function isViewerCoveragePartial(point: HubActivityPoint): boolean {
  const assessment = assessViewerCoverage(point)
  return assessment.sampled && !assessment.qualified
}

/** Stable provider aliases used by both legacy and projection payloads. */
export type HubProviderLaneKey = 'sevenTv' | 'twitch' | 'bttv' | 'ffz'

function providerCoverageEntry(point: HubActivityPoint, key: HubProviderLaneKey): unknown {
  const map = point.providerCoverage
  if (!map) return undefined
  const aliases = key === 'sevenTv' ? ['seventv', '7tv', 'sevenTv'] : [key]
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(map, alias)) return map[alias]
  }
  return undefined
}

/** Whether one provider's value is a measured observation in this bucket. */
export function hasProviderSample(point: HubActivityPoint, key: HubProviderLaneKey): boolean {
  // Client-created grid placeholders carry zero-valued fields for the shape,
  // but they are not provider observations. Never let those placeholders turn
  // a sparse lane into an apparently complete flat zero signal.
  if (isGapMarker(point)) return false
  const value = point[key === 'sevenTv' ? 'seventv' : key]
  const hasValue = typeof value === 'number' && Number.isFinite(value)
  const explicit = providerCoverageEntry(point, key)
  // Coverage metadata cannot manufacture the corresponding metric. A
  // measured-zero provider is represented by an explicit numeric zero; an
  // omitted count remains unavailable even when an aggregate state says the
  // provider was expected.
  if (typeof explicit === 'boolean') return explicit && hasValue
  if (typeof explicit === 'string') {
    const state = explicit.trim().toLowerCase()
    if (state === 'unknown' || state === 'unavailable' || state === 'none') return false
    if (state === 'complete' || state === 'partial' || state === 'measured' || state === 'available') return hasValue
  }
  if (explicit && typeof explicit === 'object') {
    const detail = explicit as { measured?: unknown; state?: unknown }
    if (typeof detail.measured === 'boolean') return detail.measured && hasValue
    if (typeof detail.state === 'string') {
      const state = detail.state.trim().toLowerCase()
      if (state === 'unknown' || state === 'unavailable' || state === 'none') return false
      if (state === 'complete' || state === 'partial' || state === 'measured' || state === 'available') return hasValue
    }
  }
  // 7TV is always present in the backend point schema (including measured
  // zero). Optional provider fields preserve omission so zero is not invented.
  if (key === 'sevenTv') return typeof point.seventv === 'number' && Number.isFinite(point.seventv)
  return hasValue
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

export type MomentActivityBucketRelation = 'exact' | 'nearest_completed'

export interface MomentActivityBucketResolution {
  bucketT: number
  relation: MomentActivityBucketRelation
}

/**
 * Match a detected moment to a chart bucket without inventing activity.
 *
 * A moment in the chart's trailing open interval cannot have an exact rendered
 * bucket because that incomplete point is intentionally omitted. In that one
 * case we let the activity rail inspect the immediately preceding completed
 * bucket and disclose the relationship in the inspector. Older gaps and
 * out-of-range moments fail closed instead of jumping to channel analytics.
 */
export function resolveMomentActivityBucket(
  momentAt: number | null | undefined,
  selectableBucketTs: ReadonlySet<number>,
  windowMinutes: number,
): MomentActivityBucketResolution | null {
  if (momentAt == null || !Number.isFinite(momentAt) || selectableBucketTs.size === 0) {
    return null
  }

  const exactBucketT = activityBucketKey(momentAt, windowMinutes)
  if (selectableBucketTs.has(exactBucketT)) {
    return { bucketT: exactBucketT, relation: 'exact' }
  }

  let previousBucketT: number | null = null
  for (const candidate of selectableBucketTs) {
    if (!Number.isFinite(candidate) || candidate > exactBucketT) continue
    if (previousBucketT == null || candidate > previousBucketT) previousBucketT = candidate
  }

  if (
    previousBucketT != null &&
    exactBucketT - previousBucketT <= activityBucketMs(windowMinutes)
  ) {
    return { bucketT: previousBucketT, relation: 'nearest_completed' }
  }

  return null
}

/** True when the bucket is incomplete for charting (API flag or unconfirmed tip). */
export function isOpenActivityBucket(
  point: HubActivityPoint,
  _windowMinutes: number,
  _nowMs: number = Date.now(),
): boolean {
  // Only explicitly complete buckets stay on the chart tip. Omitted `bucketComplete`
  // (API omitempty for false) previously kept Helix-floored partial tips after the
  // client clock thought the period ended, crashing the emote line.
  return point.bucketComplete !== true
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
  if (isGapMarker(last)) {
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
  const ordered = sortActivityPoints(points)
  // `livePoolViewerSum` is a current-state KPI, not a historical bucket
  // observation. It is intentionally accepted for source compatibility with
  // older callers but must never floor or replace an activity point here.
  void livePoolViewerSum
  const trimmed = dropTrailingOpenBucket(ordered, windowMinutes, nowMs ?? Date.now())
  return normalizeActivityPointsForChart(trimmed, windowMinutes)
}

/** Client-only chart-grid placeholder — never treated as measured data. */
function unmeasuredGridPlaceholder(t: number): HubActivityPoint {
  return {
    t,
    chat: 0,
    seventv: 0,
    viewers: 0,
    hasChatRollup: false,
    hasViewerRollup: false,
    gapKind: GAP_KIND_UNMEASURED,
  }
}

/**
 * Merge a sparse hub activity series onto an evenly spaced bucket grid for charting.
 * Missing buckets become unmeasured placeholders (not measured zeros). Backend
 * attested gap markers (`gapKind: 'attested'`) are preserved and never rewritten
 * as measured samples.
 */
export function fillActivityPoints(points: HubActivityPoint[], windowMinutes: number): HubActivityPoint[] {
  if (points.length === 0) return []
  const ordered = sortActivityPoints(points)
  const bucketMs = activityBucketMs(windowMinutes)
  const lastT = ordered[ordered.length - 1]?.t ?? Date.now()
  const alignedEnd = activityBucketKey(lastT, windowMinutes)
  const bucketCount = Math.min(
    HUB_ACTIVITY_MAX_POINTS,
    Math.max(2, Math.ceil(windowMinutes / bucketMinutes(windowMinutes))),
  )
  const alignedStart = alignedEnd - (bucketCount - 1) * bucketMs

  const byBucket = new Map<number, HubActivityPoint>()
  for (const point of ordered) {
    const key = activityBucketKey(point.t, windowMinutes)
    const existing = byBucket.get(key)
    if (!existing || point.t >= existing.t) {
      byBucket.set(key, {
        ...point,
        // Preserve the API's three-valued measurement flags. Legacy payloads
        // omit these fields and must not be rewritten as explicit gap markers.
        hasChatRollup: point.hasChatRollup,
        hasViewerRollup: point.hasViewerRollup,
        gapKind:
          typeof point.gapKind === 'string' && point.gapKind.trim().length > 0
            ? point.gapKind.trim()
            : undefined,
      })
    }
  }

  const filled: HubActivityPoint[] = []
  for (let i = 0; i < bucketCount; i += 1) {
    const t = alignedStart + i * bucketMs
    filled.push(byBucket.get(t) ?? unmeasuredGridPlaceholder(t))
  }
  return filled
}

/** Coarse backend buckets store period totals; chart labels use per-minute rates. */
export function activityPointRates(point: HubActivityPoint, windowMinutes: number): HubActivityPoint {
  const bucketMin = bucketMinutes(windowMinutes)
  if (bucketMin <= 1) return point
  if (isGapMarker(point) || point.hasChatRollup === false) {
    // Gap markers stay at zero rates — never scale invented totals into "measured".
    return point
  }
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
    (max, point) => Math.max(max, isGapMarker(point) ? 0 : point.viewers),
    0,
  )
}

/** Peak tracked IRC chat/min after coarse-bucket normalization — matches chart tooltip chat. */
export function peakActivityChatPerMin(points: HubActivityPoint[], windowMinutes: number): number {
  return chartActivityPoints(points, windowMinutes).reduce((max, point) => {
    if (point.hasChatRollup === false || isGapMarker(point)) return max
    return Math.max(max, point.chat)
  }, 0)
}

/** Peak network emotes/min after coarse-bucket normalization — matches chart tooltip emotes. */
export function peakActivityEmotesPerMin(points: HubActivityPoint[], windowMinutes: number): number {
  return chartActivityPoints(points, windowMinutes).reduce((max, point) => {
    if (isGapMarker(point)) return max
    return Math.max(max, hubActivityEmoteCount(point))
  }, 0)
}

function chartPointHasSignal(point: HubActivityPoint): boolean {
  if (isGapMarker(point) || point.hasChatRollup === false) return false
  return (
    point.chat > 0 ||
    point.seventv > 0 ||
    (point.emotes ?? 0) > 0 ||
    (point.twitch ?? 0) > 0 ||
    point.viewers > 0
  )
}

export type HubActivityChartState = 'ready' | 'quiet' | 'unmeasured'

/** True when a chart bucket is backed by a measured or backend-attested point. */
export function isMeasuredActivityPoint(point: HubActivityPoint): boolean {
  return !isGapMarker(point)
}

/** True when a measured bucket contains at least one non-zero chart signal. */
export function hasMeasuredActivitySignal(point: HubActivityPoint): boolean {
  if (!isMeasuredActivityPoint(point)) return false
  return (
    point.chat > 0 ||
    point.seventv > 0 ||
    (point.emotes ?? 0) > 0 ||
    (point.twitch ?? 0) > 0 ||
    (point.bttv ?? 0) > 0 ||
    (point.ffz ?? 0) > 0 ||
    point.viewers > 0
  )
}

/**
 * Classify the rendered chart series after sparse points have been normalized.
 * This prevents an SVG shell with no visible data from masquerading as a
 * functioning chart.
 */
export function resolveHubActivityChartState(points: HubActivityPoint[]): HubActivityChartState {
  const measured = points.filter(isMeasuredActivityPoint)
  if (measured.length === 0) return 'unmeasured'
  return measured.some(hasMeasuredActivitySignal) ? 'ready' : 'quiet'
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
  return Math.max(10 * 60_000, activityBucketMs(windowMinutes) * 3)
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
  if (isGapMarker(point)) return false
  return point.chat > 0 || point.seventv > 0 || hubActivityEmoteCount(point) > 0
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
  const safeWindow = Math.max(1, windowMinutes)
  // Summaries are consumed beside the rendered chart. Count the same
  // normalized, open-bucket-trimmed grid that the chart consumes rather than
  // raw API rows. A degraded coarse fallback can contain several minute keys
  // for one bucket; reporting those raw keys produced impossible values such as
  // `161/30 buckets` in the footer.
  const chartPoints = chartActivityPoints(points, safeWindow)
  const pointCount = chartPoints.filter(isMeasuredActivityPoint).length
  const nonZeroCount = chartPoints.filter(activePoint).length
  const gapCount = internalGapCount(chartPoints, safeWindow)
  const bucket = bucketMinutes(windowMinutes)
  const expectedBuckets = Math.min(HUB_ACTIVITY_MAX_POINTS, Math.ceil(safeWindow / bucket))
  const missingBuckets = Math.max(0, expectedBuckets - pointCount)
  const coveragePct = expectedBuckets > 0 ? (pointCount / expectedBuckets) * 100 : 0
  const windowLabel = formatActivityWindowLabel(windowMinutes)
  const updatedSuffix = updatedAgo ? ` · updated ${updatedAgo}` : ''
  const poolLabel = poolSize > 0 ? `${poolSize} channels in tracked pool` : 'tracked pool'
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
