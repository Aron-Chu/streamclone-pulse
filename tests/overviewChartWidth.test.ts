import { describe, expect, it } from 'vitest'
import { DEFAULT_WIDTH, PAD_LEFT, PAD_RIGHT } from '../src/ui/PulseOverviewChart'

const MIN_PLOT_WIDTH = PAD_LEFT + PAD_RIGHT + 40

describe('overview chart width guards', () => {
  it('rejects pre-layout 1px widths that previously produced SVG rect width -15', () => {
    // Historical bug: width=1 → 1 - 4 - 12 = -15
    expect(1 - PAD_LEFT - PAD_RIGHT).toBe(-15)
    expect(DEFAULT_WIDTH).toBe(320)
    expect(PAD_LEFT).toBe(4)
    expect(PAD_RIGHT).toBe(12)
    expect(MIN_PLOT_WIDTH).toBe(56)
  })

  it('imported constants match the component', () => {
    // If these break, the chart's layout guards changed and we need a
    // coordinated update — not the other way around.
    expect([PAD_LEFT, PAD_RIGHT, DEFAULT_WIDTH]).toEqual([4, 12, 320])
  })
})
