import { describe, expect, it } from 'vitest'
import {
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
  gameSegmentPlotBoundsByTimestampScale,
  plotXForOffsetSeconds,
} from '../src/gameSegmentChart.ts'
import { buildViewerTimestampScale } from '../src/viewerGeometry.ts'
import { hasMeaningfulGameSegments, gameSegmentKey, normalizeGameSegments } from '../src/gameSegments.ts'
import {
  activeGameCapTitle,
  activeGameCapX,
  shouldRenderActiveGameCap,
} from '../src/GameSegmentOverlay.tsx'
import type { ChartGameSegment } from '../src/types.ts'

describe('gameSegmentPlotBounds', () => {
  it('maps segment onto visible rollup window', () => {
    const rollups = [
      { minuteTs: '2026-01-01T01:00:00.000Z' },
      { minuteTs: '2026-01-01T01:30:00.000Z' },
      { minuteTs: '2026-01-01T02:00:00.000Z' },
    ]
    const segment: ChartGameSegment = {
      gameName: 'Rocket League',
      offsetSeconds: 15 * 60,
      durationSeconds: 45 * 60,
    }
    const bounds = gameSegmentPlotBounds(segment, rollups, '2026-01-01T01:00:00.000Z', 90, 820)
    expect(bounds).not.toBeNull()
    expect(bounds!.startX).toBeGreaterThan(90)
    expect(bounds!.endX).toBeLessThanOrEqual(910)
  })

  it('maps multiple segments onto partial rollup window (late coverage start)', () => {
    const streamStartedAt = '2026-01-01T00:00:00.000Z'
    const rollups = [
      { minuteTs: '2026-01-01T00:11:00.000Z' },
      { minuteTs: '2026-01-01T00:20:00.000Z' },
      { minuteTs: '2026-01-01T00:30:00.000Z' },
      { minuteTs: '2026-01-01T00:40:00.000Z' },
      { minuteTs: '2026-01-01T00:50:00.000Z' },
      { minuteTs: '2026-01-01T01:01:00.000Z' },
    ]
    const segments: ChartGameSegment[] = [
      { gameName: 'Game A', offsetSeconds: 660, durationSeconds: 540 },
      { gameName: 'Game B', offsetSeconds: 1200, durationSeconds: 600 },
      { gameName: 'Game C', offsetSeconds: 1800, durationSeconds: 600 },
      { gameName: 'Game D', offsetSeconds: 2400, durationSeconds: 600 },
      { gameName: 'Game E', offsetSeconds: 3000, durationSeconds: 600 },
    ]
    const bounds = segments.map(segment =>
      gameSegmentPlotBounds(segment, rollups, streamStartedAt, 90, 820),
    )
    expect(bounds.filter(Boolean)).toHaveLength(5)
    for (const bound of bounds) {
      expect(bound!.startX).toBeGreaterThanOrEqual(90)
      expect(bound!.endX).toBeLessThanOrEqual(910)
    }
  })

  it('returns null when segment ends before visible rollup window', () => {
    const rollups = [{ minuteTs: '2026-01-01T00:11:00.000Z' }]
    const segment: ChartGameSegment = {
      gameName: 'Early only',
      offsetSeconds: 0,
      durationSeconds: 300,
    }
    expect(
      gameSegmentPlotBounds(segment, rollups, '2026-01-01T00:00:00.000Z', 90, 820),
    ).toBeNull()
  })
})

describe('gameSegmentPlotBoundsByOffsets', () => {
  it('aligns mid-stream game change with index spacing on uneven offsets', () => {
    // Spike-preserving downsample: early buckets dense in activity offsets, later sparse.
    const offsets = [15_000, 15_200, 16_000, 28_000, 50_000, 80_000]
    const segment: ChartGameSegment = {
      gameName: 'Valorant',
      offsetSeconds: 28_000,
      durationSeconds: 10_000,
    }
    const padLeft = 4
    const plotWidth = 312
    const bounds = gameSegmentPlotBoundsByOffsets(segment, offsets, padLeft, plotWidth)
    expect(bounds).not.toBeNull()
    // Index of offset 28000 is 3 of 5 → 60% across plot
    const expectedX = padLeft + (3 / 5) * plotWidth
    expect(bounds!.startX).toBeCloseTo(expectedX, 5)
    // Time-linear mapping would put 28000 much earlier — assert we are NOT that.
    const timeLinearX =
      padLeft + ((28_000 - 15_000) / (80_000 - 15_000)) * plotWidth
    expect(Math.abs(bounds!.startX - timeLinearX)).toBeGreaterThan(20)
  })

  it('returns left-edge startX when segment began before the chart window', () => {
    const offsets = [15_000, 30_000, 80_000]
    const segment: ChartGameSegment = {
      gameName: 'League of Legends',
      offsetSeconds: 0,
      durationSeconds: 100_000,
    }
    const bounds = gameSegmentPlotBoundsByOffsets(segment, offsets, 4, 312)
    expect(bounds).not.toBeNull()
    expect(bounds!.startX).toBe(4)
  })
})

describe('plotXForOffsetSeconds', () => {
  it('interpolates between uneven chart offsets', () => {
    const offsets = [0, 100, 400]
    expect(plotXForOffsetSeconds(0, offsets, 0, 100)).toBe(0)
    expect(plotXForOffsetSeconds(100, offsets, 0, 100)).toBe(50)
    expect(plotXForOffsetSeconds(400, offsets, 0, 100)).toBe(100)
    expect(plotXForOffsetSeconds(250, offsets, 0, 100)).toBeCloseTo(75, 5)
  })
})

describe('shared timestamp game bounds', () => {
  it('uses the chart-wide timestamp domain instead of an index-only projection', () => {
    const scale = buildViewerTimestampScale([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
      '2026-01-01T00:05:00.000Z',
    ], { width: 1000, padLeft: 90, padRight: 34 })
    const bounds = gameSegmentPlotBoundsByTimestampScale(
      { offsetSeconds: 60, durationSeconds: 60 },
      scale,
      '2026-01-01T00:00:00.000Z',
    )

    expect(bounds).not.toBeNull()
    expect(bounds!.startX).toBeCloseTo(scale.xForTimestamp('2026-01-01T00:01:00.000Z'), 5)
    expect(bounds!.endX).toBeCloseTo(scale.xForTimestamp('2026-01-01T00:02:00.000Z'), 5)
  })
})

describe('normalizeGameSegments', () => {
  it('repairs zero-duration segments', () => {
    const games: ChartGameSegment[] = [
      { gameName: 'A', offsetSeconds: 0, durationSeconds: 0 },
      { gameName: 'B', offsetSeconds: 0, durationSeconds: 0 },
    ]
    const out = normalizeGameSegments(games, 3600)
    expect(out).toHaveLength(2)
    expect(out[0]!.durationSeconds).toBeGreaterThan(0)
  })

  it('clamps overlong segments to the stream duration', () => {
    const games: ChartGameSegment[] = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 184_062 },
    ]
    const out = normalizeGameSegments(games, 9_505)
    expect(out).toHaveLength(1)
    expect(out[0]!.durationSeconds).toBe(9_505)
  })

  it('drops segments that start after the stream ends', () => {
    const games: ChartGameSegment[] = [
      { gameName: 'Late', offsetSeconds: 10_000, durationSeconds: 600 },
    ]
    expect(normalizeGameSegments(games, 9_505)).toEqual([])
  })
})

describe('hasMeaningfulGameSegments', () => {
  it('shows single full-stream named segment', () => {
    const games: ChartGameSegment[] = [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }]
    expect(hasMeaningfulGameSegments(games, 3600)).toBe(true)
  })

  it('hides single unnamed segment', () => {
    const games: ChartGameSegment[] = [{ gameName: '  ', offsetSeconds: 0, durationSeconds: 3600 }]
    expect(hasMeaningfulGameSegments(games, 3600)).toBe(false)
  })

  it('shows multi-segment streams', () => {
    const games: ChartGameSegment[] = [
      { gameName: 'A', offsetSeconds: 0, durationSeconds: 1800 },
      { gameName: 'B', offsetSeconds: 1800, durationSeconds: 1800 },
    ]
    expect(hasMeaningfulGameSegments(games, 3600)).toBe(true)
  })
})

describe('highlighted game segment bounds', () => {
  it('resolves highlighted key to index-aligned plot bounds', () => {
    // Uneven offsets: wall-clock linear would disagree with index spacing.
    const chartOffsets = [0, 600, 1_800, 3_600, 7_200, 14_400]
    const segments: ChartGameSegment[] = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1_800 },
      { gameName: 'Deadlock', offsetSeconds: 1_800, durationSeconds: 5_400 },
    ]
    const highlightedKey = gameSegmentKey(segments[1]!)
    const segment = segments.find(game => gameSegmentKey(game) === highlightedKey)
    expect(segment?.gameName).toBe('Deadlock')
    const padLeft = 90
    const plotWidth = 820
    const bounds = gameSegmentPlotBoundsByOffsets(segment!, chartOffsets, padLeft, plotWidth)
    expect(bounds).not.toBeNull()
    // Offset 1800 is index 2 of 5 → 40% across plot
    const expectedStart = padLeft + (2 / 5) * plotWidth
    expect(bounds!.startX).toBeCloseTo(expectedStart, 5)
    expect(bounds!.endX).toBeGreaterThan(bounds!.startX)
    const timeLinearStart =
      padLeft + ((1_800 - 0) / (14_400 - 0)) * plotWidth
    expect(Math.abs(bounds!.startX - timeLinearStart)).toBeGreaterThan(20)
  })
})

describe('active live game cap', () => {
  it('renders only when isLive and segments exist', () => {
    expect(shouldRenderActiveGameCap(true, 1)).toBe(true)
    expect(shouldRenderActiveGameCap(true, 3)).toBe(true)
    expect(shouldRenderActiveGameCap(false, 1)).toBe(false)
    expect(shouldRenderActiveGameCap(undefined, 2)).toBe(false)
    expect(shouldRenderActiveGameCap(true, 0)).toBe(false)
  })

  it('places the live cap at the right plot edge (padLeft + plotWidth)', () => {
    const padLeft = 4
    const plotWidth = 312
    expect(activeGameCapX(padLeft, plotWidth)).toBe(padLeft + plotWidth)

    // Single game from offset 0: left start clamps to padLeft (divider skipped), but
    // live cap still sits at the right edge — not at segment endX.
    const offsets = [0, 30_000, 80_000]
    const segment: ChartGameSegment = {
      gameName: 'Just Chatting',
      offsetSeconds: 0,
      durationSeconds: 80_000,
    }
    const bounds = gameSegmentPlotBoundsByOffsets(segment, offsets, padLeft, plotWidth)
    expect(bounds).not.toBeNull()
    expect(bounds!.startX).toBe(padLeft)
    expect(activeGameCapX(padLeft, plotWidth)).toBeGreaterThan(bounds!.startX)
    expect(activeGameCapX(padLeft, plotWidth)).toBeGreaterThanOrEqual(bounds!.endX)
  })

  it('titles the live cap with the last game name', () => {
    expect(activeGameCapTitle('Valorant')).toBe('Valorant — live')
    expect(activeGameCapTitle('  Deadlock  ')).toBe('Deadlock — live')
    expect(activeGameCapTitle(undefined)).toBeUndefined()
    expect(activeGameCapTitle('   ')).toBeUndefined()
  })

  it('multi-game live: mid-stream start is off left axis; cap stays at right edge', () => {
    const padLeft = 90
    const plotWidth = 820
    const chartOffsets = [0, 600, 1_800, 3_600, 7_200, 14_400]
    const segments: ChartGameSegment[] = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1_800 },
      { gameName: 'Deadlock', offsetSeconds: 1_800, durationSeconds: 5_400 },
    ]
    expect(shouldRenderActiveGameCap(true, segments.length)).toBe(true)

    const first = gameSegmentPlotBoundsByOffsets(segments[0]!, chartOffsets, padLeft, plotWidth)
    const second = gameSegmentPlotBoundsByOffsets(segments[1]!, chartOffsets, padLeft, plotWidth)
    expect(first!.startX).toBe(padLeft) // left-glued → divider skipped by overlay
    expect(second!.startX).toBeGreaterThan(padLeft + 2) // mid-stream change divider
    expect(activeGameCapX(padLeft, plotWidth)).toBe(padLeft + plotWidth)
    expect(activeGameCapTitle(segments[segments.length - 1]!.gameName)).toBe('Deadlock — live')
  })
})
