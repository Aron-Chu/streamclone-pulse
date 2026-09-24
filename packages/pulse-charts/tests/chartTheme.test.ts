import { describe, expect, it } from 'vitest'
import { adaptiveChartLineWidth, chartLineWidth } from '../src/chartTheme.ts'

describe('adaptive chart line weight', () => {
  it('keeps the existing fixed contract for callers that do not opt in', () => {
    expect(chartLineWidth(0)).toBe(2.5)
    expect(chartLineWidth(1)).toBe(3.5)
  })

  it('uses fine full-stream strokes and adds bounded definition while zooming', () => {
    const full = adaptiveChartLineWidth(0, 1)
    const half = adaptiveChartLineWidth(0, 0.5)
    const detail = adaptiveChartLineWidth(0, 0.01)

    expect(full).toBeCloseTo(1.55)
    expect(half).toBeGreaterThan(full)
    expect(detail).toBeGreaterThan(half)
    expect(detail).toBeLessThanOrEqual(2.15)
    expect(adaptiveChartLineWidth(1, 0)).toBeLessThan(chartLineWidth(1))
  })

  it('keeps selected-emote overlays lighter than aggregate signals', () => {
    expect(adaptiveChartLineWidth(0.5, 0.1, 'secondary'))
      .toBeLessThan(adaptiveChartLineWidth(0.5, 0.1, 'primary'))
  })
})
