import type { ChartViewport } from '@streampulse/pulse-charts'
import type { ChartNavigatorPreset, ChartNavigatorRange } from '../components/analytics/ChartNavigator.tsx'

/** One navigator step is one stream minute. */
const NAVIGATOR_STEP_SECONDS = 60

/**
 * The navigator works in whole minutes counted from the first charted minute:
 * step `i` is the minute starting at `domainStart + i * 60`, and a range
 * includes both of its end minutes. The last step always reaches the stream
 * end, so a partial final minute is never cut off.
 */
export function sessionNavigatorPointCount(durationSeconds: number, domainStartSeconds: number): number {
  const span = Math.max(0, durationSeconds - domainStartSeconds)
  return Math.max(2, Math.round(span / NAVIGATOR_STEP_SECONDS))
}

export function sessionNavigatorRangeForViewport(
  viewport: ChartViewport,
  durationSeconds: number,
  domainStartSeconds: number,
): ChartNavigatorRange {
  const pointCount = sessionNavigatorPointCount(durationSeconds, domainStartSeconds)
  const steps = (seconds: number) => Math.round((seconds - domainStartSeconds) / NAVIGATOR_STEP_SECONDS)
  const startIndex = Math.max(0, Math.min(pointCount - 2, steps(viewport.startSeconds)))
  const endIndex = Math.max(startIndex + 1, Math.min(pointCount - 1, steps(viewport.endSeconds) - 1))
  return { startIndex, endIndex }
}

export function sessionViewportForNavigatorRange(
  range: ChartNavigatorRange,
  durationSeconds: number,
  domainStartSeconds: number,
): ChartViewport {
  const pointCount = sessionNavigatorPointCount(durationSeconds, domainStartSeconds)
  const startSeconds = Math.min(
    durationSeconds,
    domainStartSeconds + Math.max(0, range.startIndex) * NAVIGATOR_STEP_SECONDS,
  )
  const endSeconds = range.endIndex >= pointCount - 1
    ? durationSeconds
    : Math.min(durationSeconds, domainStartSeconds + (range.endIndex + 1) * NAVIGATOR_STEP_SECONDS)
  return { startSeconds, endSeconds }
}

/** Navigator step that contains a stream offset, or null. */
export function sessionNavigatorIndexForOffset(
  offsetSeconds: number | null,
  durationSeconds: number,
  domainStartSeconds: number,
): number | null {
  if (offsetSeconds == null || !Number.isFinite(offsetSeconds)) return null
  const pointCount = sessionNavigatorPointCount(durationSeconds, domainStartSeconds)
  return Math.max(0, Math.min(pointCount - 1, Math.floor((offsetSeconds - domainStartSeconds) / NAVIGATOR_STEP_SECONDS)))
}

/**
 * One-click zoom sizes for the navigator track, as on the hub: a click on the
 * purple bar at full range zooms to `presets[0]` around the click. Spans of 2h
 * or less get 15m first; longer streams get 1h. A preset that is not smaller
 * than the whole navigator is dropped.
 */
export function sessionNavigatorPresets(durationSeconds: number, domainStartSeconds: number): ChartNavigatorPreset[] {
  const pointCount = sessionNavigatorPointCount(durationSeconds, domainStartSeconds)
  const spanSeconds = Math.max(0, durationSeconds - domainStartSeconds)
  const presets = spanSeconds <= 2 * 60 * 60
    ? [{ label: '15m', pointCount: 15 }, { label: '1h', pointCount: 60 }]
    : [{ label: '1h', pointCount: 60 }, { label: '4h', pointCount: 240 }]
  return presets.filter(preset => preset.pointCount < pointCount)
}
