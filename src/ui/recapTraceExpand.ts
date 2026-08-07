export function recapChartPreviewOffset(
  hoveredOffset: number | null,
  selectedOffset: number | null | undefined,
): number | null {
  if (hoveredOffset != null) return hoveredOffset
  if (selectedOffset != null) return selectedOffset
  return null
}
