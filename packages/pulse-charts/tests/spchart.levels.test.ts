import { describe, expect, it } from 'vitest'
import { BAR_LEVEL_HYSTERESIS, BAR_MIN_SLOT_PX, buildBarPyramid, pickBarLevel, type BarLevel } from '../src/barPyramid.ts'
import { barWindow, buildSpLevels, capLevel, fixedStep, needsRewindow, pickSpLevel, SP_RECT_CAP } from '../src/sp/bars.ts'
import type { SpBarOptions, SpChartData } from '../src/sp/types.ts'

const MIN = 60_000
const SESSION: SpBarOptions = { minSlotPx: 5, maxBars: 72, tolerance: 0.85, maxLevelMinutes: 10 }

/** pickBarLevel as it was before the options parameter (reference). */
function pickBarLevelBefore(levels: readonly BarLevel[], visibleSpanMs: number, plotWidthPx: number, cadenceMs: number, previousStep?: number | null) {
  if (levels.length === 0) return null
  const pxPerSample = plotWidthPx / Math.max(1, visibleSpanMs / cadenceMs + 1)
  const fits = (level: BarLevel, px: number) => level.step * pxPerSample >= px
  const ideal = levels.find(level => fits(level, BAR_MIN_SLOT_PX)) ?? levels[levels.length - 1]!
  const previous = levels.find(level => level.step === previousStep)
  if (!previous || previous === ideal) return ideal
  if (ideal.step < previous.step) {
    return levels.find(level => level.step < previous.step && fits(level, BAR_MIN_SLOT_PX * (1 + BAR_LEVEL_HYSTERESIS))) ?? previous
  }
  return fits(previous, BAR_MIN_SLOT_PX * (1 - BAR_LEVEL_HYSTERESIS)) ? previous : ideal
}

function minuteData(n: number, startMs = Date.UTC(2026, 9, 12, 0, 0, 0)): SpChartData {
  const chat = new Float64Array(n), emotes = new Float64Array(n), viewers = new Float64Array(n), coverage = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    chat[i] = 20 + ((i * 37) % 50)
    emotes[i] = 5 + ((i * 13) % 20)
    viewers[i] = 1000 + (i % 60) * 10
  }
  return { startMs, stepMs: MIN, chat, emotes, viewers, coverage }
}

const full = (d: SpChartData) => ({ startIndex: 0, endIndex: d.chat.length - 1 })
const minutesOf = (level: BarLevel | null) => (level ? level.slotMs / MIN : null)

describe('pickBarLevel options', () => {
  it('keeps the default rule identical to the reference over a grid', () => {
    const times = Array.from({ length: 3000 }, (_, i) => i * MIN)
    const chat = times.map((_, i) => (i % 11 === 4 ? null : 10 + (i % 7)))
    const levels = buildBarPyramid(times, [chat], MIN, 0)
    let checked = 0
    for (const width of [120, 300, 640, 1000, 1400, 2048, 4000]) {
      for (const spanMin of [1, 5, 30, 59, 60, 195, 240, 748, 1440, 2880, 2999]) {
        for (const prev of [undefined, null, 0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 7]) {
          const want = pickBarLevelBefore(levels, spanMin * MIN, width, MIN, prev)
          expect(pickBarLevel(levels, spanMin * MIN, width, MIN, prev)).toBe(want)
          expect(pickBarLevel(levels, spanMin * MIN, width, MIN, prev, {})).toBe(want)
          checked += 1
        }
      }
    }
    expect(checked).toBe(7 * 11 * 13)
    expect(pickBarLevel([], MIN, 100, MIN)).toBeNull()
  })

  it('session options: 5-min at 3h15, 10-min at 12h28, 1-min at 1h (plot 1400)', () => {
    const at = (minutes: number) => {
      const d = minuteData(minutes)
      return minutesOf(pickSpLevel(buildSpLevels(d, d.startMs), full(d), 1400, MIN, null, SESSION, false))
    }
    expect(at(195)).toBe(5)
    expect(at(748)).toBe(10)
    expect(at(60)).toBe(1)
  })

  it('session options: the 10-min ceiling holds while 5 px fit, and lifts only when it does not', () => {
    const at = (minutes: number, width = 1400) => {
      const d = minuteData(minutes)
      return minutesOf(pickSpLevel(buildSpLevels(d, d.startMs), full(d), width, MIN, null, SESSION, false))
    }
    expect(at(1440)).toBe(10)
    expect(at(2880)).toBe(15)
    // a phone-width plot: 10-min slots would be under 5 px at 12 h
    expect(at(748, 300)).toBe(15)
  })

  it('hub: a fixed 6-min level at 24h, clock-aligned (alignMs 0)', () => {
    // minute data starting off the 6-min grid
    const d = minuteData(1440, Date.UTC(2026, 9, 12, 21, 28, 0))
    const step = fixedStep(6, d.stepMs)
    const levels = buildSpLevels(d, 0, step)
    const level = pickSpLevel(levels, full(d), 1000, d.stepMs, null, null, step > 0)!
    expect(minutesOf(level)).toBe(6)
    expect(level.buckets.length).toBeGreaterThan(0)
    for (const b of level.buckets) expect(b.startMs % (6 * MIN)).toBe(0)
    // the first bucket starts on the grid before the data and is short, not partial
    expect(level.buckets[0]!.startMs).toBe(Date.UTC(2026, 9, 12, 21, 24, 0))
    expect(level.buckets[0]!.observed).toBe(level.buckets[0]!.expected)
    // 6-min samples: the fixed level is the sample step itself
    const six: SpChartData = { ...minuteData(240, Date.UTC(2026, 9, 12, 0, 0, 0)), stepMs: 6 * MIN }
    const sixStep = fixedStep(6, six.stepMs)
    expect(sixStep).toBe(1)
    const sixLevel = pickSpLevel(buildSpLevels(six, 0, sixStep), full(six), 1000, six.stepMs, null, null, true)!
    expect(minutesOf(sixLevel)).toBe(6)
    expect(sixLevel.buckets.length).toBe(240)
  })

  it('fixedLevelMinutes is the floor when barOptions are given', () => {
    const d = minuteData(60)
    const levels = buildSpLevels(d, d.startMs, fixedStep(2, MIN))
    expect(levels.map(l => l.step)).toEqual([2, 5, 10, 15, 30, 60, 120, 240])
    expect(minutesOf(pickSpLevel(levels, full(d), 1400, MIN, null, SESSION, true))).toBe(2)
    expect(fixedStep(null, MIN)).toBe(0)
    expect(fixedStep(0, MIN)).toBe(0)
  })

  it('never builds a bar from a coverage-2 sample', () => {
    const d = minuteData(30)
    const cov = d.coverage as Uint8Array
    for (let i = 10; i < 20; i += 1) cov[i] = 2
    const one = buildSpLevels(d, d.startMs)[0]!
    expect(one.buckets.some(b => b.from >= 10 && b.from < 20)).toBe(false)
    const ten = buildSpLevels(d, d.startMs).find(l => l.step === 10)!
    expect(ten.buckets.map(b => b.startMs)).toEqual([d.startMs, d.startMs + 20 * MIN])
  })
})

describe('rect cap', () => {
  it('holds at most 600 rects for any range, width and level', () => {
    const d = minuteData(7 * 1440)
    const levels = buildSpLevels(d, 0)
    let maxRects = 0
    for (const width of [320, 1000, 2048, 4000, 8000]) {
      for (const span of [30, 300, 1440, 4000, 10079]) {
        for (const start of [0, 1234, 10079 - span]) {
          const range = { startIndex: Math.max(0, start), endIndex: Math.max(0, start) + span }
          for (const bo of [null, SESSION]) {
            const picked = pickSpLevel(levels, range, width, MIN, null, bo, false)!
            const level = capLevel(levels, picked, span + 1)
            const win = barWindow(level, d, range)
            const rects = win.to - win.from
            maxRects = Math.max(maxRects, rects)
            expect(rects).toBeLessThanOrEqual(SP_RECT_CAP)
            // the window covers the visible range
            expect(win.u0).toBeLessThanOrEqual(range.startIndex)
            expect(win.u1).toBeGreaterThanOrEqual(Math.min(d.chat.length, range.endIndex + 1))
          }
        }
      }
    }
    expect(maxRects).toBeGreaterThan(300)
  })

  it('a 1-min plot of 7 days at 8000 px coarsens until the bars fit', () => {
    const d = minuteData(7 * 1440)
    const levels = buildSpLevels(d, 0)
    const level = capLevel(levels, levels[0]!, d.chat.length)
    expect(Math.ceil(d.chat.length / level.step) + 2).toBeLessThanOrEqual(SP_RECT_CAP)
  })

  it('re-windows only past half the overscan', () => {
    const d = minuteData(7 * 1440)
    const levels = buildSpLevels(d, 0)
    const range = { startIndex: 5000, endIndex: 5100 }
    const level = levels[0]!
    const win = barWindow(level, d, range)
    expect(needsRewindow(win, range, d.chat.length)).toBe(false)
    const shift = win.half + 2
    expect(needsRewindow(win, { startIndex: range.startIndex - (range.startIndex - win.u0) + shift - 3, endIndex: range.endIndex }, d.chat.length)).toBe(true)
    expect(needsRewindow(win, { startIndex: range.startIndex, endIndex: win.u1 - 1 }, d.chat.length)).toBe(true)
  })
})
