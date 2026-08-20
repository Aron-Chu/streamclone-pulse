export interface ChartViewport {
  startSeconds: number
  endSeconds: number
}

export const MIN_CHART_VIEWPORT_SECONDS = 5 * 60

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

export function fullChartViewport(durationSeconds: number, domainStartSeconds = 0): ChartViewport {
  const duration = Math.max(0, durationSeconds)
  const start = clamp(domainStartSeconds, 0, duration)
  return { startSeconds: start, endSeconds: duration }
}

export function normalizeChartViewport(
  viewport: ChartViewport,
  durationSeconds: number,
  domainStartSeconds = 0,
): ChartViewport {
  const duration = Math.max(0, durationSeconds)
  const domainStart = clamp(domainStartSeconds, 0, duration)
  const domainDuration = Math.max(0, duration - domainStart)
  if (domainDuration <= 0) return fullChartViewport(duration, domainStart)
  const span = clamp(
    viewport.endSeconds - viewport.startSeconds,
    Math.min(MIN_CHART_VIEWPORT_SECONDS, domainDuration),
    domainDuration,
  )
  const start = clamp(viewport.startSeconds, domainStart, Math.max(domainStart, duration - span))
  return { startSeconds: start, endSeconds: start + span }
}

export function zoomChartViewport(
  viewport: ChartViewport,
  durationSeconds: number,
  factor: number,
  anchorSeconds?: number,
  domainStartSeconds = 0,
): ChartViewport {
  const current = normalizeChartViewport(viewport, durationSeconds, domainStartSeconds)
  const domainStart = Math.max(0, domainStartSeconds)
  const domainDuration = Math.max(0, durationSeconds - domainStart)
  const targetSpan = clamp(
    (current.endSeconds - current.startSeconds) * factor,
    Math.min(MIN_CHART_VIEWPORT_SECONDS, domainDuration),
    domainDuration,
  )
  const anchor = clamp(
    anchorSeconds ?? (current.startSeconds + current.endSeconds) / 2,
    current.startSeconds,
    current.endSeconds,
  )
  const fraction = (anchor - current.startSeconds) / Math.max(1, current.endSeconds - current.startSeconds)
  const start = clamp(
    anchor - fraction * targetSpan,
    domainStart,
    Math.max(domainStart, durationSeconds - targetSpan),
  )
  return { startSeconds: start, endSeconds: start + targetSpan }
}

export function wheelZoomChartViewport(
  viewport: ChartViewport,
  durationSeconds: number,
  deltaY: number,
  anchorSeconds?: number,
  domainStartSeconds = 0,
): ChartViewport {
  if (!Number.isFinite(deltaY) || deltaY === 0) return viewport
  const ratio = Math.max(0.75, Math.min(1.333333, Math.exp(deltaY * 0.0035)))
  return zoomChartViewport(viewport, durationSeconds, ratio, anchorSeconds, domainStartSeconds)
}
