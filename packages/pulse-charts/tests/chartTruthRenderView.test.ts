import { describe, expect, it } from 'vitest'
import {
  composeRenderView,
  contiguousPathRunsAcrossBuckets,
  pinsAddressableInRange,
} from '../src/renderView.ts'
import {
  chartViewerValue,
  viewerObservedValue,
  viewerReadoutValue,
} from '../src/chartRollupUtils.ts'

describe('LongStreamRenderViewPreservesIndependentSignalIdentity', () => {
  it('keeps each signal extrema tied to its own source minute', () => {
    const viewers = Array.from({ length: 1_000 }, (_, index) => index)
    const chat = Array.from({ length: 1_000 }, (_, index) => 1_000 - index)
    const emotes = Array.from({ length: 1_000 }, () => 0)
    emotes[777] = 5_000

    const view = composeRenderView({ viewers, chat, emotes }, 10)

    expect(view.ranges).toHaveLength(10)
    expect(view.signals.viewers?.[7]?.peak).toEqual({ index: 799, value: 799 })
    expect(view.signals.chat?.[7]?.peak).toEqual({ index: 700, value: 300 })
    expect(view.signals.emotes?.[7]?.peak).toEqual({ index: 777, value: 5_000 })
  })
})

describe('MissingRangesBreakEveryLinePath', () => {
  it('keeps missing ranges empty for every signal', () => {
    const view = composeRenderView({
      viewers: [100, null, 120],
      chat: [10, null, 12],
      emotes: [1, null, 2],
    }, 3)

    for (const buckets of Object.values(view.signals)) {
      expect(buckets[1]?.count).toBe(0)
      expect(buckets[1]?.pathSegments).toEqual([])
      expect(buckets[1]?.fullyObserved).toBe(false)
    }
  })
})

describe('InternalGapInsideOneRenderBucketBreaksPath', () => {
  it('does not bridge observed points around missing source minutes', () => {
    const view = composeRenderView({ viewers: [100, null, null, 120] }, 1)
    const bucket = view.signals.viewers?.[0]

    expect(bucket?.hasInternalGap).toBe(true)
    expect(bucket?.rangeLength).toBe(4)
    expect(bucket?.observedRatio).toBe(0.5)
    expect(bucket?.pathSegments).toEqual([
      [{ index: 0, value: 100 }],
      [{ index: 3, value: 120 }],
    ])
    expect(bucket?.pathSegments).not.toEqual([[{ index: 0, value: 100 }, { index: 3, value: 120 }]])
  })
})

describe('ContinuousAdjacentBucketsShareOneSubpath', () => {
  it('coalesces contiguous pathSegments across buckets into one run', () => {
    const view = composeRenderView({ viewers: [1, 2, 3, 4] }, 2)
    const buckets = view.signals.viewers ?? []
    expect(buckets).toHaveLength(2)
    const runs = contiguousPathRunsAcrossBuckets(buckets)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.map((point) => point.index)).toEqual([0, 1, 2, 3])
  })

  it('keeps a true null gap as separate runs', () => {
    const view = composeRenderView({ viewers: [1, 2, null, 4, 5] }, 2)
    const runs = contiguousPathRunsAcrossBuckets(view.signals.viewers ?? [])
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(runs.some((run) => run.some((point) => point.index === 2))).toBe(false)
  })
})

describe('MultiplePinsInOneRenderRangeRemainAddressable', () => {
  it('returns every pin whose canonical source minute is in range', () => {
    const pins = pinsAddressableInRange(
      [65, 89, 125, 181],
      60,
      120,
      [0, 60, 120, 180],
    )

    expect(pins).toEqual([65, 89, 125])
  })
})

describe('ViewerLineUsesSampledMinuteAverageAndPreservesObservedZero', () => {
  it('shares sampled average across plot and hover without KPI fallback', () => {
    const sampled = {
      minuteTs: '2026-08-12T12:00:00.000Z',
      viewerSamples: 3,
      viewerAvg: 90,
      viewerLatest: 100,
      viewerCount: 100,
    }
    const observedZero = {
      minuteTs: '2026-08-12T12:01:00.000Z',
      viewerSamples: 2,
      viewerAvg: 0,
      viewerLatest: 75,
      viewerCount: 75,
    }
    const unknown = {
      minuteTs: '2026-08-12T12:02:00.000Z',
      viewerSamples: 0,
      viewerAvg: 88,
      viewerLatest: 99,
      viewerCount: 99,
    }

    expect(chartViewerValue(sampled)).toBe(90)
    expect(viewerObservedValue(sampled)).toBe(90)
    expect(viewerReadoutValue(sampled)).toBe(90)
    expect(chartViewerValue(observedZero)).toBe(0)
    expect(viewerObservedValue(observedZero)).toBe(0)
    expect(viewerReadoutValue(observedZero)).toBe(0)
    expect(chartViewerValue(unknown)).toBeNull()
    expect(viewerObservedValue(unknown)).toBeNull()
    expect(viewerReadoutValue(unknown)).toBeNull()
  })
})
