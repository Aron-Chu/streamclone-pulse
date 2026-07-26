import { describe, expect, it } from 'vitest'
import {
  EXTENSION_PORTAL_CHART_THEME,
  barAlpha,
  barDimOpacity,
} from '../src/ui/extensionPortalChartTheme.ts'

describe('extensionPortalChartTheme', () => {
  it('exports portal lane hex values', () => {
    expect(EXTENSION_PORTAL_CHART_THEME.chat).toBe('#8b5cf6')
    expect(EXTENSION_PORTAL_CHART_THEME.viewers).toBe('#4ade80')
    expect(EXTENSION_PORTAL_CHART_THEME.emotes).toBe('#22d3ee')
    expect(EXTENSION_PORTAL_CHART_THEME.moment).toBe('#fbbf24')
  })

  it('returns softer resting alphas and stronger selected alphas', () => {
    expect(barAlpha('chat', { isSpike: false, selected: false, hasValue: true })).toBe(0.35)
    expect(barAlpha('chat', { isSpike: false, selected: true, hasValue: true })).toBe(0.78)
    expect(barAlpha('emote', { isSpike: true, selected: true, hasValue: true })).toBe(0.88)
  })

  it('dims non-active bars lightly when scrubbing', () => {
    expect(barDimOpacity(null, 2)).toBe(1)
    expect(barDimOpacity(1, 1)).toBe(1)
    expect(barDimOpacity(1, 0)).toBe(0.72)
  })
})
