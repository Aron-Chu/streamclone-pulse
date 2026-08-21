import { describe, expect, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import {
  FOLLOW_LIVE_EPSILON_SECONDS,
  isFollowingLive,
  isViewportAtTimelineEnd,
  jumpToOffset,
  MIN_VIEWPORT_SECONDS,
  panViewport,
  railGeometry,
  railThumbRange,
  resolveViewport,
  targetBucketCount,
  viewportBuckets,
  viewportCenterSeconds,
  viewportDurationSeconds,
  wheelZoom,
  WHEEL_ZOOM_MAX_RATIO,
  WHEEL_ZOOM_MIN_RATIO,
  zoomViewport,
} from '../src/ui/chartViewport.ts'
import { widthDerivedBucketCount } from '../src/ui/chartRollupUtils.ts'

function rollup(offsetSeconds: number, chatCount = 0): ExtensionRollup {
  return { offsetSeconds, chatCount }
}

function buildMinuteRollups(startSeconds: number, count: number): ExtensionRollup[] {
  const out: ExtensionRollup[] = []
  for (let i = 0; i < count; i += 1) out.push(rollup(startSeconds + i * 60))
  return out
}

describe('viewportDurationSeconds / viewportCenterSeconds', () => {
  it('returns max(0) on inverted ranges', () => {
    expect(viewportDurationSeconds({ startSeconds: 30, endSeconds: 10 })).toBe(0)
  })

  it('averages start and end', () => {
    expect(viewportCenterSeconds({ startSeconds: 10, endSeconds: 30 })).toBe(20)
  })
})

describe('isFollowingLive', () => {
  it('returns true when viewport end is within epsilon of duration', () => {
    expect(isFollowingLive({ startSeconds: 80, endSeconds: 100 }, 100)).toBe(true)
    expect(isFollowingLive({ startSeconds: 75, endSeconds: 96 }, 100)).toBe(true)
  })

  it('returns false when viewport end lags behind duration', () => {
    expect(isFollowingLive({ startSeconds: 80, endSeconds: 94 }, 100)).toBe(false)
  })

  it('honors custom epsilon', () => {
    expect(isFollowingLive({ startSeconds: 70, endSeconds: 92 }, 100, 5)).toBe(false)
    expect(isFollowingLive({ startSeconds: 70, endSeconds: 95 }, 100, 5)).toBe(true)
  })

  it('returns false when duration is zero', () => {
    expect(isFollowingLive({ startSeconds: 0, endSeconds: 0 }, 0)).toBe(false)
  })

  it('exposes the default epsilon', () => {
    expect(FOLLOW_LIVE_EPSILON_SECONDS).toBe(5)
  })
})

describe('isViewportAtTimelineEnd', () => {
  it('matches isFollowingLive while zoomed in', () => {
    expect(isViewportAtTimelineEnd({ startSeconds: 80, endSeconds: 100 }, 100)).toBe(true)
    expect(isViewportAtTimelineEnd({ startSeconds: 10, endSeconds: 40 }, 100)).toBe(false)
  })

  it('is true when fully zoomed out, so there is nowhere further to scroll', () => {
    expect(isViewportAtTimelineEnd({ startSeconds: 0, endSeconds: 3660 }, 3660)).toBe(true)
  })

  it('is true when the viewport outruns a domain that shrank underneath it', () => {
    // Recap trims a zombie-live empty tail after the viewport was already set.
    expect(isViewportAtTimelineEnd({ startSeconds: 0, endSeconds: 3660 }, 3600)).toBe(true)
  })

  it('still reports not-at-end when zoomed in near the start of a long stream', () => {
    expect(isViewportAtTimelineEnd({ startSeconds: 0, endSeconds: 600 }, 3660)).toBe(false)
  })

  it('returns true when duration is zero', () => {
    expect(isViewportAtTimelineEnd({ startSeconds: 0, endSeconds: 0 }, 0)).toBe(true)
  })
})

describe('resolveViewport', () => {
  it('returns the full stream for zoomSeconds = "full"', () => {
    expect(resolveViewport({ durationSeconds: 100, zoomSeconds: 'full' })).toEqual({
      startSeconds: 0,
      endSeconds: 100,
    })
  })

  it('centers the zoom window around the anchor', () => {
    expect(resolveViewport({ durationSeconds: 1_000, zoomSeconds: 300, anchorSeconds: 500 }))
      .toEqual({ startSeconds: 350, endSeconds: 650 })
  })

  it('clamps the start at 0 when anchor is near the beginning', () => {
    expect(resolveViewport({ durationSeconds: 1_000, zoomSeconds: 300, anchorSeconds: 50 }))
      .toEqual({ startSeconds: 0, endSeconds: 300 })
  })

  it('clamps the end at durationSeconds when anchor is near the end', () => {
    expect(resolveViewport({ durationSeconds: 1_000, zoomSeconds: 300, anchorSeconds: 950 }))
      .toEqual({ startSeconds: 700, endSeconds: 1_000 })
  })

  it('uses the viewport center when no anchor is provided', () => {
    expect(resolveViewport({
      durationSeconds: 1_000,
      zoomSeconds: 300,
      currentViewport: { startSeconds: 300, endSeconds: 700 },
    })).toEqual({ startSeconds: 350, endSeconds: 650 })
  })

  it('biases toward durationSeconds when followEnd is true', () => {
    expect(resolveViewport({
      durationSeconds: 1_000,
      zoomSeconds: 300,
      currentViewport: { startSeconds: 300, endSeconds: 700 },
      followEnd: true,
    })).toEqual({ startSeconds: 550, endSeconds: 850 })
  })

  it('clamps zoom to the full stream when zoom exceeds duration', () => {
    expect(resolveViewport({ durationSeconds: 50, zoomSeconds: 120, anchorSeconds: 25 }))
      .toEqual({ startSeconds: 0, endSeconds: 50 })
  })
})

describe('panViewport', () => {
  it('translates start and end by the delta', () => {
    expect(panViewport({ startSeconds: 10, endSeconds: 40 }, 20, 100)).toEqual({
      startSeconds: 30,
      endSeconds: 60,
    })
  })

  it('clamps the end at durationSeconds', () => {
    expect(panViewport({ startSeconds: 80, endSeconds: 95 }, 50, 100)).toEqual({
      startSeconds: 85,
      endSeconds: 100,
    })
  })

  it('clamps at the right edge', () => {
    expect(panViewport({ startSeconds: 90, endSeconds: 100 }, 50, 100)).toEqual({
      startSeconds: 90,
      endSeconds: 100,
    })
  })

  it('returns the full stream when panning a full viewport', () => {
    expect(panViewport({ startSeconds: 0, endSeconds: 100 }, 5, 100))
      .toEqual({ startSeconds: 0, endSeconds: 100 })
  })

  it('respects clampToFull = false', () => {
    expect(panViewport({ startSeconds: 10, endSeconds: 30 }, 5, 100, false))
      .toEqual({ startSeconds: 15, endSeconds: 35 })
  })
})

describe('zoomViewport', () => {
  it('keeps the anchor at the same fractional position after zoom', () => {
    const next = zoomViewport({
      viewport: { startSeconds: 200, endSeconds: 600 },
      zoomSeconds: 300,
      anchorSeconds: 500,
      durationSeconds: 1_000,
    })
    expect(next).toEqual({ startSeconds: 275, endSeconds: 575 })
  })

  it('clamps start at 0 when zoom shrinks below anchor near the leading edge', () => {
    expect(zoomViewport({
      viewport: { startSeconds: 50, endSeconds: 150 },
      zoomSeconds: 300,
      anchorSeconds: 80,
      durationSeconds: 1_000,
    })).toEqual({ startSeconds: 0, endSeconds: 300 })
  })

  it('clamps end at duration when zoom grows past the end', () => {
    expect(zoomViewport({
      viewport: { startSeconds: 800, endSeconds: 1_000 },
      zoomSeconds: 600,
      anchorSeconds: 900,
      durationSeconds: 1_000,
    })).toEqual({ startSeconds: 400, endSeconds: 1_000 })
  })

  it('returns the full stream when zoom meets duration', () => {
    expect(zoomViewport({
      viewport: { startSeconds: 100, endSeconds: 300 },
      zoomSeconds: 1_000,
      anchorSeconds: 500,
      durationSeconds: 1_000,
    })).toEqual({ startSeconds: 0, endSeconds: 1_000 })
  })

  it('preserves the pointer fraction at a non-central anchor', () => {
    // 0.25 into the viewport (clientX 250 of 1000) stays at 0.25 after zoom-in.
    const viewport = { startSeconds: 600, endSeconds: 1_800 }
    const anchor = 600 + 0.25 * 1_200 // 900
    const next = zoomViewport({ viewport, zoomSeconds: 600, anchorSeconds: anchor, durationSeconds: 3_600 })
    const nextDuration = next.endSeconds - next.startSeconds
    const fraction = (anchor - next.startSeconds) / nextDuration
    expect(fraction).toBeCloseTo(0.25, 2)
  })
})

describe('viewportBuckets', () => {
  it('returns [] for empty inputs', () => {
    expect(viewportBuckets([], { startSeconds: 0, endSeconds: 60 }, 24)).toEqual([])
  })

  it('returns [] when targetBuckets is zero', () => {
    expect(viewportBuckets(buildMinuteRollups(0, 5), { startSeconds: 0, endSeconds: 300 }, 0))
      .toEqual([])
  })

  it('filters minute rollups by viewport range', () => {
    const rollups = buildMinuteRollups(0, 10)
    const filtered = viewportBuckets(rollups, { startSeconds: 60, endSeconds: 240 }, 24)
    expect(filtered.map(r => r.offsetSeconds)).toEqual([60, 120, 180])
  })

  it('includes the trailing bucket at the end of the stream', () => {
    const rollups = buildMinuteRollups(0, 6)
    const filtered = viewportBuckets(rollups, { startSeconds: 0, endSeconds: 360 }, 24)
    expect(filtered.length).toBe(6)
  })

  it('downsamples when filtered range exceeds targetBuckets', () => {
    const rollups = buildMinuteRollups(0, 200)
    const filtered = viewportBuckets(rollups, { startSeconds: 0, endSeconds: 12_000 }, 10)
    expect(filtered.length).toBeLessThanOrEqual(10)
    expect(filtered.length).toBeGreaterThan(0)
  })

  it('keeps a selected raw offset visible while preserving the LOD bucket count', () => {
    const rollups = buildMinuteRollups(0, 200)
    const selected = viewportBuckets(
      rollups,
      { startSeconds: 0, endSeconds: 12_000 },
      10,
      [7_140],
    )
    expect(selected).toHaveLength(10)
    expect(selected.some(point => point.offsetSeconds === 7_140)).toBe(true)
    expect(selected.map(point => point.offsetSeconds)).toEqual(
      [...selected].sort((a, b) => a.offsetSeconds - b.offsetSeconds).map(point => point.offsetSeconds),
    )
  })

  it('returns empty array when viewport has no matching rollups', () => {
    const rollups = buildMinuteRollups(0, 3)
    expect(viewportBuckets(rollups, { startSeconds: 1_000, endSeconds: 2_000 }, 24)).toEqual([])
  })
})

describe('targetBucketCount', () => {
  it('caps at the viewport minute count', () => {
    expect(targetBucketCount(800, 5)).toBe(5)
  })

  it('uses the width-derived bucket floor when the viewport is large', () => {
    expect(targetBucketCount(364, 1_000)).toBe(widthDerivedBucketCount(364, 1_000))
  })

  it('returns 0 for an empty viewport', () => {
    expect(targetBucketCount(400, 0)).toBe(0)
    expect(targetBucketCount(0, 60)).toBe(0)
  })

  it('honors a custom maxBuckets', () => {
    expect(targetBucketCount(800, 1_000, 50)).toBe(50)
  })
})

describe('railGeometry', () => {
  it('maps viewport proportions onto the rail', () => {
    expect(railGeometry({ startSeconds: 20, endSeconds: 40 }, 100, 200)).toEqual({
      thumbX: 40,
      thumbWidth: 40,
      totalWidth: 200,
    })
  })

  it('fills the rail when viewport equals the full stream', () => {
    expect(railGeometry({ startSeconds: 0, endSeconds: 100 }, 100, 200)).toEqual({
      thumbX: 0,
      thumbWidth: 200,
      totalWidth: 200,
    })
  })

  it('clamps thumb position so it does not overflow the rail', () => {
    const geo = railGeometry({ startSeconds: 98, endSeconds: 100 }, 100, 200)
    expect(geo.thumbX + geo.thumbWidth).toBeLessThanOrEqual(200)
    expect(geo.thumbWidth).toBeGreaterThanOrEqual(8)
  })

  it('returns safe defaults when duration is zero', () => {
    expect(railGeometry({ startSeconds: 0, endSeconds: 0 }, 0, 200)).toEqual({
      thumbX: 0,
      thumbWidth: 200,
      totalWidth: 200,
    })
  })
})

describe('railThumbRange', () => {
  it('returns the normalized 0..1 range', () => {
    expect(railThumbRange({ startSeconds: 25, endSeconds: 50 }, 100)).toEqual({
      startPct: 0.25,
      endPct: 0.5,
    })
  })

  it('swaps inverted ranges for safety', () => {
    expect(railThumbRange({ startSeconds: 50, endSeconds: 25 }, 100)).toEqual({
      startPct: 0.25,
      endPct: 0.5,
    })
  })

  it('returns the full range for a full-stream viewport', () => {
    expect(railThumbRange({ startSeconds: 0, endSeconds: 100 }, 100)).toEqual({
      startPct: 0,
      endPct: 1,
    })
  })
})

describe('jumpToOffset', () => {
  it('centers the new viewport on the requested offset', () => {
    expect(jumpToOffset({ startSeconds: 0, endSeconds: 1_000 }, 300, 1_000, 300))
      .toEqual({ startSeconds: 150, endSeconds: 450 })
  })

  it('clamps to the stream boundaries', () => {
    expect(jumpToOffset({ startSeconds: 0, endSeconds: 1_000 }, 0, 1_000, 300))
      .toEqual({ startSeconds: 0, endSeconds: 300 })
    expect(jumpToOffset({ startSeconds: 0, endSeconds: 1_000 }, 1_000, 1_000, 300))
      .toEqual({ startSeconds: 700, endSeconds: 1_000 })
  })

  it('returns the full stream when zoom is "full"', () => {
    expect(jumpToOffset({ startSeconds: 400, endSeconds: 600 }, 500, 1_000, 'full'))
      .toEqual({ startSeconds: 0, endSeconds: 1_000 })
  })

  it('clamps the offset inside the stream range', () => {
    expect(jumpToOffset({ startSeconds: 0, endSeconds: 1_000 }, 5_000, 1_000, 300))
      .toEqual({ startSeconds: 700, endSeconds: 1_000 })
  })
})

describe('MIN_VIEWPORT_SECONDS floor', () => {
  it('resolveViewport clamps small zoom to the 5-minute floor', () => {
    const vp = resolveViewport({ durationSeconds: 3_600, zoomSeconds: 60 })
    expect(vp.endSeconds - vp.startSeconds).toBe(MIN_VIEWPORT_SECONDS)
  })

  it('resolveViewport keeps zoomSeconds at the floor unchanged', () => {
    const vp = resolveViewport({ durationSeconds: 3_600, zoomSeconds: 300 })
    expect(vp.endSeconds - vp.startSeconds).toBe(300)
  })

  it('resolveViewport returns the full duration when duration is below the floor', () => {
    expect(resolveViewport({ durationSeconds: 200, zoomSeconds: 60 }))
      .toEqual({ startSeconds: 0, endSeconds: 200 })
  })

  it('zoomViewport clamps small zoom to the 5-minute floor', () => {
    const vp = zoomViewport({
      viewport: { startSeconds: 0, endSeconds: 3_600 },
      zoomSeconds: 60,
      durationSeconds: 3_600,
    })
    expect(vp.endSeconds - vp.startSeconds).toBe(MIN_VIEWPORT_SECONDS)
  })

  it('zoomViewport with zoomSeconds 0 returns the full stream', () => {
    expect(zoomViewport({
      viewport: { startSeconds: 0, endSeconds: 3_600 },
      zoomSeconds: 0,
      durationSeconds: 3_600,
    })).toEqual({ startSeconds: 0, endSeconds: 3_600 })
  })

  it('jumpToOffset clamps small zoom to the 5-minute floor', () => {
    const vp = jumpToOffset(
      { startSeconds: 0, endSeconds: 3_600 },
      1_800,
      3_600,
      60,
    )
    expect(vp.endSeconds - vp.startSeconds).toBe(300)
  })
})

describe('wheelZoom', () => {
  it('shrinks the viewport on wheel-up and keeps the anchor fraction', () => {
    const viewport = { startSeconds: 0, endSeconds: 3_600 }
    const next = wheelZoom({
      viewport,
      deltaY: -100,
      anchorSeconds: 1_800,
      durationSeconds: 3_600,
    })
    const nextDuration = next.endSeconds - next.startSeconds
    expect(nextDuration).toBeLessThan(3_600)
    // Anchor was centred; it must stay centred.
    expect((next.startSeconds + next.endSeconds) / 2).toBeCloseTo(1_800, 5)
  })

  it('grows the viewport on wheel-down', () => {
    const next = wheelZoom({
      viewport: { startSeconds: 900, endSeconds: 1_800 },
      deltaY: 100,
      anchorSeconds: 1_350,
      durationSeconds: 3_600,
    })
    expect(next.endSeconds - next.startSeconds).toBeGreaterThan(900)
  })

  it('never collapses to the floor in a single trackpad event', () => {
    const next = wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 10_800 },
      deltaY: -4,
      anchorSeconds: 5_400,
      durationSeconds: 10_800,
    })
    const nextDuration = next.endSeconds - next.startSeconds
    expect(nextDuration).toBeLessThan(10_800)
    expect(nextDuration).toBeGreaterThan(10_800 / WHEEL_ZOOM_MAX_RATIO)
  })

  it('clamps a single oversized delta to the max per-event ratio', () => {
    const next = wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 10_800 },
      deltaY: -5_000,
      anchorSeconds: 5_400,
      durationSeconds: 10_800,
    })
    expect(next.endSeconds - next.startSeconds).toBeCloseTo(10_800 * WHEEL_ZOOM_MIN_RATIO, 5)
  })

  it('normalizes line-mode deltas', () => {
    const pixels = wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 10_800 },
      deltaY: -48,
      durationSeconds: 10_800,
    })
    const lines = wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 10_800 },
      deltaY: -3,
      deltaMode: 1,
      durationSeconds: 10_800,
    })
    expect(lines.endSeconds - lines.startSeconds).toBeCloseTo(pixels.endSeconds - pixels.startSeconds, 5)
  })

  it('returns the viewport unchanged when wheel-up at the 5-minute floor', () => {
    const viewport = { startSeconds: 1_500, endSeconds: 1_800 }
    const next = wheelZoom({
      viewport,
      deltaY: -100,
      anchorSeconds: 1_650,
      durationSeconds: 3_600,
    })
    expect(next).toBe(viewport)
  })

  it('returns the viewport unchanged when wheel-down at the full duration', () => {
    const viewport = { startSeconds: 0, endSeconds: 3_600 }
    const next = wheelZoom({
      viewport,
      deltaY: 100,
      anchorSeconds: 1_800,
      durationSeconds: 3_600,
    })
    expect(next).toBe(viewport)
  })

  it('returns the viewport unchanged for a zero delta', () => {
    const viewport = { startSeconds: 0, endSeconds: 1_800 }
    expect(wheelZoom({ viewport, deltaY: 0, durationSeconds: 3_600 })).toBe(viewport)
  })

  it('returns a zero viewport when durationSeconds is zero', () => {
    expect(wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 0 },
      deltaY: -100,
      anchorSeconds: 0,
      durationSeconds: 0,
    })).toEqual({ startSeconds: 0, endSeconds: 0 })
  })
})

describe('ChartMotion.dragUsesDirectGeometry', () => {
  it('maps pointer pan and wheel zoom to the next viewport without interpolation', () => {
    const viewport = { startSeconds: 900, endSeconds: 1800 }
    const panned = panViewport(viewport, 60, 3600)
    expect(panned).toEqual({ startSeconds: 960, endSeconds: 1860 })
    const zoomArgs = {
      viewport,
      deltaY: -100,
      anchorSeconds: 1350,
      durationSeconds: 3600,
    }
    const zoomed = wheelZoom(zoomArgs)
    const nextDuration = zoomed.endSeconds - zoomed.startSeconds
    expect(nextDuration).toBeLessThan(900)
    expect(zoomed.startSeconds).toBeGreaterThan(viewport.startSeconds)
    expect(zoomed.endSeconds).toBeLessThan(viewport.endSeconds)
    expect(wheelZoom(zoomArgs)).toEqual(zoomed)
  })
})
