import { describe, expect, it } from 'vitest'
import { barBucketAt, barLevelRange, buildBarPyramid, pickBarLevel } from '../src/barPyramid.ts'

const MIN = 60_000

function minutes(count: number, opts: { start?: number; phaseMs?: number; missing?: Set<number>; drop?: Set<number> } = {}) {
  const start = opts.start ?? 0
  const times: Array<number | null> = []
  const chat: Array<number | null> = []
  const emotes: Array<number | null> = []
  for (let i = 0; i < count; i += 1) {
    if (opts.drop?.has(i)) continue
    times.push(start + (opts.phaseMs ?? 0) + i * MIN)
    const measured = !opts.missing?.has(i)
    chat.push(measured ? (i % 7 === 3 ? 100 : 10) : null)
    emotes.push(measured ? i : null)
  }
  return { times, chat, emotes }
}

describe('bar pyramid', () => {
  it('averages aligned slots, keeps peaks, and marks gaps and partial slots', () => {
    const data = minutes(30, { missing: new Set([12, 13]), drop: new Set([20, 21, 22, 23, 24]) })
    const levels = buildBarPyramid(data.times, [data.chat, data.emotes], MIN, 0)
    const ten = levels.find(l => l.step === 10)!
    expect(ten.buckets.map(b => [b.startMs / MIN, b.observed, b.expected])).toEqual([[0, 10, 10], [10, 8, 10], [20, 5, 10]])
    expect(ten.buckets[0]!.avg[0]).toBeCloseTo((10 * 9 + 100) / 10)
    expect(ten.buckets[0]!.peak[0]).toBe(100)
    expect(ten.buckets[0]!.peakAt[0]).toBe(3)
    const one = levels.find(l => l.step === 1)!
    // Missing minutes 12 and 13 and dropped 20-24 have no bucket.
    expect(one.buckets.length).toBe(30 - 2 - 5)
    expect(barBucketAt(one, 12.5 * MIN)).toBeNull()
    expect(barBucketAt(ten, 12.5 * MIN)?.startMs).toBe(10 * MIN)
  })

  it('clips edge slots to the data domain so they are short, not partial', () => {
    const data = minutes(21, { phaseMs: 31_000, start: 7 * MIN })
    const ten = buildBarPyramid(data.times, [data.chat], MIN, 7 * MIN).find(l => l.step === 10)!
    expect(ten.buckets.map(b => [b.observed, b.expected])).toEqual([[10, 10], [10, 10], [1, 1]])
  })

  it('slices with binary search', () => {
    const data = minutes(720)
    const ten = buildBarPyramid(data.times, [data.chat], MIN, 0).find(l => l.step === 10)!
    expect(barLevelRange(ten, 95 * MIN, 205 * MIN)).toEqual([9, 21])
  })

  it('picks levels for the spec table', () => {
    const levels = buildBarPyramid(minutes(10).times, [minutes(10).chat], MIN, 0)
    const pick = (spanMin: number, px: number) => pickBarLevel(levels, (spanMin - 1) * MIN, px, MIN)!.step
    // Extension panel plot (340 px chat column less the plot pads).
    expect(pick(21, 324)).toBe(1)
    expect(pick(180, 324)).toBe(5)
    expect(pick(720, 324)).toBe(15)
    expect(pick(60, 324)).toBe(1)
    // Site stream plot at 1440x900.
    expect(pick(21, 786)).toBe(1)
    expect(pick(180, 786)).toBe(2)
    expect(pick(720, 786)).toBe(5)
    expect(pick(60, 786)).toBe(1)
    // Site stream plot at 2048x1018 @1.25.
    expect(pick(21, 1090)).toBe(1)
    expect(pick(180, 1090)).toBe(1)
    expect(pick(720, 1090)).toBe(5)
    expect(pick(60, 1090)).toBe(1)
    // Site phone plot.
    expect(pick(21, 340)).toBe(1)
    expect(pick(180, 340)).toBe(5)
    expect(pick(720, 340)).toBe(15)
    expect(pick(60, 340)).toBe(1)
  })

  it('holds a level inside the hysteresis band', () => {
    const levels = buildBarPyramid(minutes(10).times, [minutes(10).chat], MIN, 0)
    // 1090 px over 180 min: 6.02 px per minute, so 1-min bars fit (>= 5).
    expect(pickBarLevel(levels, 179 * MIN, 1090, MIN)!.step).toBe(1)
    // 960 px: 5.3 px per minute. Fresh pick is 1; coming from 2 it stays 2 (needs 5.75).
    expect(pickBarLevel(levels, 179 * MIN, 960, MIN)!.step).toBe(1)
    expect(pickBarLevel(levels, 179 * MIN, 960, MIN, 2)!.step).toBe(2)
    // 800 px: 4.4 px per minute. Fresh pick is 2; coming from 1 it stays 1 (>= 4.25).
    expect(pickBarLevel(levels, 179 * MIN, 800, MIN, 1)!.step).toBe(1)
    expect(pickBarLevel(levels, 179 * MIN, 700, MIN, 1)!.step).toBe(2)
  })

  it('handles empty input and a single sample', () => {
    expect(pickBarLevel([], 60 * MIN, 324, MIN)).toBeNull()
    const empty = buildBarPyramid([], [[]], MIN, 0)
    expect(empty.every(level => level.buckets.length === 0)).toBe(true)
    const single = buildBarPyramid([5 * MIN], [[42]], MIN, 0)
    const one = pickBarLevel(single, 0, 324, MIN)!
    expect(one.step).toBe(1)
    expect(one.buckets).toHaveLength(1)
    expect(one.buckets[0]).toMatchObject({ startMs: 5 * MIN, observed: 1, expected: 1, avg: [42], peak: [42], peakAt: [0] })
    expect(barBucketAt(one, 5.5 * MIN)).toBe(one.buckets[0])
    expect(barBucketAt(one, 6 * MIN)).toBeNull()
  })

  it('builds 12h of minutes for 2 series and slices every level', () => {
    const data = minutes(720)
    const levels = buildBarPyramid(data.times, [data.chat, data.emotes], MIN, 0)
    expect(levels.map(level => level.buckets.length)).toEqual([720, 360, 144, 72, 48, 24, 12, 6, 3])
    for (const level of levels) {
      const [from, to] = barLevelRange(level, 0, 719 * MIN)
      expect(to - from).toBe(level.buckets.length)
    }
  })
})

describe('measured extent', () => {
  it('spans a partial bar over its measured minutes only', () => {
    const times = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(m => m * 60_000)
    const chat = [null, null, 5, 5, 5, 5, 5, 5, null, null]
    const five = buildBarPyramid(times, [chat], 60_000, 0).find(l => l.step === 5)!
    expect(five.buckets.map(b => [b.firstMs / 60_000, b.lastMs / 60_000, b.observed, b.expected])).toEqual([[2, 4, 3, 5], [5, 7, 3, 5]])
  })
})
