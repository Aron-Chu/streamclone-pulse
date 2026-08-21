/**
 * Pointer-pan conversion for overview charts.
 *
 * Conventional grab/pan: dragging right moves content right and reveals
 * earlier history. Scale uses the visible viewport duration captured at
 * pointer-down — never the full stream duration.
 */

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
  return -deltaPx * panSecondsPerPixel(visibleDurationSeconds, plotWidth)
}
