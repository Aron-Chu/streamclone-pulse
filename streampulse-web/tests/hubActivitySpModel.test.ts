import { describe, expect, it } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { bucketMinutes as clientBucketMinutes } from '../src/lib/hubActivitySummary'
import {
  barTopEmotes,
  barViewerChannels,
  buildHubActivitySpModel,
  hubBucketMinutes,
  pointSpacingMinutes,
  sortedTopEmotes,
} from '../src/ui/components/hub/hubActivitySpModel'

const MIN = 60_000
/** A clock-aligned bucket end (18:00 UTC is on every 6- and 10-minute grid). */
const END = Date.UTC(2026, 9, 13, 18, 0, 0)

function series(count: number, bucketMinutes: number, more: (index: number) => Partial<HubActivityPoint> = () => ({})): HubActivityPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    t: END - (count - 1 - index) * bucketMinutes * MIN,
    chat: (100 + ((index * 37) % 200)) * bucketMinutes,
    emotes: (40 + ((index * 13) % 80)) * bucketMinutes,
    seventv: (20 + ((index * 7) % 20)) * bucketMinutes,
    viewers: 200_000 + index * 100,
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    viewerCoverage: 'complete',
    viewerContributors: 80,
    viewerExpectedContributors: 100,
    ...more(index),
  }))
}

describe('hubBucketMinutes: the server bucket is the floor', () => {
  it('takes activity.bucketMinutes from the API, never a fixed value', () => {
    expect(hubBucketMinutes(1440, 6)).toBe(6)
    expect(hubBucketMinutes(1440, 5)).toBe(5)
    expect(hubBucketMinutes(10080, 10)).toBe(10)
    expect(hubBucketMinutes(10080, 60)).toBe(60)
  })

  it('falls back to the client rule only for a legacy payload without bucketMinutes', () => {
    expect(hubBucketMinutes(1440, null)).toBe(clientBucketMinutes(1440))
    expect(hubBucketMinutes(30, undefined)).toBe(clientBucketMinutes(30))
    expect(hubBucketMinutes(1440, 0)).toBe(clientBucketMinutes(1440))
  })

  it('lets denser served points win so two buckets never share a slot', () => {
    expect(hubBucketMinutes(1440, 6, 1)).toBe(1)
    expect(hubBucketMinutes(1440, 6, 12)).toBe(6)
    expect(pointSpacingMinutes(series(5, 6))).toBe(6)
    expect(pointSpacingMinutes(series(1, 6))).toBeNull()
  })
})

describe('buildHubActivitySpModel', () => {
  it('places one sample per served bucket on the clock-aligned grid, as per-minute rates', () => {
    const points = series(240, 6)
    const model = buildHubActivitySpModel(points, 1440, { bucketMinutes: 6 })!
    expect(model.bucketMinutes).toBe(6)
    expect(model.bucketMs).toBe(6 * MIN)
    expect(model.count).toBe(240)
    expect(model.data.stepMs).toBe(6 * MIN)
    expect(model.data.startMs).toBe(points[0]!.t)
    expect(model.data.startMs % (6 * MIN)).toBe(0)
    expect(model.data.chat[0]).toBeCloseTo(points[0]!.chat / 6)
    expect(model.data.emotes[10]).toBeCloseTo(points[10]!.emotes! / 6)
    expect(model.data.viewers[239]).toBe(points[239]!.viewers)
    expect(Array.from(model.data.coverage).every((value) => value === 0)).toBe(true)
  })

  it('uses a 10-minute served bucket for 7 days without changing anything else', () => {
    const model = buildHubActivitySpModel(series(1008, 10), 10080, { bucketMinutes: 10 })!
    expect(model.bucketMinutes).toBe(10)
    expect(model.count).toBe(1008)
    expect(model.data.chat[5]).toBeCloseTo((100 + ((5 * 37) % 200)))
  })

  it('drops the open trailing bucket', () => {
    const points = series(240, 6, (index) => (index === 239 ? { bucketComplete: false } : {}))
    const model = buildHubActivitySpModel(points, 1440, { bucketMinutes: 6 })!
    expect(model.data.startMs + (model.count - 1) * model.bucketMs).toBe(points[238]!.t)
    expect(model.latest!.t).toBe(points[238]!.t)
  })

  it('draws viewers only where the backend states a viewer coverage, and marks the rest as gaps', () => {
    const points = series(10, 6, (index) => (index === 3 ? { viewerCoverage: undefined } : index === 4 ? { viewerCoverage: 'partial' } : {}))
    const model = buildHubActivitySpModel(points, 60, { bucketMinutes: 6 })!
    expect(Number.isNaN(model.data.viewers[3]!)).toBe(true)
    expect(model.data.viewers[4]).toBe(points[4]!.viewers)
    expect(model.data.coverage[4]).toBe(1)
    expect(model.data.coverage[5]).toBe(0)
  })

  it('leaves slots without a served point as gaps (coverage 2, no value)', () => {
    const points = series(10, 6).filter((_, index) => index !== 6)
    const model = buildHubActivitySpModel(points, 60, { bucketMinutes: 6 })!
    expect(model.points[6]).toBeNull()
    expect(model.data.coverage[6]).toBe(2)
    expect(Number.isNaN(model.data.chat[6]!)).toBe(true)
  })

  it('takes peaks as the max over the served points and stamps the busiest chat bucket\'s top emote', () => {
    const points = series(20, 6, (index) => (index === 12
      ? { chat: 9_000 * 6, topEmotes: [{ name: 'KEKW', count: 40 }, { name: 'OMEGALUL', count: 3_327 }] }
      : {}))
    const model = buildHubActivitySpModel(points, 120, { bucketMinutes: 6 })!
    expect(model.peakChat).toMatchObject({ value: 9_000, index: 12, t: points[12]!.t })
    expect(model.peakViewers).toMatchObject({ value: points[19]!.viewers, index: 19, live: 80 })
    expect(model.stamp).toMatchObject({ index: 12, emote: { name: 'OMEGALUL', count: 3_327 } })
    expect(sortedTopEmotes(points[12]).map((emote) => emote.name)).toEqual(['OMEGALUL', 'KEKW'])
  })

  it('splits emotes into 7TV and other (emotes − 7TV) per minute', () => {
    const model = buildHubActivitySpModel(series(10, 6), 60, { bucketMinutes: 6 })!
    const point = model.points[2]!
    expect(model.sevenTv[2]).toBeCloseTo(point.seventv / 6)
    expect(model.other[2]).toBeCloseTo((point.emotes! - point.seventv) / 6)
  })

  it('marks 7TV a lower bound only from its own coverage, and other when provider counts are lower bounds', () => {
    const plain = buildHubActivitySpModel(series(10, 6), 60, { bucketMinutes: 6 })!
    expect(plain.sevenTvLowerBound).toBe(false)
    expect(plain.otherLowerBound).toBe(false)
    const counts = buildHubActivitySpModel(series(10, 6, (index) => (index === 4 ? { providerCountsLowerBound: true } : {})), 60, { bucketMinutes: 6 })!
    expect(counts.sevenTvLowerBound).toBe(false)
    expect(counts.otherLowerBound).toBe(true)
    const seventv = buildHubActivitySpModel(series(10, 6), 60, {
      bucketMinutes: 6,
      providerCoverage: { seventv: { state: 'partial', lowerBound: true } as never },
    })!
    expect(seventv.sevenTvLowerBound).toBe(true)
  })

  it('sums top emotes and averages live channels over a bar', () => {
    const points = series(4, 6, (index) => ({
      topEmotes: [{ name: 'KEKW', count: 10 + index }, { name: index % 2 ? 'LUL' : 'Pog', count: 5 }],
      viewerContributors: 70 + index * 2,
    }))
    const model = buildHubActivitySpModel(points, 24, { bucketMinutes: 6 })!
    const top = barTopEmotes(model, 0, 4, 3)
    expect(top[0]).toMatchObject({ name: 'KEKW', count: 10 + 11 + 12 + 13 })
    expect(top.map((emote) => emote.count)).toEqual([46, 10, 10])
    expect(barViewerChannels(model, 0, 4)).toEqual({ live: 73, roster: 100, members: 4 })
  })

  it('returns null without a closed served bucket', () => {
    expect(buildHubActivitySpModel([], 1440, { bucketMinutes: 6 })).toBeNull()
    expect(buildHubActivitySpModel(series(1, 6, () => ({ bucketComplete: false })), 1440, { bucketMinutes: 6 })).toBeNull()
  })
})
