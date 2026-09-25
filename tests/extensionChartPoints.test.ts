import { describe, expect, it } from 'vitest'
import {
  chartBucketRanges,
  downsampleRollupsForChart,
  nearestRollupIndex,
} from '../src/ui/extensionChartPoints.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'

function rollup(offsetSeconds: number, chatCount: number, emotes = 0): ExtensionRollup {
  return { offsetSeconds, chatCount, sevenTvEmoteCount: emotes }
}

describe('extensionChartPoints', () => {
  it('downsample preserves the peak minute in a long session', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 240 }, (_, i) =>
      rollup(i * 60, i === 137 ? 999 : 1, 0),
    )
    const sampled = downsampleRollupsForChart(rollups, 60)
    expect(sampled.length).toBeLessThanOrEqual(60)
    expect(sampled.some(point => (point.chatCount ?? 0) === 999)).toBe(true)
  })

  it('returns bucket representatives unmodified instead of merging peak viewers', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 240 }, (_, i) =>
      rollup(i * 60, 100, 0),
    )
    // A quiet minute holding the bucket's highest viewer sample must not lend
    // that sample to the busy minute the bar actually represents.
    rollups[50] = { offsetSeconds: 50 * 60, chatCount: 1, sevenTvEmoteCount: 0, viewerCount: 42_000 }

    const sampled = downsampleRollupsForChart(rollups, 60)
    expect(sampled.some(point => (point.viewerCount ?? 0) === 42_000)).toBe(false)
    // Every emitted bar is an object identity from the source list.
    expect(sampled.every(point => rollups.includes(point))).toBe(true)
  })

  it('bucket ranges cover every source index exactly once', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 25 }, (_, i) => rollup(i * 60, i))
    const ranges = chartBucketRanges(rollups, 5)
    expect(ranges).toHaveLength(5)
    expect(ranges[0]?.start).toBe(0)
    expect(ranges[ranges.length - 1]?.end).toBe(25)
    ranges.forEach((range, index) => {
      if (index === 0) return
      expect(range.start).toBe(ranges[index - 1]?.end)
    })
  })

  it('finds nearest ordered rollups with clamping, ties, irregular gaps, and empty input', () => {
    const samples = [
      rollup(10, 1),
      rollup(35, 2),
      rollup(120, 3),
      rollup(121, 4),
    ]
    expect(nearestRollupIndex([], 10)).toBe(-1)
    expect(nearestRollupIndex(samples, 35)).toBe(1)
    expect(nearestRollupIndex(samples, -100)).toBe(0)
    expect(nearestRollupIndex(samples, 999)).toBe(3)
    expect(nearestRollupIndex(samples, 22.5)).toBe(0)
    expect(nearestRollupIndex(samples, 100)).toBe(2)
    expect(nearestRollupIndex(samples, 120.6)).toBe(3)
  })
})
