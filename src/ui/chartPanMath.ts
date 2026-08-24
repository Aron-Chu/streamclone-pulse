import { CHART_DRAG_INTENT_PX } from './chartViewport.ts'

export { CHART_DRAG_INTENT_PX }

/**
 * Pointer-pan conversion for overview charts.
 *
 * Conventional grab/pan: dragging right moves content right and reveals
 * earlier history. Scale uses the visible viewport duration captured at
 * pointer-down — never the full stream duration.
 */

export function hasChartDragIntent(deltaPx: number): boolean {
  return Number.isFinite(deltaPx) && Math.abs(deltaPx) >= CHART_DRAG_INTENT_PX
}

export function panSecondsPerPixel(
  visibleDurationSeconds: number,
  plotWidth: number,
): number {
  if (!(plotWidth > 0) || !(visibleDurationSeconds > 0)) return 0
  return visibleDurationSeconds / plotWidth
}

/** Drag-right (positive deltaPx) → negative time delta → earlier history. */
export function panDeltaSecondsFromPointer(
  deltaPx: number,
  visibleDurationSeconds: number,
  plotWidth: number,
): number {
  const seconds = -deltaPx * panSecondsPerPixel(visibleDurationSeconds, plotWidth)
  return seconds === 0 ? 0 : seconds
}
