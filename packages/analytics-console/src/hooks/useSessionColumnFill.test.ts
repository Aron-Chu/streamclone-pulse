import { describe, expect, it } from 'vitest'
import { COLUMN_FILL_MAX_CHART_PX, COLUMN_FILL_PAD_ALLOW, computeColumnFill, type ColumnFillInput } from './useSessionColumnFill.ts'

const base: ColumnFillInput = {
  pitch: 60,
  shownRows: 5,
  totalMoments: 12,
  room: 0,
  fillPx: 0,
  growChart: false,
  padAllowed: true,
}

describe('computeColumnFill (MOCK session-original fitMoments)', () => {
  it('keeps at least five rows when nothing is measured yet', () => {
    expect(computeColumnFill({ ...base, pitch: 0, shownRows: 3 })).toEqual({ fitCount: 5, fillPx: 0, padPx: 0 })
    expect(computeColumnFill({ ...base, pitch: 0, shownRows: 7 })).toEqual({ fitCount: 7, fillPx: 0, padPx: 0 })
  })

  it('adds whole rows while the room takes them, with no pad when they fit exactly', () => {
    expect(computeColumnFill({ ...base, room: 120 })).toEqual({ fitCount: 7, fillPx: 0, padPx: 0 })
  })

  it('takes one more row when it needs at most the pad allowance, and pads the centre by the rest', () => {
    // 110 px of room: one row fits, the second needs 10 px more (<= 12).
    expect(computeColumnFill({ ...base, room: 110 })).toEqual({ fitCount: 7, fillPx: 0, padPx: 10 })
    // 100 px: the second row would need 20 px, so it stays out.
    expect(computeColumnFill({ ...base, room: 100 })).toEqual({ fitCount: 6, fillPx: 0, padPx: 0 })
  })

  it('gives no pad when the owner switch is off', () => {
    expect(computeColumnFill({ ...base, room: 110, padAllowed: false })).toEqual({ fitCount: 7, fillPx: 0, padPx: 0 })
  })

  it('drops rows that run past the centre, keeping the row that needs only a few px', () => {
    // Eight rows shown, 130 px past the centre: drop two (120 px), pad 10.
    expect(computeColumnFill({ ...base, shownRows: 8, room: -130 })).toEqual({ fitCount: 6, fillPx: 0, padPx: 10 })
  })

  it('never goes below five rows, and the pad never exceeds the allowance', () => {
    const result = computeColumnFill({ ...base, shownRows: 8, room: -400 })
    expect(result.fitCount).toBe(5)
    expect(result.padPx).toBe(COLUMN_FILL_PAD_ALLOW)
  })

  it('never asks for more rows than there are moments', () => {
    expect(computeColumnFill({ ...base, shownRows: 3, totalMoments: 3, room: 300 })).toEqual({ fitCount: 5, fillPx: 0, padPx: 0 })
    expect(computeColumnFill({ ...base, totalMoments: 6, room: 600 }).fitCount).toBe(6)
  })

  it('grows the chart instead when five rows run past the centre by more than the allowance', () => {
    expect(computeColumnFill({ ...base, room: -100, growChart: true })).toEqual({ fitCount: 5, fillPx: 100, padPx: 0 })
    expect(computeColumnFill({ ...base, room: -500, growChart: true })).toEqual({ fitCount: 5, fillPx: COLUMN_FILL_MAX_CHART_PX, padPx: 0 })
    // Once the growth has landed (room back to 0) it holds steady.
    expect(computeColumnFill({ ...base, room: 0, fillPx: 100, growChart: true })).toEqual({ fitCount: 5, fillPx: 100, padPx: 0 })
  })

  it('pads rather than grows when five rows are past the centre by no more than the allowance', () => {
    expect(computeColumnFill({ ...base, room: -10, growChart: true })).toEqual({ fitCount: 5, fillPx: 0, padPx: 10 })
  })

  it('maxRows caps the rows and the floor: the chart grows only when those rows run past it', () => {
    const top3 = { ...base, shownRows: 3, maxRows: 3, growChart: true }
    // Room for more rows: still three, no pad, no growth.
    expect(computeColumnFill({ ...top3, room: 300 })).toEqual({ fitCount: 3, fillPx: 0, padPx: 0 })
    expect(computeColumnFill({ ...top3, room: 0 })).toEqual({ fitCount: 3, fillPx: 0, padPx: 0 })
    // The three rows run past the centre: the chart grows by the difference.
    expect(computeColumnFill({ ...top3, room: -60 })).toEqual({ fitCount: 3, fillPx: 60, padPx: 0 })
    // Within PAD_ALLOW: the centre pads instead.
    expect(computeColumnFill({ ...top3, room: -8 })).toEqual({ fitCount: 3, fillPx: 0, padPx: 8 })
    expect(computeColumnFill({ ...top3, pitch: 0 }).fitCount).toBe(3)
  })
})
