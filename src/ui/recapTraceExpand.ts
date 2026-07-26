export function resolveTracesExpanded(args: {
  plottedCount: number
  tracesExpanded: boolean
  userCollapsedTraces: boolean
}): boolean {
  if (args.plottedCount <= 0) return false
  if (args.userCollapsedTraces) return args.tracesExpanded
  return true
}

export function nextTracesExpandedAfterPlottedCountChange(args: {
  plottedCount: number
  userCollapsedTraces: boolean
}): { tracesExpanded: boolean; userCollapsedTraces: boolean } {
  if (args.plottedCount <= 0) {
    return { tracesExpanded: false, userCollapsedTraces: false }
  }
  if (args.userCollapsedTraces) {
    return { tracesExpanded: false, userCollapsedTraces: true }
  }
  return { tracesExpanded: true, userCollapsedTraces: false }
}

export function recapChartPreviewOffset(
  hoveredOffset: number | null,
  selectedOffset: number | null | undefined,
): number | null {
  if (hoveredOffset != null) return hoveredOffset
  if (selectedOffset != null) return selectedOffset
  return null
}
