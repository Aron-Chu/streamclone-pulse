import { describe, expect, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { assignMomentsToBuckets, momentsForBucket } from '../src/ui/bucketMoments.ts'
import { bucketRollupsForChart } from '../src/ui/segmentedBarChart.ts'

function rollup(offsetSeconds: number): ExtensionRollup {
  return { offsetSeconds, chatCount: 1, topEmotes: [] }
}

describe('momentsForBucket', () => {
  it('dedupes moments within tolerance', () => {
    const buckets = bucketRollupsForChart([rollup(0), rollup(60), rollup(120)])
    const bucket = buckets[1]!
    const pins = momentsForBucket(
      bucket,
      [
        { offsetSeconds: 70, score: 90, reasons: ['emote_spike'] },
        { offsetSeconds: 75, score: 80, reasons: ['chat_spike'] },
      ],
      2,
    )
    expect(pins).toHaveLength(1)
    expect(pins[0]?.score).toBe(90)
  })

  it('returns empty for buckets with no moments', () => {
    const buckets = bucketRollupsForChart([rollup(0), rollup(60)])
    expect(momentsForBucket(buckets[0]!, [{ offsetSeconds: 500, score: 10 }])).toEqual([])
  })
})

describe('assignMomentsToBuckets', () => {
  it('assigns highest-score moment per bucket', () => {
    const buckets = bucketRollupsForChart([rollup(0), rollup(60), rollup(120)])
    const map = assignMomentsToBuckets(buckets, [
      { offsetSeconds: 65, score: 50, reasons: ['chat_spike'] },
      { offsetSeconds: 5, score: 99, reasons: ['emote_spike'] },
    ])
    expect(map.get(0)?.[0]?.score).toBe(99)
    expect(map.get(1)?.[0]?.score).toBe(50)
    expect(map.get(2)).toEqual([])
  })
})
