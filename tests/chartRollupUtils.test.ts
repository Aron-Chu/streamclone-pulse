import { describe, expect, it } from 'vitest'
import { gameSegmentPlotBounds } from '@streampulse/pulse-charts'
import {
  areaPathInBand,
  chartBarBucketOpacity,
  easeInOutCubic,
  extendViewerSeriesToLeadingEdge,
  firstViewerOffsetSeconds,
  linePathInBand,
  plotY,
  rampNullableSeriesFromStreamStart,
  barDisplayAxisMax,
  rollupsToChartMinuteRollups,
  smoothLinePathInBand,
  smoothNullableSeriesValues,
  smoothSeriesValues,
  trendSmoothingWindow,
  valueYInBand,
} from '../src/ui/chartRollupUtils.ts'
import { CHART_THEME } from '../src/ui/chartTheme.ts'

describe('rollupsToChartMinuteRollups', () => {
  it('maps offset rollups to minute timestamps from stream start', () => {
    const rollups = [
      { offsetSeconds: 660, chatCount: 1, sevenTvEmoteCount: 0 },
      { offsetSeconds: 720, chatCount: 2, sevenTvEmoteCount: 0 },
    ]
    const out = rollupsToChartMinuteRollups(rollups, '2026-01-01T00:00:00.000Z')
    expect(out).toEqual([
      { minuteTs: '2026-01-01T00:11:00.000Z' },
      { minuteTs: '2026-01-01T00:12:00.000Z' },
    ])
  })

  it('plots five game segments against late-start rollups', () => {
    const streamStartedAt = '2026-01-01T00:00:00.000Z'
    const rollups = rollupsToChartMinuteRollups(
      [
        { offsetSeconds: 660, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 1200, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 1800, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 2400, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 3000, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 3660, chatCount: 1, sevenTvEmoteCount: 0 },
      ],
      streamStartedAt,
    )
    const segments = [
      { gameName: 'A', offsetSeconds: 660, durationSeconds: 540 },
      { gameName: 'B', offsetSeconds: 1200, durationSeconds: 600 },
      { gameName: 'C', offsetSeconds: 1800, durationSeconds: 600 },
      { gameName: 'D', offsetSeconds: 2400, durationSeconds: 600 },
      { gameName: 'E', offsetSeconds: 3000, durationSeconds: 600 },
    ]
    const bounds = segments.map(segment =>
      gameSegmentPlotBounds(segment, rollups, streamStartedAt, 4, 312),
    )
    expect(bounds.filter(Boolean)).toHaveLength(5)
  })
})

describe('barDisplayAxisMax', () => {
  it('uses a lower ceiling than absolute max so bars show variation', () => {
    const values = Array.from({ length: 100 }, (_, index) => (index === 70 ? 900 : 120 + (index % 7) * 8))
    expect(barDisplayAxisMax(values)).toBeLessThan(900)
    expect(barDisplayAxisMax(values)).toBeGreaterThan(200)
  })

  it('falls back to 1 for empty series', () => {
    expect(barDisplayAxisMax([null, null])).toBe(1)
  })
})

describe('chartBarBucketOpacity', () => {
  it('dims all bars at rest', () => {
    const opacity = chartBarBucketOpacity({
      index: 2,
      activeIndex: null,
      baseOpacity: CHART_THEME.emote.bar,
    })
    expect(opacity).toBeLessThan(CHART_THEME.emote.bar)
  })

  it('highlights the active bucket on hover or pin', () => {
    const opacity = chartBarBucketOpacity({
      index: 2,
      activeIndex: 2,
      baseOpacity: CHART_THEME.emote.bar,
      highlightOpacity: CHART_THEME.emote.barSpike,
    })
    expect(opacity).toBeGreaterThan(CHART_THEME.emote.bar)
  })

  it('keeps non-active buckets faint while one is focused', () => {
    const opacity = chartBarBucketOpacity({
      index: 1,
      activeIndex: 2,
      baseOpacity: CHART_THEME.emote.bar,
    })
    expect(opacity).toBeLessThan(CHART_THEME.emote.bar * 0.5)
  })

  it('keeps scrubbed history readable while fading future buckets', () => {
    const past = chartBarBucketOpacity({
      index: 1,
      activeIndex: 2,
      baseOpacity: CHART_THEME.emote.bar,
      fadeFutureAfterActive: true,
    })
    const future = chartBarBucketOpacity({
      index: 3,
      activeIndex: 2,
      baseOpacity: CHART_THEME.emote.bar,
      fadeFutureAfterActive: true,
    })

    expect(past).toBeGreaterThan(CHART_THEME.emote.bar * 0.5)
    expect(future).toBeLessThan(CHART_THEME.emote.bar * 0.2)
    expect(past).toBeGreaterThan(future)
  })
})

describe('trendSmoothingWindow', () => {
  it('uses lighter windows so trend lines stay closer to minute data', () => {
    expect(trendSmoothingWindow(20)).toBe(3)
    expect(trendSmoothingWindow(60)).toBe(5)
    expect(trendSmoothingWindow(200)).toBe(7)
  })
})

describe('smoothNullableSeriesValues', () => {
  it('dampens spikes with a centered average', () => {
    const smoothed = smoothNullableSeriesValues([0, 100, 0, 0, 0], 5)
    expect(smoothed[1]).toBeLessThan(100)
    expect(smoothed[1]).toBeGreaterThan(0)
  })

  it('preserves null gaps', () => {
    expect(smoothNullableSeriesValues([null, 10, 20, null], 3)).toEqual([null, 15, 15, null])
  })

  it('returns input unchanged when fewer than three points', () => {
    const values = [5, 10]
    expect(smoothNullableSeriesValues(values, 5)).toBe(values)
  })
})

describe('smoothSeriesValues', () => {
  it('averages neighbors with a window of 3', () => {
    expect(smoothSeriesValues([0, 10, 0], 3)).toEqual([5, 3.3333333333333335, 5])
  })

  it('returns the input unchanged when window is 1', () => {
    const values = [1, 4, 2]
    expect(smoothSeriesValues(values, 1)).toBe(values)
  })
})

describe('firstViewerOffsetSeconds', () => {
  it('returns the earliest rollup offset with viewerCount', () => {
    const rollups = [
      { offsetSeconds: 120, chatCount: 5, viewerCount: 0 },
      { offsetSeconds: 180, chatCount: 8, viewerCount: 420 },
      { offsetSeconds: 240, chatCount: 3, viewerCount: 390 },
    ]
    expect(firstViewerOffsetSeconds(rollups)).toBe(180)
  })

  it('prefers payload fallback when rollups have no viewers', () => {
    const rollups = [{ offsetSeconds: 60, chatCount: 1, viewerCount: 0 }]
    expect(firstViewerOffsetSeconds(rollups, 300)).toBe(300)
  })
})

describe('extendViewerSeriesToLeadingEdge', () => {
  it('carries the first viewer sample back across earlier chat minutes', () => {
    const rollups = [
      { offsetSeconds: 120, chatCount: 40, viewerCount: 0 },
      { offsetSeconds: 180, chatCount: 55, viewerCount: 0 },
      { offsetSeconds: 300, chatCount: 60, viewerCount: 41_000 },
    ]
    const values = [null, null, 41_000] as Array<number | null>
    expect(extendViewerSeriesToLeadingEdge(rollups, values)).toEqual([41_000, 41_000, 41_000])
  })
})

describe('rampNullableSeriesFromStreamStart', () => {
  it('ramps from 0 at stream start to the first positive sample', () => {
    const values = [null, null, 1000, 900] as Array<number | null>
    const ramped = rampNullableSeriesFromStreamStart(values)
    expect(ramped[0]).toBe(0)
    expect(ramped[1]).toBeGreaterThan(0)
    expect(ramped[1]).toBeLessThan(1000)
    expect(ramped[2]).toBe(1000)
    expect(ramped[3]).toBe(900)
  })

  it('ease-in-out reaches the anchor at the first positive index', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
  })
})

describe('smoothLinePathInBand', () => {
  it('returns cubic-bezier paths for multi-point series', () => {
    const path = smoothLinePathInBand([0, 500, 1200, 800], 1200, 320, 160, 4, 12, 80, 140, 0)
    expect(path).toMatch(/^M/)
    expect(path).toContain('C')
  })
})

describe('linePathInBand', () => {
  it('plots viewer-strip y coordinates inside bandTop and bandBottom', () => {
    const height = 160
    const bandTop = 30
    const bandBottom = 65
    const values = [1000, 5000, 8000, 3000]
    const path = linePathInBand(values, 8000, 320, height, 4, 12, bandTop, bandBottom, 0)
    expect(path.length).toBeGreaterThan(0)
    const yMatches = [...path.matchAll(/[\d.]+/g)].map(match => Number(match[0]))
    const yCoords = yMatches.filter((_, index) => index % 2 === 1)
    for (const y of yCoords) {
      expect(y).toBeGreaterThanOrEqual(bandTop - 0.5)
      expect(y).toBeLessThanOrEqual(bandBottom + 0.5)
    }
  })

  it('plots middle-band y coordinates inside bandTop and bandBottom', () => {
    const height = 200
    const bandTop = 110
    const bandBottom = 130
    const padBottomInset = height - bandBottom

    const yAtMin = plotY(0, 10, height, bandTop, padBottomInset, 0)
    const yAtMax = plotY(10, 10, height, bandTop, padBottomInset, 0)

    expect(yAtMax).toBeGreaterThanOrEqual(bandTop - 0.5)
    expect(yAtMax).toBeLessThanOrEqual(bandTop + 0.5)
    expect(yAtMin).toBeGreaterThanOrEqual(bandBottom - 0.5)
    expect(yAtMin).toBeLessThanOrEqual(bandBottom + 0.5)
  })

  it('returns a non-empty path for positive values in a middle band', () => {
    const path = linePathInBand([0, 5, 8, 3], 10, 320, 200, 4, 12, 110, 130, 0)
    expect(path.length).toBeGreaterThan(0)
    expect(path).toMatch(/^M/)
  })

  it('returns a non-empty path for smoothed trend values', () => {
    const raw = [12, 80, 15, 10, 90, 8, 14]
    const smoothed = smoothNullableSeriesValues(raw, trendSmoothingWindow(raw.length))
    const path = linePathInBand(smoothed, 100, 320, 200, 4, 12, 150, 170, 0)
    expect(path.length).toBeGreaterThan(0)
    expect(path).toMatch(/^M/)
  })
})

describe('areaPathInBand', () => {
  it('returns a closed area path within the viewer band', () => {
    const path = areaPathInBand([1000, 5000, 8000], 8000, 320, 160, 4, 12, 30, 65, 0)
    expect(path.length).toBeGreaterThan(0)
    expect(path).toMatch(/ Z$/)
  })
})

describe('valueYInBand', () => {
  it('returns null for empty values and plots inside the band otherwise', () => {
    expect(valueYInBand(null, 10, 200, 110, 130)).toBeNull()
    const y = valueYInBand(10, 10, 200, 110, 130)
    expect(y).not.toBeNull()
    expect(y!).toBeGreaterThanOrEqual(110 - 0.5)
    expect(y!).toBeLessThanOrEqual(130 + 0.5)
  })
})
