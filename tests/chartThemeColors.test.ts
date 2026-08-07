import { describe, expect, it } from 'vitest'
import { emoteChartColor, hexToRgba } from '../src/ui/chartTheme.ts'

describe('scheme-aware emote plot colors', () => {
  it('uses host variables so plotted emotes deepen on light surfaces', () => {
    expect(emoteChartColor(0)).toBe('var(--pulse-chart-plot-1, #fb7185)')
    expect(emoteChartColor(4)).toBe('var(--pulse-chart-plot-5, #4ade80)')
    expect(emoteChartColor(5)).toBe(emoteChartColor(0))
  })

  it('keeps variable-based plot fills translucent instead of turning them solid', () => {
    expect(hexToRgba(emoteChartColor(1), 0.12)).toBe(
      'color-mix(in srgb, var(--pulse-chart-plot-2, #fbbf24) 12%, transparent)',
    )
    expect(hexToRgba('#fb7185', 0.25)).toBe('rgba(251, 113, 133, 0.25)')
  })
})
