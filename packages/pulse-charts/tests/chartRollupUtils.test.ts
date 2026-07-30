import { describe, expect, it } from 'vitest'
import { chartBarBucketOpacity } from '../src/chartRollupUtils.ts'

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
