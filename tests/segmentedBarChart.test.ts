import { describe, expect, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { assignMomentsToBuckets } from '../src/ui/bucketMoments.ts'
import {
  bucketRollupsForChart,
  rollupActivityScore,
  streamPeakFromBuckets,
} from '../src/ui/segmentedBarChart.ts'

function rollup(offsetSeconds: number, chat: number, emotes: number): ExtensionRollup {
  return {
    offsetSeconds,
    chatCount: chat,
    totalEmoteCount: emotes,
    topEmotes: [],
  }
}

describe('bucketRollupsForChart', () => {
  it('maps one rollup per bar when under cap', () => {
    const buckets = bucketRollupsForChart([
      rollup(0, 10, 2),
      rollup(60, 50, 8),
    ])
    expect(buckets).toHaveLength(2)
    expect(buckets[1]?.chatPeak).toBe(50)
    expect(buckets[1]?.emotePeak).toBe(8)
    expect(buckets[1]?.rollupIndex).toBe(1)
  })

  it('preserves peak chat and emotes per bucket when downsampling', () => {
    const rollups = Array.from({ length: 120 }, (_, i) => rollup(i * 60, i, i % 5))
    rollups[40] = rollup(40 * 60, 999, 77)
    const buckets = bucketRollupsForChart(rollups, { maxBars: 24 })
    expect(buckets.length).toBeLessThanOrEqual(24)
    const peakChat = Math.max(...buckets.map(b => b.chatPeak))
    const peakEmotes = Math.max(...buckets.map(b => b.emotePeak))
    expect(peakChat).toBe(999)
    expect(peakEmotes).toBe(77)
  })

  it('rollupActivityScore prefers chat over emotes', () => {
    expect(rollupActivityScore(rollup(0, 2, 100))).toBeGreaterThan(
      rollupActivityScore(rollup(60, 1, 100)),
    )
  })

  it('streamPeakFromBuckets returns maxima', () => {
    const buckets = bucketRollupsForChart([rollup(0, 3, 1), rollup(60, 9, 4)])
    expect(streamPeakFromBuckets(buckets)).toEqual({ peakChat: 9, peakEmotes: 4 })
  })
})

describe('assignMomentsToBuckets', () => {
  it('places top moment in matching bucket', () => {
    const buckets = bucketRollupsForChart([
      rollup(0, 1, 0),
      rollup(60, 5, 1),
      rollup(120, 2, 0),
    ])
    const pins = assignMomentsToBuckets(buckets, [
      { offsetSeconds: 75, score: 90, reasons: ['emote_spike'] },
    ])
    expect(pins.get(1)?.[0]?.label).toBe('emote spike')
  })
})
