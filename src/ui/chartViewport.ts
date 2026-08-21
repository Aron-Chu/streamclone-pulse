import type { ExtensionRollup } from '../shared/messages.ts'
import {
  chartBucketRanges,
  downsampleRollupsForChart,
  type ChartRepresentativeSignal,
} from './extensionChartPoints.ts'

export interface ChartViewport {
  startSeconds: number
  endSeconds: number
}

export const FOLLOW_LIVE_EPSILON_SECONDS = 5

export const MIN_VIEWPORT_SECONDS = 5 * 60

export function viewportDurationSeconds(viewport: ChartViewport): number {
  return Math.max(0, viewport.endSeconds - viewport.startSeconds)
}

export function viewportCenterSeconds(viewport: ChartViewport): number {
  return (viewport.startSeconds + viewport.endSeconds) / 2
}

export function isFollowingLive(
  viewport: ChartViewport,
  durationSeconds: number,
  epsilon = FOLLOW_LIVE_EPSILON_SECONDS,
): boolean {
  if (durationSeconds <= 0) return false
  return durationSeconds - viewport.endSeconds <= epsilon
}

/**
 * True when there is nothing further right to scroll to: either the viewport reaches
 * the end, or it already spans the whole timeline. Callers use this to hide the
 * jump-to-end affordance, so it must stay tolerant of a caller duration that differs
 * slightly from the one the chart clamps zoom against.
 */
export function isViewportAtTimelineEnd(
  viewport: ChartViewport,
  durationSeconds: number,
  epsilon = FOLLOW_LIVE_EPSILON_SECONDS,
): boolean {
  if (durationSeconds <= 0) return true
  if (viewportDurationSeconds(viewport) >= durationSeconds - epsilon) return true
  return isFollowingLive(viewport, durationSeconds, epsilon)
}

export interface ResolveViewportArgs {
  durationSeconds: number
  zoomSeconds: number | 'full'
  anchorSeconds?: number
  currentViewport?: ChartViewport
  followEnd?: boolean
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function safeZoom(zoomSeconds: number): number {
  if (!Number.isFinite(zoomSeconds) || zoomSeconds <= 0) return 0
  return zoomSeconds
}

export function resolveViewport(args: ResolveViewportArgs): ChartViewport {
  const {
    durationSeconds,
    zoomSeconds,
    anchorSeconds,
    currentViewport,
    followEnd,
  } = args
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  if (zoomSeconds === 'full') {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  if (durationSeconds < MIN_VIEWPORT_SECONDS) {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  const rawZoom = Math.min(safeZoom(zoomSeconds), durationSeconds)
  if (rawZoom <= 0) return { startSeconds: 0, endSeconds: durationSeconds }
  const zoom = clamp(rawZoom, MIN_VIEWPORT_SECONDS, durationSeconds)
  const candidateAnchor =
    anchorSeconds
    ?? (followEnd && currentViewport ? Math.min(durationSeconds, currentViewport.endSeconds) : undefined)
    ?? viewportCenterSeconds(
      currentViewport ?? { startSeconds: 0, endSeconds: durationSeconds },
    )
  const rawStart = candidateAnchor - zoom / 2
  const maxStart = Math.max(0, durationSeconds - zoom)
  const startSeconds = clamp(rawStart, 0, maxStart)
  const endSeconds = startSeconds + zoom
  return { startSeconds, endSeconds }
}

export function panViewport(
  viewport: ChartViewport,
  deltaSeconds: number,
  durationSeconds: number,
  clampToFull = true,
): ChartViewport {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const duration = viewportDurationSeconds(viewport)
  if (duration <= 0) {
    if (clampToFull) return { startSeconds: 0, endSeconds: durationSeconds }
    return viewport
  }
  if (clampToFull && duration >= durationSeconds) {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  const maxStart = Math.max(0, durationSeconds - duration)
  const rawStart = viewport.startSeconds + deltaSeconds
  const startSeconds = clamp(rawStart, 0, maxStart)
  return { startSeconds, endSeconds: startSeconds + duration }
}

export interface ZoomViewportArgs {
  viewport: ChartViewport
  zoomSeconds: number
  anchorSeconds?: number
  durationSeconds: number
}

export function zoomViewport(args: ZoomViewportArgs): ChartViewport {
  const { viewport, zoomSeconds, anchorSeconds, durationSeconds } = args
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  if (durationSeconds < MIN_VIEWPORT_SECONDS) {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  const rawZoom = Math.min(safeZoom(zoomSeconds), durationSeconds)
  if (rawZoom <= 0) return { startSeconds: 0, endSeconds: durationSeconds }
  const zoom = clamp(rawZoom, MIN_VIEWPORT_SECONDS, durationSeconds)
  const currentDuration = viewportDurationSeconds(viewport)
  const anchor = anchorSeconds ?? viewportCenterSeconds(viewport)
  if (currentDuration <= 0) {
    const maxStart = Math.max(0, durationSeconds - zoom)
    const start = clamp(anchor - zoom / 2, 0, maxStart)
    return { startSeconds: start, endSeconds: start + zoom }
  }
  const fractional = (anchor - viewport.startSeconds) / currentDuration
  const desiredStart = anchor - fractional * zoom
  const maxStart = Math.max(0, durationSeconds - zoom)
  const startSeconds = clamp(desiredStart, 0, maxStart)
  return { startSeconds, endSeconds: startSeconds + zoom }
}

/** First index with offsetSeconds >= target, assuming rollups are offset-ordered. */
function lowerBoundByOffset(rollups: ExtensionRollup[], target: number): number {
  let lo = 0
  let hi = rollups.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((rollups[mid]?.offsetSeconds ?? 0) < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Canonical visible rows using binary bounds; selection still resolves by raw offset. */
export function viewportRollupSlice(
  rollups: ExtensionRollup[],
  viewport: ChartViewport,
): ExtensionRollup[] {
  if (rollups.length === 0 || viewport.endSeconds < viewport.startSeconds) return []
  const from = lowerBoundByOffset(rollups, viewport.startSeconds)
  let lo = from
  let hi = rollups.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((rollups[mid]?.offsetSeconds ?? 0) <= viewport.endSeconds) lo = mid + 1
    else hi = mid
  }
  return rollups.slice(from, lo)
}

function nearestRollupIndexByOffset(rollups: ExtensionRollup[], target: number): number {
  if (rollups.length === 0 || !Number.isFinite(target)) return -1
  let best = 0
  let bestDistance = Math.abs((rollups[0]?.offsetSeconds ?? 0) - target)
  for (let index = 1; index < rollups.length; index += 1) {
    const distance = Math.abs((rollups[index]?.offsetSeconds ?? 0) - target)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

export function viewportBuckets(
  minuteRollups: ExtensionRollup[],
  viewport: ChartViewport,
  targetBuckets: number,
  /** Raw offsets that must remain visible (for pinned/refined moments). */
  preserveOffsets: readonly number[] = [],
  /** Which signal should own the shared representative row when LOD is active. */
  representativeSignal: ChartRepresentativeSignal = 'activity',
): ExtensionRollup[] {
  if (minuteRollups.length === 0) return []
  if (targetBuckets <= 0) return []
  const start = viewport.startSeconds
  const end = viewport.endSeconds
  if (end <= start) return []
  // Rollups are offset-ordered, so bound the window instead of scanning every minute:
  // this runs on every wheel-zoom and pan frame.
  const filtered = viewportRollupSlice(minuteRollups, { startSeconds: start, endSeconds: end })
  // Bucket windows are half-open so adjacent viewports never claim the same
  // minute. The raw display slice stays end-inclusive for chart pins/ticks.
  while ((filtered[filtered.length - 1]?.offsetSeconds ?? Number.NEGATIVE_INFINITY) >= end) {
    filtered.pop()
  }
  if (filtered.length === 0) return []
  if (filtered.length <= targetBuckets) return filtered
  const sampled = downsampleRollupsForChart(filtered, targetBuckets, representativeSignal)
  if (preserveOffsets.length === 0 || sampled.length === 0) return sampled

  // Downsampling is presentation-only. If the user has a selected/refined
  // moment inside this window, replace that bucket's representative with the
  // exact source rollup so the pin does not disappear or drift to a nearby
  // display peak. Keep the output length and bucket ordering stable because
  // overlay aggregation uses the same source ranges.
  const ranges = chartBucketRanges(filtered, targetBuckets)
  const claimedBuckets = new Set<number>()
  for (const offset of preserveOffsets) {
    if (!Number.isFinite(offset)) continue
    const firstOffset = filtered[0]?.offsetSeconds ?? 0
    const lastOffset = filtered[filtered.length - 1]?.offsetSeconds ?? firstOffset
    if (offset < firstOffset || offset > lastOffset + 60) continue
    const exactIndex = filtered.findIndex(rollup => rollup.offsetSeconds === offset)
    const sourceIndex = exactIndex >= 0 ? exactIndex : nearestRollupIndexByOffset(filtered, offset)
    if (sourceIndex < 0) continue
    const bucketIndex = ranges.findIndex(({ start, end }) => sourceIndex >= start && sourceIndex < end)
    if (bucketIndex < 0 || bucketIndex >= sampled.length || claimedBuckets.has(bucketIndex)) continue
    sampled[bucketIndex] = filtered[sourceIndex]!
    claimedBuckets.add(bucketIndex)
  }
  return sampled
}

/**
 * Sidebar chart dialect: readable ~4px buckets. Hover and pin resolve by nearest
 * index off the capture rect, not per-rect hit testing.
 */
export const SIDEBAR_CHART_PX_PER_BUCKET = 4
export const SIDEBAR_CHART_MAX_BUCKETS = 260
/** Typical docked plot width used when estimating pin/peak bucket tolerance. */
export const SIDEBAR_CHART_PLOT_WIDTH_PX = 300

export function targetBucketCount(
  plotWidth: number,
  viewportMinutes: number,
  maxBuckets = SIDEBAR_CHART_MAX_BUCKETS,
): number {
  if (viewportMinutes <= 0) return 0
  if (plotWidth <= 0) return 0
  const derived = Math.round(plotWidth / SIDEBAR_CHART_PX_PER_BUCKET)
  const clampedDerived = Math.min(maxBuckets, Math.max(24, derived))
  return Math.min(viewportMinutes, clampedDerived)
}

export interface RailGeometry {
  thumbX: number
  thumbWidth: number
  totalWidth: number
}

export function railGeometry(
  viewport: ChartViewport,
  durationSeconds: number,
  railWidth: number,
): RailGeometry {
  if (durationSeconds <= 0 || railWidth <= 0) {
    return { thumbX: 0, thumbWidth: railWidth, totalWidth: railWidth }
  }
  const viewportDuration = viewportDurationSeconds(viewport)
  if (viewportDuration <= 0 || viewportDuration >= durationSeconds) {
    return { thumbX: 0, thumbWidth: railWidth, totalWidth: railWidth }
  }
  const rawThumbX = (viewport.startSeconds / durationSeconds) * railWidth
  const rawThumbWidth = (viewportDuration / durationSeconds) * railWidth
  const thumbWidth = Math.max(8, Math.min(railWidth, rawThumbWidth))
  const maxX = Math.max(0, railWidth - thumbWidth)
  const thumbX = Math.min(maxX, Math.max(0, rawThumbX))
  return { thumbX, thumbWidth, totalWidth: railWidth }
}

export function railThumbRange(viewport: ChartViewport, durationSeconds: number): {
  startPct: number
  endPct: number
} {
  if (durationSeconds <= 0) return { startPct: 0, endPct: 1 }
  const startPct = Math.min(1, Math.max(0, viewport.startSeconds / durationSeconds))
  const endPct = Math.min(1, Math.max(0, viewport.endSeconds / durationSeconds))
  if (endPct < startPct) return { startPct: endPct, endPct: startPct }
  return { startPct, endPct }
}

export function jumpToOffset(
  viewport: ChartViewport,
  offsetSeconds: number,
  durationSeconds: number,
  zoomSeconds: number | 'full',
): ChartViewport {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  if (zoomSeconds === 'full' || !Number.isFinite(zoomSeconds)) {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  if (durationSeconds < MIN_VIEWPORT_SECONDS) {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  const rawZoom = Math.min(zoomSeconds, durationSeconds)
  if (rawZoom <= 0) return { startSeconds: 0, endSeconds: durationSeconds }
  const zoom = clamp(rawZoom, MIN_VIEWPORT_SECONDS, durationSeconds)
  const clampedOffset = Math.max(0, Math.min(durationSeconds, offsetSeconds))
  const maxStart = Math.max(0, durationSeconds - zoom)
  const rawStart = clampedOffset - zoom / 2
  const startSeconds = clamp(rawStart, 0, maxStart)
  return { startSeconds, endSeconds: startSeconds + zoom }
}

export interface WheelZoomArgs {
  viewport: ChartViewport
  deltaY: number
  deltaMode?: number
  anchorSeconds?: number
  durationSeconds: number
}

const WHEEL_LINE_HEIGHT_PX = 16
const WHEEL_PAGE_HEIGHT_PX = 400
const WHEEL_ZOOM_SENSITIVITY = 0.002
/** Per-frame ceiling keeps tiny trackpad deltas calm and large wheel ticks predictable. */
export const WHEEL_ZOOM_MIN_RATIO = 0.85
export const WHEEL_ZOOM_MAX_RATIO = 1.18

export function wheelZoomRatio(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const pixels = deltaMode === 1
    ? deltaY * WHEEL_LINE_HEIGHT_PX
    : deltaMode === 2
      ? deltaY * WHEEL_PAGE_HEIGHT_PX
      : deltaY
  return clamp(
    Math.exp(pixels * WHEEL_ZOOM_SENSITIVITY),
    WHEEL_ZOOM_MIN_RATIO,
    WHEEL_ZOOM_MAX_RATIO,
  )
}

export function wheelZoom(args: WheelZoomArgs): ChartViewport {
  const { viewport, deltaY, deltaMode = 0, anchorSeconds, durationSeconds } = args
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const currentDuration = viewportDurationSeconds(viewport)
  if (currentDuration <= 0) {
    return { startSeconds: 0, endSeconds: durationSeconds }
  }
  const ratio = wheelZoomRatio(deltaY, deltaMode)
  if (ratio === 1) return viewport
  const desired = clamp(currentDuration * ratio, MIN_VIEWPORT_SECONDS, durationSeconds)
  if (desired === currentDuration) return viewport
  return zoomViewport({
    viewport,
    zoomSeconds: desired,
    anchorSeconds: anchorSeconds ?? viewportCenterSeconds(viewport),
    durationSeconds,
  })
}
