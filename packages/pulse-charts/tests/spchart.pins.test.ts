import { describe, expect, it } from 'vitest'
import { bandBox } from '../src/sp/band.ts'
import { gapRuns, runsPath, viewerGapRuns } from '../src/sp/gaps.ts'
import { spLayout } from '../src/sp/layout.ts'
import { linePaths, slotAverages } from '../src/sp/lines.ts'
import { overviewPath } from '../src/sp/overview.ts'
import { clusterPins, pinClusterSpan } from '../src/sp/pins.ts'
import { clockTicks, compact, elapsedTicks, formatElapsed, formatInt, niceTicks } from '../src/sp/scale.ts'
import type { SpChartData } from '../src/sp/types.ts'

const MIN = 60_000

describe('clusterPins', () => {
  it('merges pins closer than 46 px and labels ranks with "·"', () => {
    const pins = [
      { index: 0, x: 100 },
      { index: 2, x: 130 },
      { index: 4, x: 175 }, // 45 px from 130: joins
      { index: 1, x: 221 }, // 46 px from 175: separate
      { index: 3, x: 600 },
    ]
    const c = clusterPins(pins, 800)
    expect(c.map(k => k.label)).toEqual(['1·3·5', '2', '4'])
    expect(c[0]!.members).toEqual([0, 2, 4])
    expect(c[0]!.x0).toBe(100)
    expect(c[0]!.x1).toBe(175)
    expect(c[0]!.left).toBe(137.5)
  })

  it('drops pins off the plot and keeps labels 22 px from the edges', () => {
    const c = clusterPins([{ index: 0, x: -3 }, { index: 1, x: 4 }, { index: 2, x: 798 }, { index: 3, x: 801 }], 800)
    expect(c.map(k => k.label)).toEqual(['2', '3'])
    expect(c[0]!.left).toBe(22)
    expect(c[1]!.left).toBe(778)
  })

  it('a cluster click shows 10 min before the first to 11 min after the last', () => {
    expect(pinClusterSpan([5 * MIN, 2 * MIN, 9 * MIN])).toEqual({ startMs: 2 * MIN - 10 * MIN, endMs: 9 * MIN + 11 * MIN })
  })
})

function data(n: number, cov: (i: number) => number, viewers: (i: number) => number = () => 100): SpChartData {
  return {
    startMs: 0,
    stepMs: MIN,
    chat: Float64Array.from({ length: n }, (_, i) => 10 + (i % 5)),
    emotes: Float64Array.from({ length: n }, () => 3),
    viewers: Float64Array.from({ length: n }, (_, i) => viewers(i)),
    coverage: Uint8Array.from({ length: n }, (_, i) => cov(i)),
  }
}

describe('hatches', () => {
  it('cover only coverage-2 samples, never a measured minute', () => {
    const d = data(60, i => (i >= 10 && i < 20) || (i >= 40 && i < 45) ? 2 : i === 30 ? 1 : 0)
    expect(gapRuns(d)).toEqual([10, 20, 40, 45])
    // a gap span wider than the unmeasured run is cut to the run
    expect(gapRuns(d, [{ startMs: 5 * MIN, endMs: 25 * MIN }])).toEqual([10, 20])
    // a span over measured minutes only hatches nothing
    expect(gapRuns(d, [{ startMs: 25 * MIN, endMs: 35 * MIN }])).toEqual([])
    // spans outside the data are harmless
    expect(gapRuns(d, [{ startMs: -50 * MIN, endMs: -40 * MIN }, { startMs: 500 * MIN, endMs: 600 * MIN }])).toEqual([])
    for (const gaps of [undefined, null, [{ startMs: 0, endMs: 60 * MIN }], [{ startMs: 12 * MIN, endMs: 41 * MIN }]]) {
      const r = gapRuns(d, gaps)
      for (let k = 0; k < r.length; k += 2) for (let i = r[k]!; i < r[k + 1]!; i += 1) expect(d.coverage[i]).toBe(2)
    }
  })

  it('viewer hatches cover a missing viewer value on a measured sample only', () => {
    const d = data(20, i => (i < 3 ? 2 : 0), i => (i >= 8 && i < 11 ? NaN : i < 3 ? NaN : 50))
    expect(viewerGapRuns(d)).toEqual([8, 11])
  })

  it('paths are closed boxes in data units', () => {
    expect(runsPath([2, 5, 9, 10], 22, 300)).toBe('M2 22H5V300H2ZM9 22H10V300H9Z')
    expect(runsPath([], 0, 1)).toBe('')
  })
})

describe('lines', () => {
  it('slot averages skip coverage 2 and flag partial slots', () => {
    const v = [1, 2, 3, 4, 5, 6, NaN, 8]
    const c = [0, 0, 1, 0, 2, 2, 0, 0]
    const out: unknown[] = []
    slotAverages(v, c, 3, 1, (i0, i1, avg, partial) => out.push([i0, i1, avg, partial]))
    // the first slot starts one sample early (phase 1)
    expect(out).toEqual([
      [0, 2, 1.5, false],
      [2, 5, 3.5, true],
      [5, 8, 8, false],
    ])
  })

  it('a gap breaks the line, a lone point is a dot, partial slots dash', () => {
    const v = [10, 10, 10, 10, 10, 10, 10]
    const c = [0, 0, 2, 0, 2, 0, 1]
    const p = linePaths(v, c, 1, 0, x => 100 - x, true)
    expect(p.solid).toBe('M0.5 90L1.5 90')
    expect(p.dots).toBe('M3.5 90h0')
    expect(p.dashed).toBe('M5.5 90L6.5 90')
  })
})

describe('overviewPath', () => {
  it('returns one closed path over the full data at the finest level with 2 px per slot', () => {
    const chat = Float64Array.from({ length: 1440 }, (_, i) => (i < 720 ? 10 : 20))
    const o = overviewPath(chat, 600)!
    expect(o.width).toBe(600)
    expect(o.height).toBe(22)
    expect(o.d.startsWith('M0 22')).toBe(true)
    expect(o.d.endsWith('L600 22Z')).toBe(true)
    // 5-min slots (600 * 5 / 1440 >= 2): 288 slots, two points each
    expect(o.d.match(/L/g)!.length).toBe(288 * 2 + 1)
    // the busiest slot reaches the full amplitude (22 - 18 = 4)
    expect(o.d).toContain(' 4L')
    expect(o.d).toContain(' 13L')
    expect(overviewPath([], 600)).toBeNull()
    expect(overviewPath(chat, 0)).toBeNull()
  })

  it('never draws a coverage-2 sample', () => {
    const chat = [5, 5, 1000, 5]
    const o = overviewPath(chat, 400, { coverage: [0, 0, 2, 0], height: 20, amplitude: 10 })!
    expect(o.d).toBe('M0 20L0 10L100 10L100 10L200 10L200 20L300 20L300 10L400 10L400 20Z')
  })
})

describe('scale and layout', () => {
  it('formats values as passed', () => {
    expect(niceTicks(87, 3)).toEqual([0, 50, 100])
    expect(compact(9999)).toBe('9,999')
    expect(compact(20_000)).toBe('20K')
    expect(compact(1_240_000)).toBe('1.2M')
    expect(formatInt(1234.4)).toBe('1,234')
    expect(formatInt(null)).toBe('—')
    expect(formatElapsed(3 * 3600_000 + 15 * MIN + 59_000, 0)).toBe('3:15')
  })

  it('time ticks keep at least the min gap', () => {
    const e = elapsedTicks(0, 3 * 3600_000, 1400, 0)
    expect(e[0]).toBe(0)
    expect((1400 * (e[1]! - e[0]!)) / (3 * 3600_000)).toBeGreaterThanOrEqual(80)
    const c = clockTicks(Date.UTC(2026, 9, 12, 0, 7), Date.UTC(2026, 9, 13, 0, 7), 1000)
    expect((1000 * (c[1]! - c[0]!)) / 86_400_000).toBeGreaterThanOrEqual(96)
  })

  it('viewers sit in a lower panel of 25 % (at least 64 px) under the band', () => {
    const l = spLayout({ width: 1456, height: 420, tickColumn: 56, band: true, topPx: 0, rates: true, viewers: true, viewersCaption: true, ratesMax: 87, viewersMax: 41000 })
    expect(l.plotWidth).toBe(1400)
    expect(l.band).toEqual({ x: 0, y: 0, width: 1400, height: 22 })
    expect(l.viewers!.height).toBe(100)
    expect(l.rates!.y).toBe(22)
    expect(l.rates!.y + l.rates!.height).toBe(420 - 100 - 14)
    expect(l.rates!.dataTop).toBe(50)
    expect(l.viewers!.dataTop).toBe(320 + 22)
  })

  it('band segments hide under 2 px and label when they fit', () => {
    expect(bandBox(-10, 1, 800)).toMatchObject({ left: 0, width: 1, hidden: true })
    expect(bandBox(100, 150, 800)).toMatchObject({ width: 50, hidden: false, showLabel: true, showArt: false })
    expect(bandBox(100, 150, 800, true)).toMatchObject({ showLabel: false, showArt: true })
    expect(bandBox(700, 900, 800).width).toBe(100)
  })
})
