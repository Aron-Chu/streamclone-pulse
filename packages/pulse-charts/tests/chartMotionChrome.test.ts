import { describe, expect, it } from 'vitest'
import {
  clampTimeChipX,
  estimateTimeChipWidth,
  formatChartMinuteChip,
  hoverBandFromBars,
  intervalBandFromTimestamps,
} from '../src/ChartMotionChrome.tsx'

describe('chart motion chrome helpers', () => {
  it('clamps a centered time chip inside the plot', () => {
    expect(clampTimeChipX(90, 876, 90, 40)).toBe(110)
    expect(clampTimeChipX(960, 876, 90, 40)).toBe(946)
    expect(clampTimeChipX(500, 876, 90, 40)).toBe(500)
  })

  it('sizes the chip from the label instead of a fixed 28px box', () => {
    expect(estimateTimeChipWidth('01:04')).toBeGreaterThan(28)
    expect(estimateTimeChipWidth('01:04–01:12')).toBeGreaterThan(
      estimateTimeChipWidth('01:04'),
    )
  })

  it('drops trailing seconds on exact-minute chips', () => {
    expect(formatChartMinuteChip(64 * 60)).toBe('01:04')
    expect(formatChartMinuteChip(64 * 60 + 12)).toBe('01:04:12')
  })

  it('uses the selected bar interval as the hover/pin band, not a 1px line', () => {
    const band = hoverBandFromBars(
      [
        { x: 120, width: 18, bucketStartIndex: 0, bucketEndExclusive: 4, sourceIndex: 2 },
        { x: 200, width: 9, bucketStartIndex: 4, bucketEndExclusive: 6, sourceIndex: 5 },
      ],
      5,
    )
    expect(band).toEqual({ x: 200, width: 9 })
  })

  it('builds an interval band from timestamp scale extents', () => {
    const band = intervalBandFromTimestamps({
      startIndex: 2,
      endExclusive: 5,
      timestamps: [
        '2026-07-31T00:00:00.000Z',
        '2026-07-31T00:01:00.000Z',
        '2026-07-31T00:02:00.000Z',
        '2026-07-31T00:03:00.000Z',
        '2026-07-31T00:04:00.000Z',
        '2026-07-31T00:05:00.000Z',
      ],
      xForIndex: (index) => 90 + index * 20,
    })
    expect(band).toEqual({ x: 130, width: 60 })
  })
})
