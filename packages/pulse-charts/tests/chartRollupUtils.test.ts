import { describe, expect, it } from 'vitest'
import {
  buildCompositeOverviewSeries,
  chartBarBucketOpacity,
} from '../src/chartRollupUtils.ts'

describe('chartBarBucketOpacity', () => {
  it('keeps bars faint at rest and fades the future after an active bucket', () => {
    const base = 0.8
    const rest = chartBarBucketOpacity({ index: 0, activeIndex: null, baseOpacity: base })
    const past = chartBarBucketOpacity({
      index: 0,
      activeIndex: 1,
      baseOpacity: base,
      fadeFutureAfterActive: true,
    })
    const active = chartBarBucketOpacity({
      index: 1,
      activeIndex: 1,
      baseOpacity: base,
      highlightOpacity: 0.9,
      fadeFutureAfterActive: true,
    })
    const future = chartBarBucketOpacity({
      index: 2,
      activeIndex: 1,
      baseOpacity: base,
      fadeFutureAfterActive: true,
    })

    expect(rest).toBeCloseTo(0.336)
    expect(past).toBeGreaterThan(future)
    expect(active).toBeGreaterThan(past)
  })
})

describe('buildCompositeOverviewSeries', () => {
  const signals = {
    viewers: [100, 120, 140, 130, 160],
    chat: [10, 12, 30, 14, 18],
    emotes: [2, 8, 3, 11, 4],
  }

  it('lets viewer, chat, and emote movement each affect the overview', () => {
    const composite = buildCompositeOverviewSeries([
      { values: signals.viewers, weight: 0.1 },
      { values: signals.chat, weight: 0.48 },
      { values: signals.emotes, weight: 0.42 },
    ], 1)

    const withoutChatSpike = buildCompositeOverviewSeries([
      { values: signals.viewers, weight: 0.1 },
      { values: [10, 12, 13, 14, 18], weight: 0.48 },
      { values: signals.emotes, weight: 0.42 },
    ], 1)
    const withoutEmoteSpike = buildCompositeOverviewSeries([
      { values: signals.viewers, weight: 0.1 },
      { values: signals.chat, weight: 0.48 },
      { values: [2, 8, 3, 4, 4], weight: 0.42 },
    ], 1)

    expect(composite[2]).toBeGreaterThan(withoutChatSpike[2] ?? 0)
    expect(composite[3]).toBeGreaterThan(withoutEmoteSpike[3] ?? 0)
    expect(composite[4]).not.toBe(composite[0])
  })

  it('stays bounded and preserves missing minutes', () => {
    const composite = buildCompositeOverviewSeries([
      { values: [null, 10, 20, 1000], weight: 1 },
      { values: [null, 4, 8, 12], weight: 1 },
    ], 1)

    expect(composite[0]).toBeNull()
    expect(composite.slice(1).every(value => value != null && value >= 0 && value <= 1)).toBe(true)
  })

  it('returns an empty series when no signal has samples', () => {
    expect(buildCompositeOverviewSeries([
      { values: [null, null], weight: 1 },
    ])).toEqual([])
  })
})
