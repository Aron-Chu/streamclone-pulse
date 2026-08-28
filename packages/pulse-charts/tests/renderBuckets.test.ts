import { describe, expect, it } from 'vitest'
import { buildRenderBucketRanges, buildRenderBuckets } from '../src/renderBuckets.ts'

describe('render-level peak buckets', () => {
  it('keeps contiguous source ranges and exact peak indices', () => {
    expect(buildRenderBucketRanges(5, 2)).toEqual([
      { bucketIndex: 0, startIndex: 0, endExclusive: 2 },
      { bucketIndex: 1, startIndex: 2, endExclusive: 5 },
    ])

    const result = buildRenderBuckets({
      chat: [1, 9, 2, 3, 8],
      emotes: [5, 2, 11, 1, 4],
    }, 2)

    expect(result.signals.chat?.map(bucket => bucket.peak)).toEqual([
      { index: 1, value: 9 },
      { index: 4, value: 8 },
    ])
    expect(result.signals.emotes?.map(bucket => bucket.peak)).toEqual([
      { index: 0, value: 5 },
      { index: 2, value: 11 },
    ])
    expect(result.signals.chat?.map(bucket => bucket.average)).toEqual([5, 13 / 3])
    expect(result.signals.chat?.map(bucket => bucket.count)).toEqual([2, 3])
  })

  it('keeps each signal at its own source timestamp instead of cross-signal mixing', () => {
    const result = buildRenderBuckets({
      chat: [0, 100, 0, 0],
      viewers: [500, 0, 0, 0],
    }, 1)
    expect(result.signals.chat?.[0]?.peak?.index).toBe(1)
    expect(result.signals.viewers?.[0]?.peak?.index).toBe(0)
    expect(result.signals.chat?.[0]?.peak?.index).not.toBe(result.signals.viewers?.[0]?.peak?.index)
  })

  it('preserves null-only gaps as empty signal buckets', () => {
    const result = buildRenderBuckets({ chat: [null, null, 2, null] }, 2)
    expect(result.signals.chat?.[0]?.peak).toBeNull()
    expect(result.signals.chat?.[0]?.average).toBeNull()
    expect(result.signals.chat?.[0]?.count).toBe(0)
    expect(result.signals.chat?.[1]?.peak).toEqual({ index: 2, value: 2 })
  })
})
