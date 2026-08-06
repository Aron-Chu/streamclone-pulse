import { describe, expect, it } from 'vitest'
import {
  EXTENSION_PORTAL_CHART_THEME,
  barAlpha,
  barDimOpacity,
} from '../src/ui/extensionPortalChartTheme.ts'
import { CHART_BAR_ALPHA, CHART_SIGNAL } from '../src/ui/chartTheme.ts'

describe('extensionPortalChartTheme', () => {
  it('uses the same semantic colors as every extension chart', () => {
    expect(EXTENSION_PORTAL_CHART_THEME.chat).toBe(CHART_SIGNAL.chat)
    expect(EXTENSION_PORTAL_CHART_THEME.viewers).toBe(CHART_SIGNAL.viewers)
    expect(EXTENSION_PORTAL_CHART_THEME.emotes).toBe(CHART_SIGNAL.emotes)
    expect(EXTENSION_PORTAL_CHART_THEME.moment).toBe(CHART_SIGNAL.heat)
  })

  it('uses one predictable intensity ladder for every bar lane', () => {
    expect(barAlpha({ isSpike: false, selected: false, hasValue: true })).toBe(CHART_BAR_ALPHA.resting)
    expect(barAlpha({ isSpike: false, selected: true, hasValue: true })).toBe(CHART_BAR_ALPHA.selected)
    expect(barAlpha({ isSpike: true, selected: true, hasValue: true })).toBe(CHART_BAR_ALPHA.selectedSpike)
    expect(barAlpha({ isSpike: false, selected: false, hasValue: false })).toBe(CHART_BAR_ALPHA.empty)
  })

  it('dims non-active bars lightly when scrubbing', () => {
    expect(barDimOpacity(null, 2)).toBe(1)
    expect(barDimOpacity(1, 1)).toBe(1)
    expect(barDimOpacity(1, 0)).toBe(0.72)
  })
})
