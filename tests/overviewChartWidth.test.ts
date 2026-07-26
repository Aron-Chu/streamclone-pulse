import { describe, expect, it } from 'vitest'

const PAD_LEFT = 4
const PAD_RIGHT = 12
const DEFAULT_WIDTH = 320
const MIN_PLOT_WIDTH = PAD_LEFT + PAD_RIGHT + 40

/** Mirrors PulseOverviewChart width / plotWidth guards. */
function resolveOverviewWidth(raw: number): number {
  const next = Math.round(raw)
  return next >= MIN_PLOT_WIDTH ? next : DEFAULT_WIDTH
}

function resolvePlotWidth(width: number): number {
  return Math.max(1, width - PAD_LEFT - PAD_RIGHT)
}

describe('overview chart width guards', () => {
  it('rejects pre-layout 1px widths that previously produced SVG rect width -15', () => {
    expect(resolveOverviewWidth(1)).toBe(DEFAULT_WIDTH)
    expect(resolvePlotWidth(resolveOverviewWidth(1))).toBeGreaterThan(0)
    // Historical bug: width=1 → 1 - 4 - 12 = -15
    expect(1 - PAD_LEFT - PAD_RIGHT).toBe(-15)
    expect(resolvePlotWidth(1)).toBe(1)
  })

  it('keeps real sidebar widths', () => {
    expect(resolveOverviewWidth(280)).toBe(280)
    expect(resolvePlotWidth(280)).toBe(280 - PAD_LEFT - PAD_RIGHT)
  })
})
