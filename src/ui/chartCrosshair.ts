export interface ChartCrosshairMode {
  showPin: boolean
  showListPreview: boolean
  pinIndex: number | null
  listPreviewIndex: number | null
}

/** Pin vs list-hover preview: while previewing a different minute, hide the pin. */
export function resolveChartCrosshairMode(args: {
  pinIndex: number | null
  listPreviewIndex: number | null
}): ChartCrosshairMode {
  const showListPreview = args.listPreviewIndex != null
  const previewDiffersFromPin =
    showListPreview &&
    args.pinIndex != null &&
    args.listPreviewIndex !== args.pinIndex
  const showPin = args.pinIndex != null && !previewDiffersFromPin
  return {
    showPin,
    showListPreview,
    pinIndex: showPin ? args.pinIndex : null,
    listPreviewIndex: showListPreview ? args.listPreviewIndex : null,
  }
}

/** Shared opacity transition for inspection layers and crosshair-adjacent UI. */
export function chartInteractionOpacityTransition(reducedMotion: boolean): string {
  return reducedMotion ? 'none' : 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)'
}
