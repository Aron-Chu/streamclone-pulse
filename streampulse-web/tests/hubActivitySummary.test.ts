import { describe, expect, it } from 'vitest'
import {
  bucketMinutes,
  internalGapCount,
  maxConnectedGapMs,
  summarizeActivity,
} from '../src/lib/hubActivitySummary'
import type { HubActivityPoint } from '../src/lib/publicHub'

function point(tMinutes: number, chat = 10): HubActivityPoint {
  return { t: tMinutes * 60_000, chat, seventv: 0, viewers: 100 }
}

describe('bucketMinutes', () => {
  it('returns 1 for windows at or below the backend point cap', () => {
    expect(bucketMinutes(30)).toBe(1)
    expect(bucketMinutes(240)).toBe(1)
  })

  it('widens buckets for long windows', () => {
    expect(bucketMinutes(480)).toBe(2)
    expect(bucketMinutes(24 * 60)).toBe(6)
  })
})

describe('internalGapCount', () => {
  it('returns 0 for sparse or single-point series', () => {
    expect(internalGapCount([], 30)).toBe(0)
    expect(internalGapCount([point(0)], 30)).toBe(0)
  })

  it('counts gaps when adjacent buckets exceed the connected threshold', () => {
    const windowMinutes = 30
    const maxGap = maxConnectedGapMs(windowMinutes)
    const gapMinutes = Math.ceil(maxGap / 60_000) + 1
    const points = [point(0), point(gapMinutes), point(gapMinutes * 2 + 5)]
    expect(internalGapCount(points, windowMinutes)).toBe(2)
  })

  it('does not count small spacing within bucket tolerance', () => {
    const points = [point(0), point(1), point(2), point(3)]
    expect(internalGapCount(points, 30)).toBe(0)
  })
})

describe('summarizeActivity', () => {
  it('summarizes sparse activity with bucket and channel counts', () => {
    const points = [point(0, 0), point(1, 5), point(2, 0)]
    const summary = summarizeActivity(points, 30, 12, '12s ago')
    expect(summary.pointCount).toBe(3)
    expect(summary.nonZeroCount).toBe(1)
    expect(summary.gapCount).toBe(0)
    expect(summary.bucketMinutes).toBe(1)
    expect(summary.windowLabel).toBe('30 minute')
    expect(summary.footnote).toContain('3 buckets')
    expect(summary.footnote).toContain('12 channels in pool')
    expect(summary.footnote).toContain('updated 12s ago')
  })

  it('reports gap count for gappy fixtures', () => {
    const windowMinutes = 24 * 60
    const maxGap = maxConnectedGapMs(windowMinutes)
    const gapMinutes = Math.ceil(maxGap / 60_000) + 2
    const points = [point(0, 8), point(gapMinutes, 12), point(gapMinutes * 2 + 10, 4)]
    const summary = summarizeActivity(points, windowMinutes, 40)
    expect(summary.gapCount).toBe(2)
    expect(summary.bucketMinutes).toBe(6)
  })
})
