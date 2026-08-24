/**
 * Shared wall-time viewport math for long analytics timelines.
 *
 * This module is deliberately framework-free so the portal and extension can
 * use the same anchor/clamp semantics without sharing their controls.
 */
export interface ChartViewport {
  startSeconds: number
  endSeconds: number
}

export const MIN_CHART_VIEWPORT_SECONDS = 5 * 60
export const CHART_WHEEL_MAX_RATIO = 1.5
export const CHART_DRAG_INTENT_PX = 6

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function viewportDurationSeconds(viewport: ChartViewport): number {
  return Math.max(0, viewport.endSeconds - viewport.startSeconds)
}

export function viewportCenterSeconds(viewport: ChartViewport): number {
  return (viewport.startSeconds + viewport.endSeconds) / 2
}

export function fullChartViewport(durationSeconds: number, domainStartSeconds = 0): ChartViewport {
  const duration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0)
  const domainStart = clamp(domainStartSeconds, 0, duration)
  return { startSeconds: domainStart, endSeconds: duration }
}

export function normalizeChartViewport(
  viewport: ChartViewport,
  durationSeconds: number,
  minSeconds = MIN_CHART_VIEWPORT_SECONDS,
  domainStartSeconds = 0,
): ChartViewport {
  const duration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0)
  const domainStart = clamp(domainStartSeconds, 0, duration)
  const domainDuration = Math.max(0, duration - domainStart)
  if (domainDuration <= 0) return fullChartViewport(duration, domainStart)
  const min = Math.min(Math.max(1, minSeconds), domainDuration)
  const desired = clamp(viewport.endSeconds - viewport.startSeconds, min, domainDuration)
  const start = clamp(viewport.startSeconds, domainStart, Math.max(domainStart, duration - desired))
  return { startSeconds: start, endSeconds: start + desired }
}

export function zoomChartViewport(args: {
  viewport: ChartViewport
  durationSeconds: number
  zoomSeconds: number
  anchorSeconds?: number
  minSeconds?: number
  domainStartSeconds?: number
}): ChartViewport {
  const {
    viewport,
    durationSeconds,
    zoomSeconds,
    anchorSeconds,
    minSeconds = MIN_CHART_VIEWPORT_SECONDS,
    domainStartSeconds = 0,
  } = args
  const duration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0)
  const domainStart = clamp(domainStartSeconds, 0, duration)
  const domainDuration = Math.max(0, duration - domainStart)
  if (domainDuration <= 0) return fullChartViewport(duration, domainStart)
  const current = normalizeChartViewport(viewport, duration, minSeconds, domainStart)
  const min = Math.min(Math.max(1, minSeconds), domainDuration)
  const target = clamp(zoomSeconds, min, domainDuration)
  const anchor = clamp(anchorSeconds ?? viewportCenterSeconds(current), current.startSeconds, current.endSeconds)
  const fraction = viewportDurationSeconds(current) > 0
    ? (anchor - current.startSeconds) / viewportDurationSeconds(current)
    : 0.5
  const start = clamp(anchor - fraction * target, domainStart, Math.max(domainStart, duration - target))
  return { startSeconds: start, endSeconds: start + target }
}

export function panChartViewport(
  viewport: ChartViewport,
  deltaSeconds: number,
  durationSeconds: number,
  minSeconds = MIN_CHART_VIEWPORT_SECONDS,
  domainStartSeconds = 0,
): ChartViewport {
  const duration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0)
  const domainStart = clamp(domainStartSeconds, 0, duration)
  const current = normalizeChartViewport(viewport, duration, minSeconds, domainStart)
  const span = viewportDurationSeconds(current)
  const maxStart = Math.max(domainStart, duration - span)
  const start = clamp(current.startSeconds + (Number.isFinite(deltaSeconds) ? deltaSeconds : 0), domainStart, maxStart)
  return { startSeconds: start, endSeconds: start + span }
}

/** Convert a graph-surface drag into the same timestamp pan used by the rail. */
export function dragPanChartViewport(args: {
  viewport: ChartViewport
  durationSeconds: number
  deltaPixels: number
  plotWidthPixels: number
  domainStartSeconds?: number
}): ChartViewport {
  const { viewport, durationSeconds, deltaPixels, plotWidthPixels, domainStartSeconds = 0 } = args
  const current = normalizeChartViewport(viewport, durationSeconds, MIN_CHART_VIEWPORT_SECONDS, domainStartSeconds)
  const span = viewportDurationSeconds(current)
  const domainStart = clamp(domainStartSeconds, 0, durationSeconds)
  if (plotWidthPixels <= 0 || span >= durationSeconds - domainStart - 1) return current
  return panChartViewport(
    current,
    -(deltaPixels / plotWidthPixels) * span,
    durationSeconds,
    MIN_CHART_VIEWPORT_SECONDS,
    domainStart,
  )
}

export function chartWheelZoomRatio(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return clamp(Math.exp(pixels * 0.0035), 1 / CHART_WHEEL_MAX_RATIO, CHART_WHEEL_MAX_RATIO)
}

export function wheelZoomChartViewport(args: {
  viewport: ChartViewport
  durationSeconds: number
  deltaY: number
  deltaMode?: number
  anchorSeconds?: number
  minSeconds?: number
  domainStartSeconds?: number
}): ChartViewport {
  const {
    viewport,
    durationSeconds,
    deltaY,
    deltaMode = 0,
    anchorSeconds,
    minSeconds = MIN_CHART_VIEWPORT_SECONDS,
    domainStartSeconds = 0,
  } = args
  const current = normalizeChartViewport(viewport, durationSeconds, minSeconds, domainStartSeconds)
  const ratio = chartWheelZoomRatio(deltaY, deltaMode)
  if (ratio === 1) return current
  return zoomChartViewport({
    viewport: current,
    durationSeconds,
    zoomSeconds: viewportDurationSeconds(current) * ratio,
    anchorSeconds,
    minSeconds,
    domainStartSeconds,
  })
}

export function resolveSelectionReveal(args: {
  viewport: ChartViewport
  durationSeconds: number
  selectedOffsetSeconds: number | null
  /** Preview is accepted to make the ownership contract explicit; it never reveals. */
  previewOffsetSeconds?: number | null
  lastRevealedOffsetSeconds: number | null
  domainStartSeconds?: number
}): {
  viewport: ChartViewport
  revealedOffsetSeconds: number | null
} {
  const {
    viewport,
    durationSeconds,
    selectedOffsetSeconds,
    lastRevealedOffsetSeconds,
    domainStartSeconds = 0,
  } = args
  const domainStart = clamp(domainStartSeconds, 0, durationSeconds)
  if (
    selectedOffsetSeconds == null
    || !Number.isFinite(selectedOffsetSeconds)
    || selectedOffsetSeconds === lastRevealedOffsetSeconds
  ) {
    return { viewport, revealedOffsetSeconds: lastRevealedOffsetSeconds }
  }

  const revealedOffsetSeconds = selectedOffsetSeconds
  if (
    selectedOffsetSeconds >= viewport.startSeconds
    && selectedOffsetSeconds <= viewport.endSeconds
  ) {
    return { viewport, revealedOffsetSeconds }
  }

  const span = viewportDurationSeconds(viewport)
  const start = clamp(
    selectedOffsetSeconds - span / 2,
    domainStart,
    Math.max(domainStart, durationSeconds - span),
  )
  return {
    viewport: { startSeconds: start, endSeconds: start + span },
    revealedOffsetSeconds,
  }
}

export function chartViewportPresets(durationSeconds: number): Array<{ label: string; seconds: number | 'full' }> {
  const duration = Math.max(0, durationSeconds)
  const presets: Array<{ label: string; seconds: number | 'full' }> = [
    { label: '15m', seconds: 15 * 60 },
    { label: '1h', seconds: 60 * 60 },
    { label: '2h', seconds: 2 * 60 * 60 },
    { label: '4h', seconds: 4 * 60 * 60 },
    { label: 'Full', seconds: 'full' },
  ]
  return presets.filter(item => item.seconds === 'full' || duration >= item.seconds)
}
