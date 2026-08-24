import type { ExtensionRollup } from '../shared/messages.ts'
import { downsampleRollupsForChart } from './extensionChartPoints.ts'

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
  /** First covered offset. Full/reset/zoom operations never navigate before it. */
  coverageStartSeconds?: number
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

/**
 * Normalize a viewport against the timeline that can actually be plotted.
 *
 * The chart may know the stream duration before it has received the first
 * rollup. Keeping the viewport in the uncovered prefix makes the chart look
 * broken even though valid recent data is present. This helper is deliberately
 * pure so parents, the rail, and wheel/keyboard controls can share the same
 * invariant without relying on a later effect to repair the UI.
 */
export function clampViewportToCoverage(
  viewport: ChartViewport,
  durationSeconds: number,
  coverageStartSeconds = 0,
): ChartViewport {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const coverageStart = clamp(coverageStartSeconds, 0, durationSeconds)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (availableDuration <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }

  const requestedDuration = viewportDurationSeconds(viewport)
  const minimumDuration = requestedDuration > 0
    ? Math.min(requestedDuration, availableDuration)
    : Math.min(MIN_VIEWPORT_SECONDS, availableDuration)
  const span = clamp(
    requestedDuration > 0 ? requestedDuration : availableDuration,
    minimumDuration,
    availableDuration,
  )
  const latestStart = Math.max(coverageStart, durationSeconds - span)
  const startSeconds = clamp(viewport.startSeconds, coverageStart, latestStart)
  return { startSeconds, endSeconds: startSeconds + span }
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
  const coverageStart = clamp(args.coverageStartSeconds ?? 0, 0, durationSeconds)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (availableDuration <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  if (zoomSeconds === 'full') {
    return { startSeconds: coverageStart, endSeconds: durationSeconds }
  }
  if (availableDuration < MIN_VIEWPORT_SECONDS) {
    return { startSeconds: coverageStart, endSeconds: durationSeconds }
  }
  const rawZoom = Math.min(safeZoom(zoomSeconds), availableDuration)
  if (rawZoom <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  const zoom = clamp(rawZoom, MIN_VIEWPORT_SECONDS, availableDuration)
  const candidateAnchor =
    anchorSeconds
    ?? (followEnd && currentViewport ? Math.min(durationSeconds, currentViewport.endSeconds) : undefined)
    ?? viewportCenterSeconds(
      currentViewport ?? { startSeconds: coverageStart, endSeconds: durationSeconds },
    )
  const rawStart = candidateAnchor - zoom / 2
  const maxStart = Math.max(coverageStart, durationSeconds - zoom)
  const startSeconds = clamp(rawStart, coverageStart, maxStart)
  const endSeconds = startSeconds + zoom
  return { startSeconds, endSeconds }
}

export function panViewport(
  viewport: ChartViewport,
  deltaSeconds: number,
  durationSeconds: number,
  clampToFull = true,
  coverageStartSeconds = 0,
): ChartViewport {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const coverageStart = clamp(coverageStartSeconds, 0, durationSeconds)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (availableDuration <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  const normalizedViewport = clampViewportToCoverage(viewport, durationSeconds, coverageStart)
  const duration = viewportDurationSeconds(normalizedViewport)
  if (duration <= 0) {
    if (clampToFull) return { startSeconds: coverageStart, endSeconds: durationSeconds }
    return viewport
  }
  if (clampToFull && duration >= availableDuration) {
    return { startSeconds: coverageStart, endSeconds: durationSeconds }
  }
  const maxStart = Math.max(coverageStart, durationSeconds - duration)
  const rawStart = normalizedViewport.startSeconds + deltaSeconds
  const startSeconds = clamp(rawStart, coverageStart, maxStart)
  return { startSeconds, endSeconds: startSeconds + duration }
}

/** Advance only a viewport that was already following the previous live tail. */
export function advanceFollowingLiveViewport(args: {
  viewport: ChartViewport
  previousDurationSeconds: number
  durationSeconds: number
  coverageStartSeconds?: number
}): ChartViewport {
  const {
    viewport,
    previousDurationSeconds,
    durationSeconds,
    coverageStartSeconds = 0,
  } = args
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const normalized = clampViewportToCoverage(viewport, durationSeconds, coverageStartSeconds)
  if (!isFollowingLive(viewport, previousDurationSeconds)) return normalized
  const span = viewportDurationSeconds(normalized)
  return resolveViewport({
    durationSeconds,
    zoomSeconds: span,
    anchorSeconds: durationSeconds,
    currentViewport: normalized,
    followEnd: true,
    coverageStartSeconds,
  })
}

export interface ZoomViewportArgs {
  viewport: ChartViewport
  zoomSeconds: number
  anchorSeconds?: number
  durationSeconds: number
  coverageStartSeconds?: number
}

export function zoomViewport(args: ZoomViewportArgs): ChartViewport {
  const { viewport, zoomSeconds, anchorSeconds, durationSeconds, coverageStartSeconds = 0 } = args
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const coverageStart = clamp(coverageStartSeconds, 0, durationSeconds)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (availableDuration <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  if (availableDuration < MIN_VIEWPORT_SECONDS) {
    return { startSeconds: coverageStart, endSeconds: durationSeconds }
  }
  const rawZoom = Math.min(safeZoom(zoomSeconds), availableDuration)
  if (rawZoom <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  const zoom = clamp(rawZoom, MIN_VIEWPORT_SECONDS, availableDuration)
  const currentDuration = viewportDurationSeconds(viewport)
  const normalizedViewport = clampViewportToCoverage(viewport, durationSeconds, coverageStart)
  const anchor = anchorSeconds ?? viewportCenterSeconds(normalizedViewport)
  if (currentDuration <= 0) {
    const maxStart = Math.max(coverageStart, durationSeconds - zoom)
    const start = clamp(anchor - zoom / 2, coverageStart, maxStart)
    return { startSeconds: start, endSeconds: start + zoom }
  }
  const baseViewport = (
    viewport.startSeconds >= coverageStart
    && viewport.endSeconds <= durationSeconds
  ) ? viewport : normalizedViewport
  const fractional = (anchor - baseViewport.startSeconds) / Math.max(1, viewportDurationSeconds(baseViewport))
  const desiredStart = anchor - fractional * zoom
  const maxStart = Math.max(coverageStart, durationSeconds - zoom)
  const startSeconds = clamp(desiredStart, coverageStart, maxStart)
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

export function viewportBuckets(
  minuteRollups: ExtensionRollup[],
  viewport: ChartViewport,
  targetBuckets: number,
): ExtensionRollup[] {
  if (minuteRollups.length === 0) return []
  if (targetBuckets <= 0) return []
  const start = viewport.startSeconds
  const end = viewport.endSeconds
  if (end <= start) return []
  // Rollups are offset-ordered, so bound the window instead of scanning every minute:
  // this runs on every wheel-zoom and pan frame.
  const from = lowerBoundByOffset(minuteRollups, start)
  const to = lowerBoundByOffset(minuteRollups, end)
  if (to <= from) return []
  const filtered = minuteRollups.slice(from, to)
  if (filtered.length <= targetBuckets) return filtered
  return downsampleRollupsForChart(filtered, targetBuckets)
}

/**
 * Sidebar chart dialect (v2): portal hairline density (~1.2px slots). Hover and pin
 * resolve by nearest index off the capture rect, not per-rect hit testing, so thin
 * bars do not cost interaction. Material opacities in chartTheme are tuned for this.
 */
export const SIDEBAR_CHART_PX_PER_BUCKET = 1.2
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
  coverageStartSeconds = 0,
): RailGeometry {
  if (durationSeconds <= 0 || railWidth <= 0) {
    return { thumbX: 0, thumbWidth: railWidth, totalWidth: railWidth }
  }
  const normalizedViewport = clampViewportToCoverage(viewport, durationSeconds, coverageStartSeconds)
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  const coverageStart = clamp(coverageStartSeconds, 0, durationSeconds)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (viewportDuration <= 0 || availableDuration <= 0) {
    return { thumbX: 0, thumbWidth: railWidth, totalWidth: railWidth }
  }
  const effectiveStart = viewportDuration >= availableDuration
    ? coverageStart
    : normalizedViewport.startSeconds
  const effectiveDuration = Math.min(viewportDuration, availableDuration)
  const rawThumbX = (effectiveStart / durationSeconds) * railWidth
  const rawThumbWidth = (effectiveDuration / durationSeconds) * railWidth
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
  coverageStartSeconds = 0,
): ChartViewport {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const coverageStart = clamp(coverageStartSeconds, 0, durationSeconds)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (availableDuration <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  if (zoomSeconds === 'full' || !Number.isFinite(zoomSeconds)) {
    return { startSeconds: coverageStart, endSeconds: durationSeconds }
  }
  if (availableDuration < MIN_VIEWPORT_SECONDS) {
    return { startSeconds: coverageStart, endSeconds: durationSeconds }
  }
  const rawZoom = Math.min(zoomSeconds, availableDuration)
  if (rawZoom <= 0) return { startSeconds: coverageStart, endSeconds: durationSeconds }
  const zoom = clamp(rawZoom, MIN_VIEWPORT_SECONDS, availableDuration)
  const clampedOffset = Math.max(coverageStart, Math.min(durationSeconds, offsetSeconds))
  const maxStart = Math.max(coverageStart, durationSeconds - zoom)
  const rawStart = clampedOffset - zoom / 2
  const startSeconds = clamp(rawStart, coverageStart, maxStart)
  return { startSeconds, endSeconds: startSeconds + zoom }
}

export interface WheelZoomArgs {
  viewport: ChartViewport
  deltaY: number
  deltaMode?: number
  anchorSeconds?: number
  durationSeconds: number
  coverageStartSeconds?: number
}

const WHEEL_LINE_HEIGHT_PX = 16
const WHEEL_PAGE_HEIGHT_PX = 400
const WHEEL_ZOOM_SENSITIVITY = 0.0035
/** Per-event ceiling: a trackpad flick emits dozens of deltas and would otherwise slam to the floor. */
export const WHEEL_ZOOM_MAX_RATIO = 1.5

export function wheelZoomRatio(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const pixels = deltaMode === 1
    ? deltaY * WHEEL_LINE_HEIGHT_PX
    : deltaMode === 2
      ? deltaY * WHEEL_PAGE_HEIGHT_PX
      : deltaY
  return clamp(
    Math.exp(pixels * WHEEL_ZOOM_SENSITIVITY),
    1 / WHEEL_ZOOM_MAX_RATIO,
    WHEEL_ZOOM_MAX_RATIO,
  )
}

export function wheelZoom(args: WheelZoomArgs): ChartViewport {
  const { viewport, deltaY, deltaMode = 0, anchorSeconds, durationSeconds, coverageStartSeconds = 0 } = args
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 }
  const normalizedViewport = clampViewportToCoverage(viewport, durationSeconds, coverageStartSeconds)
  const currentDuration = viewportDurationSeconds(normalizedViewport)
  if (currentDuration <= 0) {
    return normalizedViewport
  }
  const ratio = wheelZoomRatio(deltaY, deltaMode)
  if (ratio === 1) {
    return normalizedViewport.startSeconds === viewport.startSeconds
      && normalizedViewport.endSeconds === viewport.endSeconds
      ? viewport
      : normalizedViewport
  }
  const normalizedDuration = viewportDurationSeconds(normalizedViewport)
  const availableDuration = Math.max(0, durationSeconds - clamp(coverageStartSeconds, 0, durationSeconds))
  const desired = clamp(normalizedDuration * ratio, Math.min(MIN_VIEWPORT_SECONDS, availableDuration), availableDuration)
  if (desired === normalizedDuration) {
    return normalizedViewport.startSeconds === viewport.startSeconds
      && normalizedViewport.endSeconds === viewport.endSeconds
      ? viewport
      : normalizedViewport
  }
  return zoomViewport({
    viewport: normalizedViewport,
    zoomSeconds: desired,
    anchorSeconds: anchorSeconds ?? viewportCenterSeconds(normalizedViewport),
    durationSeconds,
    coverageStartSeconds,
  })
}
