import { describe, expect, it } from 'vitest'
import { gameSegmentPlotBounds } from '@streampulse/pulse-charts'
import {
  areaPathInBand,
  chartBarBucketOpacity,
  easeInOutCubic,
  extendViewerSeriesToLeadingEdge,
  extendViewerSeriesToTrailingEdge,
  extendSeriesToTrailingEdge,
  firstViewerOffsetSeconds,
  linePathInBand,
  overviewBarWidth,
  OVERVIEW_CHART_MAX_BAR_WIDTH_PX,
  plotY,
  rampNullableSeriesFromStreamStart,
  barDisplayAxisMax,
  viewerDisplayAxisMax,
  rollupsToChartMinuteRollups,
  softFitSeriesToAxis,
  softFitValueToAxis,
  smoothLinePathInBand,
  smoothNullableSeriesValues,
  smoothSeriesValues,
  trendSmoothingWindow,
  valueYInBand,
} from '../src/ui/chartRollupUtils.ts'

describe('overviewBarWidth', () => {
  it('caps early-stream bars so two points are not half-width slabs', () => {
    expect(overviewBarWidth(300, 2)).toBe(OVERVIEW_CHART_MAX_BAR_WIDTH_PX)
  })

  it('keeps natural width when the chart is densely populated', () => {
    expect(overviewBarWidth(300, 60)).toBeLessThan(OVERVIEW_CHART_MAX_BAR_WIDTH_PX)
    expect(overviewBarWidth(300, 60)).toBeCloseTo(300 / 60 - 0.5, 5)
  })
})

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

describe('viewerDisplayAxisMax', () => {
  it('keeps ~3% top pad on a flat plateau so the line sits near the strip top', () => {
    const values = Array.from({ length: 40 }, () => 58_000)
    const axis = viewerDisplayAxisMax(values)
    expect(axis).toBeGreaterThanOrEqual(58_000)
    expect((axis - 58_000) / 58_000).toBeLessThanOrEqual(0.05)
    expect(58_000 / axis).toBeGreaterThan(0.94)
  })

  it('ignores a brief spike above a long plateau', () => {
    const values = [
      ...Array.from({ length: 40 }, () => 58_000),
      120_000,
    ]
    const axis = viewerDisplayAxisMax(values)
    expect(axis).toBeLessThan(80_000)
    expect(58_000 / axis).toBeGreaterThan(0.9)
  })

  it('axis from raw viewers stays tight even when smoothed neighbors carry spike bleed', () => {
    // Mimic smoothNullableSeriesValues near a terminal spike: last raw=120k,
    // but a 3-point average would be ~79.6k and wrongly raise the ceiling.
    const raw = [
      ...Array.from({ length: 40 }, () => 58_000),
      120_000,
    ]
    const smoothedBleed = [
      ...Array.from({ length: 38 }, () => 58_000),
      78_000,
      79_600,
      79_600,
    ]
    const axisFromRaw = viewerDisplayAxisMax(raw)
    const axisFromSmoothed = viewerDisplayAxisMax(smoothedBleed)
    expect(58_000 / axisFromRaw).toBeGreaterThan(0.9)
    // Document why we must not axis-scale from smoothed values:
    expect(58_000 / axisFromSmoothed).toBeLessThan(0.85)
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
  it('uses absolute rest alpha when nothing is focused', () => {
    expect(chartBarBucketOpacity({ index: 2, activeIndex: null })).toBe(0.30)
  })

  it('highlights the active bucket on hover', () => {
    expect(chartBarBucketOpacity({ index: 2, activeIndex: 2 })).toBe(0.85)
  })

  it('dims non-active neighbors on hover without a pin', () => {
    expect(chartBarBucketOpacity({ index: 1, activeIndex: 2 })).toBe(0.16)
  })

  it('splits past/future only when pinIndex is set', () => {
    expect(chartBarBucketOpacity({
      index: 1,
      activeIndex: 3,
      pinIndex: 3,
    })).toBe(0.30)
    expect(chartBarBucketOpacity({
      index: 5,
      activeIndex: 3,
      pinIndex: 3,
    })).toBe(0.10)
    expect(chartBarBucketOpacity({
      index: 3,
      activeIndex: 3,
      pinIndex: 3,
    })).toBe(0.85)
    // Without pinIndex, hover dims all non-active equally — no past/future split.
    expect(chartBarBucketOpacity({
      index: 5,
      activeIndex: 3,
    })).toBe(0.16)
  })

  it('returns the same alpha for chat and emote lanes in every state', () => {
    const states = [
      { index: 0, activeIndex: null as number | null, pinIndex: null as number | null },
      { index: 2, activeIndex: 2, pinIndex: null },
      { index: 1, activeIndex: 2, pinIndex: null },
      { index: 1, activeIndex: 3, pinIndex: 3 },
      { index: 5, activeIndex: 3, pinIndex: 3 },
      { index: 3, activeIndex: 3, pinIndex: 3 },
    ]
    for (const state of states) {
      // Lane identity is hue at the call site; opacity must not differ by lane.
      expect(chartBarBucketOpacity(state)).toBe(chartBarBucketOpacity(state))
    }
    expect(chartBarBucketOpacity({ index: 0, activeIndex: null })).toBe(0.30)
    expect(chartBarBucketOpacity({ index: 2, activeIndex: 2 })).toBe(0.85)
    expect(chartBarBucketOpacity({ index: 1, activeIndex: 2 })).toBe(0.16)
    expect(chartBarBucketOpacity({ index: 1, activeIndex: 3, pinIndex: 3 })).toBe(0.30)
    expect(chartBarBucketOpacity({ index: 5, activeIndex: 3, pinIndex: 3 })).toBe(0.10)
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

describe('extendViewerSeriesToTrailingEdge', () => {
  it('carries the last viewer sample forward to Now across trailing empty minutes', () => {
    const values = [40_000, 41_000, null, null, 0] as Array<number | null>
    expect(extendViewerSeriesToTrailingEdge(values)).toEqual([
      40_000,
      41_000,
      41_000,
      41_000,
      41_000,
    ])
  })

  it('leaves a complete series unchanged', () => {
    const values = [10_000, 11_000, 12_000] as Array<number | null>
    expect(extendViewerSeriesToTrailingEdge(values)).toEqual(values)
  })
})

describe('extendSeriesToTrailingEdge', () => {
  it('carries chat/emote trend gaps the same way as viewers', () => {
    expect(extendSeriesToTrailingEdge([80, 90, null, 0])).toEqual([80, 90, 90, 90])
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

  it('eases from 0 when the first positive sample is already at index 0', () => {
    const values = [1000, 1100, 1200, 1050, 980, 970, 960, 950, 940] as Array<number | null>
    const ramped = rampNullableSeriesFromStreamStart(values)
    expect(ramped[0]).toBe(0)
    expect(ramped[1]).toBeGreaterThan(0)
    expect(ramped[1]).toBeLessThan(1100)
    expect(ramped[8]).toBe(940)
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

  it('keeps outlier peaks inside the band when axis max is below true max', () => {
    const bandTop = 100
    const bandBottom = 160
    // Axis max 400 but a spike of 2000 — must not climb into the lane above.
    const path = smoothLinePathInBand(
      [100, 2000, 120, 90],
      400,
      320,
      200,
      4,
      12,
      bandTop,
      bandBottom,
      0,
    )
    expect(path.length).toBeGreaterThan(0)
    const nums = [...path.matchAll(/-?[\d.]+/g)].map(m => Number(m[0]))
    const ys: number[] = []
    for (let i = 1; i < nums.length; i += 2) ys.push(nums[i]!)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(bandTop - 0.05)
      expect(y).toBeLessThanOrEqual(bandBottom + 0.05)
    }
  })
})

describe('valueYInBand', () => {
  it('clamps values above axis max to bandTop', () => {
    const y = valueYInBand(2000, 400, 200, 100, 160, 0)
    expect(y).toBe(100)
  })
})

describe('softFitValueToAxis', () => {
  it('leaves values at or below the axis unchanged', () => {
    expect(softFitValueToAxis(200, 400)).toBe(200)
    expect(softFitValueToAxis(400, 400)).toBe(400)
  })

  it('compresses outliers toward the top without hard-equal plateaus', () => {
    const a = softFitValueToAxis(800, 400)
    const b = softFitValueToAxis(2000, 400)
    expect(a).toBeGreaterThan(400 * 0.86)
    expect(a).toBeLessThanOrEqual(400)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThanOrEqual(400)
  })

  it('soft-fit series stays within plotMax so trend paths do not flat-top', () => {
    const fitted = softFitSeriesToAxis([100, 800, 2000, 120], 400)
    expect(fitted.plotMax).toBe(400)
    expect(fitted.values[1]).toBeLessThan(400)
    expect(fitted.values[2]).toBeLessThan(400)
    expect(fitted.values[1]).not.toBe(fitted.values[2])
    const path = smoothLinePathInBand(
      fitted.values,
      fitted.plotMax,
      320,
      200,
      4,
      12,
      100,
      160,
      0,
    )
    const nums = [...path.matchAll(/-?[\d.]+/g)].map(m => Number(m[0]))
    const ys: number[] = []
    for (let i = 1; i < nums.length; i += 2) ys.push(nums[i]!)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(100 - 0.05)
      expect(y).toBeLessThanOrEqual(160 + 0.05)
    }
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
