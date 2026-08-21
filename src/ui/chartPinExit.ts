import { AFTER_CURSOR_OPACITY } from './chartTheme.ts'

/** Same duration as `chartInteractionOpacityTransition` (bar / inspect opacity). */
export const CHART_PIN_EXIT_MS = 200

export function chartHasDismissiblePin(args: {
  selectedOffsetSeconds?: number | null
  selectedIndex?: number | null
  committedKind?: string
}): boolean {
  return (
    args.selectedOffsetSeconds != null
    || args.selectedIndex != null
    || (args.committedKind != null && args.committedKind !== 'none')
  )
}

export function shouldApplyChartOutsideDismiss(args: {
  outside: boolean
  hasPinnedSelection: boolean
}): boolean {
  return args.outside && args.hasPinnedSelection
}

/**
 * Inspect clip layers stay mounted whether or not a pin is active so unpin
 * does not remount the plot (which drops the next graph click on long recaps).
 * After-cursor dim and pin chrome opacity still follow the live pin; CSS
 * transitions fade them without a React exit hold.
 */
export function chartPinExitVisual(lockPinIndex: number | null): {
  inspectLayers: boolean
  afterCursorMul: number
  pinChromeOpacity: number
} {
  const pinned = lockPinIndex != null
  return {
    inspectLayers: true,
    afterCursorMul: pinned ? AFTER_CURSOR_OPACITY : 1,
    pinChromeOpacity: pinned ? 1 : 0,
  }
}
