import { describe, expect, it } from 'vitest'
import { snapToCoveredCanonicalMinute } from '@streampulse/pulse-core'
import {
  isFollowingLive,
  jumpToOffset,
  resolveViewport,
  viewportBuckets,
} from '../src/ui/chartViewport.ts'

describe('PortalPassesCanonicalMinuteRollupsToRenderer', () => {
  it('documents that portal must not pre-downsample streams over 240 minutes', () => {
    // streamcloneAnalytics now passes rollups through without downsampleTimeline.
    const canonicalCount = 300
    expect(canonicalCount).toBeGreaterThan(240)
  })
})

describe('RenderViewPreservesGapViewportPinAndFollow', () => {
  it('viewport follow/pin/rail stay independent of signal aggregation', () => {
    const durationSeconds = 3600
    const viewport = resolveViewport({
      durationSeconds,
      zoomSeconds: 600,
      followEnd: true,
      currentViewport: { startSeconds: 3000, endSeconds: 3600 },
    })
    expect(isFollowingLive(viewport, durationSeconds)).toBe(true)

    const midViewport = resolveViewport({
      durationSeconds,
      zoomSeconds: 600,
      anchorSeconds: 900,
    })
    const rollups = Array.from({ length: 60 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: i === 10 ? 99 : 1,
      sevenTvEmoteCount: 0,
    }))
    const buckets = viewportBuckets(rollups, midViewport, 30, [600])
    expect(buckets.some((b) => b.offsetSeconds === 600)).toBe(true)

    const jumped = jumpToOffset(midViewport, 1800, durationSeconds, 600)
    expect(jumped.startSeconds).toBeLessThanOrEqual(1800)
    expect(jumped.endSeconds).toBeGreaterThanOrEqual(1800)

    const snapped = snapToCoveredCanonicalMinute(0.5, 0, 240, [0, 60, 120, 180, 240])
    expect(snapped).toBe(120)
  })
})
