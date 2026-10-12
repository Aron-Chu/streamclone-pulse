import { describe, expect, it } from 'vitest'
import {
  estimateViewerAxisLabelWidth,
  placeViewerAxisLabels,
  viewerLineBand,
  type ViewerAxisLabelInput,
  type ViewerAxisLinePoint,
} from '../src/lib/hubViewerAxisLabels'

// A 1000x420 plot like the Global activity chart at 1440: ticks at 6%, 27% and
// 48% (25.2px, 113.4px and 201.6px), labels 8px in, 16px tall.
const base: Omit<ViewerAxisLabelInput, 'line'> = {
  tickYs: [6, 27, 48],
  labelWidths: [44, 60, 20],
  plotWidth: 1000,
  plotHeight: 420,
  labelLeft: 8,
  labelHeight: 16,
  clearance: 3,
  maxShift: 24,
  bottomLimit: 58,
}

/** A flat line at `y` percent across the whole plot. */
const flat = (y: number): ViewerAxisLinePoint[] => [{ x: 0, y }, { x: 50, y }, { x: 100, y }]

/** True when a label centred at `centre` px stays `clearance` px clear of every y (px) in `ys`. */
function clears(centre: number, ys: number[], half = 8, clearance = 3) {
  const epsilon = 1e-9
  return ys.every((y) => centre + half <= y - clearance + epsilon || centre - half >= y + clearance - epsilon)
}

describe('viewerLineBand', () => {
  it('spans the points inside the column', () => {
    expect(viewerLineBand([{ x: 1, y: 20 }, { x: 2, y: 30 }, { x: 50, y: 90 }], 0, 5)).toEqual({ min: 20, max: 30 + (90 - 30) * (3 / 48) })
  })

  it('counts a segment that crosses the column with no point inside it', () => {
    const band = viewerLineBand([{ x: 0, y: 10 }, { x: 10, y: 30 }], 4, 6)
    expect(band!.min).toBeCloseTo(18)
    expect(band!.max).toBeCloseTo(22)
  })

  it('does not join points across a break in the line', () => {
    // Without the break, the segment from (0, 10) to (10, 40) would cross x 4..6.
    expect(viewerLineBand([{ x: 0, y: 10 }, null, { x: 10, y: 40 }], 4, 6)).toBeNull()
  })

  it('is null when no part of the line reaches the column', () => {
    expect(viewerLineBand([{ x: 20, y: 10 }, { x: 30, y: 40 }], 0, 5)).toBeNull()
    expect(viewerLineBand([], 0, 5)).toBeNull()
  })
})

describe('placeViewerAxisLabels', () => {
  it('leaves every label on its tick when the line is clear of them', () => {
    // A line at 38% (159.6px) sits between the 27% and 48% labels.
    expect(placeViewerAxisLabels({ ...base, line: flat(38) })).toEqual([
      { offset: 0, hidden: false },
      { offset: 0, hidden: false },
      { offset: 0, hidden: false },
    ])
  })

  it('moves a label the least distance that clears the line where it crosses the tick', () => {
    // 29% is 121.8px, just under the 27% tick (113.4px): moving up (2.6px) is shorter.
    const places = placeViewerAxisLabels({ ...base, line: flat(29) })
    expect(places[0]).toEqual({ offset: 0, hidden: false })
    expect(places[2]).toEqual({ offset: 0, hidden: false })
    expect(places[1].hidden).toBe(false)
    expect(places[1].offset).toBeLessThan(0)
    expect(places[1].offset).toBeGreaterThanOrEqual(-24)
    expect(places[1].offset).toBeCloseTo(-2.6, 1)
    expect(clears(113.4 + places[1].offset, [121.8])).toBe(true)

    // 25% is 105px, just over the tick: moving down (2.6px) is shorter.
    const below = placeViewerAxisLabels({ ...base, line: flat(25) })
    expect(below[1].offset).toBeCloseTo(2.6, 1)
    expect(clears(113.4 + below[1].offset, [105])).toBe(true)
  })

  it('clears the whole stretch of line under the label, not just one point', () => {
    // The line climbs from 20% to 34% across the first 10% of the plot (100px).
    // Under the 27% label (5..71px with clearance) it spans 20.7%..29.94%
    // (86.9..125.7px). Above is 37.5px away, past the limit; below is 23.35px away.
    const line: ViewerAxisLinePoint[] = [{ x: 0, y: 20 }, { x: 10, y: 34 }, { x: 100, y: 34 }]
    const [, middle] = placeViewerAxisLabels({ ...base, line })
    expect(middle.hidden).toBe(false)
    expect(middle.offset).toBeCloseTo(23.35, 2)
    expect(clears(113.4 + middle.offset, [86.94, 125.75])).toBe(true)
  })

  it('hides a label rather than move it far from its tick', () => {
    // A steep line through the whole viewer lane under the 27% label: the
    // nearest clear spot is far above or below, beyond the 24px limit.
    const line: ViewerAxisLinePoint[] = [{ x: 0, y: 8 }, { x: 7, y: 46 }, { x: 100, y: 46 }]
    const places = placeViewerAxisLabels({ ...base, line })
    expect(places[1]).toEqual({ offset: 0, hidden: true })
  })

  it('never moves a label above the plot', () => {
    // A tick at 2% (8.4px) with the line at 3% (12.6px): above would be 6.8px
    // away but leave the plot, so the label goes 15.2px down, below the line.
    const [top] = placeViewerAxisLabels({ ...base, tickYs: [2, 27, 48], line: flat(3) })
    expect(top.hidden).toBe(false)
    expect(top.offset).toBeCloseTo(15.2, 1)
  })

  it('never moves a label into the bar lane', () => {
    // With the bars from 52% (218.4px) and the line at 47.5% (199.5px), below
    // the line would be nearer (8.9px) but reach 218.5px, so it goes 13.1px up.
    const places = placeViewerAxisLabels({ ...base, bottomLimit: 52, line: flat(47.5) })
    expect(places[2].hidden).toBe(false)
    expect(places[2].offset).toBeCloseTo(-13.1, 1)
    expect(places[1]).toEqual({ offset: 0, hidden: false })
  })

  it('leaves labels alone while the plot has no size yet', () => {
    expect(placeViewerAxisLabels({ ...base, plotWidth: 0, plotHeight: 0, line: flat(27) }))
      .toEqual([{ offset: 0, hidden: false }, { offset: 0, hidden: false }, { offset: 0, hidden: false }])
  })
})

describe('estimateViewerAxisLabelWidth', () => {
  it('is at least the measured plate width of the chart labels', () => {
    // Plates measured in the built chart (Inter 0.75rem, 0.3rem side padding).
    expect(estimateViewerAxisLabelWidth('983K')).toBeGreaterThanOrEqual(41)
    expect(estimateViewerAxisLabelWidth('1.4M')).toBeGreaterThanOrEqual(39.2)
    expect(estimateViewerAxisLabelWidth('682.5K')).toBeGreaterThanOrEqual(52)
    expect(estimateViewerAxisLabelWidth('0')).toBeGreaterThanOrEqual(17.4)
  })
})
