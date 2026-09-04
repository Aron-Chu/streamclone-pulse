import { describe, expect, it } from 'vitest'
import { screenerViewLabel } from '../src/lib/channelScreenerContract'
import {
  activityBucketKey,
  resolveMomentActivityBucket,
} from '../src/lib/hubActivitySummary'
import { momentRowKey, type FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'

describe('channelScreenerContract', () => {
  it('labels screener views', () => {
    expect(screenerViewLabel('overview')).toBe('Overview')
    expect(screenerViewLabel('momentum')).toBe('Momentum')
    expect(screenerViewLabel('coverage')).toBe('Coverage')
    expect(screenerViewLabel('anomalies')).toBe('Anomalies')
  })
})

describe('resolveMomentActivityBucket', () => {
  const windowMinutes = 24 * 60
  const bucketMs = 6 * 60_000
  const completedBucketT = Date.parse('2026-07-10T18:00:00Z')

  it('uses the exact rendered bucket when it exists', () => {
    expect(resolveMomentActivityBucket(
      completedBucketT + 90_000,
      new Set([completedBucketT]),
      windowMinutes,
    )).toEqual({ bucketT: completedBucketT, relation: 'exact' })
  })

  it('uses the immediately preceding completed bucket for a fresh open-bucket moment', () => {
    expect(resolveMomentActivityBucket(
      completedBucketT + bucketMs + 90_000,
      new Set([completedBucketT]),
      windowMinutes,
    )).toEqual({ bucketT: completedBucketT, relation: 'nearest_completed' })
  })

  it('fails closed across older gaps instead of selecting unrelated activity', () => {
    expect(resolveMomentActivityBucket(
      completedBucketT + bucketMs * 2 + 90_000,
      new Set([completedBucketT]),
      windowMinutes,
    )).toBeNull()
  })
})

describe('hub moment selection sync helpers', () => {
  it('derives accent bucket from selected moment.at', () => {
    const moment: FigmaMomentRow = {
      kind: 'emote_spike',
      login: 'zackrawrr',
      label: 'Emote spike',
      offsetSeconds: 120,
      score: 90,
      at: Date.parse('2026-07-10T18:00:00Z'),
    }
    const key = momentRowKey(moment)
    expect(key).toContain('zackrawrr')
    const bucket = activityBucketKey(moment.at!, 24 * 60)
    expect(Number.isFinite(bucket)).toBe(true)
  })
})
