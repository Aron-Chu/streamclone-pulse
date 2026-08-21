import { describe, expect, it } from 'vitest'
import { AFTER_CURSOR_OPACITY } from '../src/ui/chartTheme.ts'
import {
  CHART_PIN_EXIT_MS,
  chartHasDismissiblePin,
  chartPinExitVisual,
  shouldApplyChartOutsideDismiss,
} from '../src/ui/chartPinExit.ts'

describe('chartPinExitVisual', () => {
  it('keeps inspect layers mounted when unpinned so the plot hit-target is not remounted', () => {
    const visual = chartPinExitVisual(null)
    expect(visual.inspectLayers).toBe(true)
    expect(visual.pinChromeOpacity).toBe(0)
    expect(visual.afterCursorMul).toBe(1)
  })

  it('dims the after-cursor ridge while locked', () => {
    const visual = chartPinExitVisual(4)
    expect(visual.inspectLayers).toBe(true)
    expect(visual.pinChromeOpacity).toBe(1)
    expect(visual.afterCursorMul).toBe(AFTER_CURSOR_OPACITY)
  })

  it('matches the shared 200ms opacity travel', () => {
    expect(CHART_PIN_EXIT_MS).toBe(200)
  })
})

describe('shouldApplyChartOutsideDismiss', () => {
  it('does not re-clear when nothing is pinned so the next graph click stays live', () => {
    expect(
      shouldApplyChartOutsideDismiss({
        outside: true,
        hasPinnedSelection: false,
      }),
    ).toBe(false)
  })

  it('clears only an actual pin on an outside pointer', () => {
    expect(
      shouldApplyChartOutsideDismiss({
        outside: true,
        hasPinnedSelection: true,
      }),
    ).toBe(true)
    expect(
      shouldApplyChartOutsideDismiss({
        outside: false,
        hasPinnedSelection: true,
      }),
    ).toBe(false)
  })
})

describe('chartHasDismissiblePin', () => {
  it('treats committed chart selections as pinned even without a resolved offset yet', () => {
    expect(chartHasDismissiblePin({
      selectedOffsetSeconds: null,
      selectedIndex: null,
      committedKind: 'chart_minute',
    })).toBe(true)
    expect(chartHasDismissiblePin({
      selectedOffsetSeconds: null,
      selectedIndex: null,
      committedKind: 'none',
    })).toBe(false)
  })
})
