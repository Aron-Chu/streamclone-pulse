import { describe, expect, it } from 'vitest'
import {
  aggregateSevenTvEmotes,
  activityAxisBounds,
  activityAxisBoundsFromZero,
  buildBaselineEmoteOverlays,
  buildBucketedEmoteSeries,
  buildSelectedEmoteSeries,
  chartMaxPoints,
  chartEmptyMessage,
  chartRollupSeries,
  chatSeriesFromRollups,
  emoteSelectionKey,
  isSevenTvProvider,
  mergeEmoteOverlaySeries,
  overlaySeriesAxisMax,
  prepareChartRollups,
  densifyRollupsForTimeline,
  resolveFullChartDensifyFromOffset,
  fullRollupsMissingStreamPrefix,
  FULL_CHART_DEAD_ZONE_CLIP_SEC,
  resolveFullChartFromOffset,
  resolvePayloadCoverageStartOffset,
  FULL_CHART_STREAM_START_TOLERANCE_SEC,
  rollupSeries,
  sevenTvEmotesFromRollup,
  sparklineIndexFromClick,
  toggleEmotePlotKeys,
  MAX_PLOTTED_EMOTES,
} from '../src/ui/chatActivityEmotes.ts'
import { emoteSyncDotColor } from '../src/ui/emoteSync.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import { downsampleRollupsForChart } from '../src/ui/extensionChartPoints.ts'

describe('chatActivityEmotes', () => {
  it('detects 7TV providers', () => {
    expect(isSevenTvProvider('7TV')).toBe(true)
    expect(isSevenTvProvider('seventv')).toBe(true)
    expect(isSevenTvProvider('twitch')).toBe(false)
  })

  it('aggregates 7TV emotes across rollups', () => {
    const emotes = aggregateSevenTvEmotes([
      {
        offsetSeconds: 0,
        topEmotes: [{ name: 'KEKW', provider: '7TV', count: 3 }],
      },
      {
        offsetSeconds: 60,
        topEmotes: [{ name: 'KEKW', provider: 'seventv', count: 2 }],
      },
    ])
    expect(emotes).toHaveLength(1)
    expect(emotes[0]?.count).toBe(5)
  })

  it('maps sparkline click index within bounds', () => {
    const rect = { left: 0, width: 300, top: 0, height: 40, right: 300, bottom: 40, x: 0, y: 0, toJSON: () => ({}) }
    expect(sparklineIndexFromClick(150, rect as DOMRect, 10)).toBeGreaterThanOrEqual(0)
    expect(sparklineIndexFromClick(150, rect as DOMRect, 10)).toBeLessThan(10)
  })

  it('builds per-minute emote overlay series', () => {
    const emote = { id: 'abc', name: 'KEKW', provider: 'seventv', count: 1 }
    const rollups = [
      { offsetSeconds: 0, topEmotes: [{ ...emote, count: 2 }] },
      { offsetSeconds: 60, topEmotes: [{ name: 'OTHER', provider: 'seventv', count: 1 }] },
      { offsetSeconds: 120, topEmotes: [{ ...emote, count: 5 }] },
    ]
    expect(buildSelectedEmoteSeries(rollups, emote)).toEqual([2, 0, 5])
    expect(emoteSelectionKey(emote)).toBe('seventv:abc:KEKW')
  })

  it('sums emote counts per downsample bucket for trace lines', () => {
    const emote = { id: 'lo', name: 'LO', provider: 'seventv', count: 1 }
    const fullRollups = Array.from({ length: 8 }, (_, index) => ({
      offsetSeconds: index * 60,
      topEmotes: [{ ...emote, count: index % 3 === 0 ? 2 : 1 }],
    }))
    const displayRollups = downsampleRollupsForChart(fullRollups, 4)
    expect(displayRollups).toHaveLength(4)
    expect(buildBucketedEmoteSeries(fullRollups, displayRollups, emote)).toEqual([3, 3, 2, 3])
    expect(buildBucketedEmoteSeries(fullRollups, fullRollups, emote)).toEqual([2, 1, 1, 2, 1, 1, 2, 1])
  })

  it('fits per-emote trace axis to visible positive values', () => {
    expect(activityAxisBounds([[0, 0, 4, 8, 0]])).toEqual({ min: 3, max: 9 })
    expect(activityAxisBounds([[0, 0, 0]])).toEqual({ min: 0, max: 1 })
  })

  it('anchors shared trace axis at zero for sidebar lanes', () => {
    expect(activityAxisBoundsFromZero([[2, 40, 89], [1, 5, 63]])).toEqual({ min: 0, max: 94 })
  })

  it('builds baseline emote overlays for totals and 7TV', () => {
    const rollups = [
      { offsetSeconds: 0, totalEmoteCount: 4, sevenTvEmoteCount: 3 },
      { offsetSeconds: 60, totalEmoteCount: 2, sevenTvEmoteCount: 1 },
    ]
    const overlays = buildBaselineEmoteOverlays(rollups)
    expect(overlays).toHaveLength(2)
    expect(overlays[0]?.label).toBe('Emotes')
    expect(overlays[0]?.values).toEqual([4, 2])
    expect(overlays[1]?.label).toBe('7TV')
    expect(overlays[1]?.dashed).toBe(true)
    expect(overlays[1]?.values).toEqual([3, 1])
  })

  it('merges overlay series without duplicate keys', () => {
    const merged = mergeEmoteOverlaySeries([
      { key: 'emotes-total', label: 'Emotes', color: '#34d399', values: [1, 2] },
      { key: 'emotes-total', label: 'Emotes', color: '#34d399', values: [9, 9] },
      { key: 'emotes-7tv', label: '7TV', color: '#6ee7b7', values: [1, 0], dashed: true },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.values).toEqual([1, 2])
  })

  it('builds rollup series from payload rollups', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 120,
      rollups: [
        { offsetSeconds: 0, chatCount: 1 },
        { offsetSeconds: 60, chatCount: 2, topEmotes: [{ name: 'LUL', provider: '7TV', count: 1 }] },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    expect(rollupSeries(payload)).toHaveLength(2)
    expect(sevenTvEmotesFromRollup(rollupSeries(payload)[1]!)).toHaveLength(1)
  })

  it('prefers fullRollups when full timeline window is requested', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 7200,
      rollups: [{ offsetSeconds: 6900, chatCount: 5 }],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1 },
        { offsetSeconds: 60, chatCount: 2 },
        { offsetSeconds: 120, chatCount: 3 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    expect(rollupSeries(payload, 'recent')).toHaveLength(1)
    expect(rollupSeries(payload, 'full')).toHaveLength(3)
  })

  it('chartRollupSeries uses full stream rollups and keeps quiet minutes', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 180,
      rollups: [{ offsetSeconds: 120, chatCount: 9 }],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 0 },
        { offsetSeconds: 60, chatCount: 4 },
        { offsetSeconds: 120, chatCount: 9 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    const rollups = chartRollupSeries(payload)
    expect(rollups).toHaveLength(3)
    expect(chatSeriesFromRollups(rollups)).toEqual([0, 4, 9])
    expect(chartMaxPoints(payload, 'full')).toBe(480)
    expect(chartMaxPoints(payload, '2h')).toBe(120)
  })

  it('chartEmptyMessage explains warming and missing full rollups', () => {
    expect(
      chartEmptyMessage({
        rollupCount: 0,
        chartWindow: '30m',
        hasFullRollups: false,
        confidence: 'Waiting for first minute',
        currentOffsetSeconds: 0,
      }),
    ).toContain('first minute')

    expect(
      chartEmptyMessage({
        rollupCount: 0,
        chartWindow: 'full',
        hasFullRollups: false,
        confidence: 'Collecting',
        currentOffsetSeconds: 7200,
      }),
    ).toContain('no rollups')
  })

  it('slices rollups for the 2h chart window', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 7200,
      rollups: [],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1 },
        { offsetSeconds: 5400, chatCount: 2 },
        { offsetSeconds: 7140, chatCount: 9 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    const rollups = prepareChartRollups(payload, { chartWindow: '2h', currentOffsetSeconds: 7200 })
    expect(rollups.every(r => r.offsetSeconds >= 7200 - 2 * 60 * 60)).toBe(true)
    expect(rollups[rollups.length - 1]?.chatCount).toBe(9)
  })

  it('densifies sparse full-stream rollups across the stream timeline when tracked from start', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 240,
      coverageStartOffsetSeconds: 90,
      rollups: [{ offsetSeconds: 240, chatCount: 9 }],
      fullRollups: [
        { offsetSeconds: 120, chatCount: 2 },
        { offsetSeconds: 180, chatCount: 4 },
        { offsetSeconds: 240, chatCount: 9 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    const rollups = prepareChartRollups(payload, { chartWindow: 'full', currentOffsetSeconds: 240 })
    expect(rollups).toHaveLength(5)
    expect(rollups[0]?.offsetSeconds).toBe(0)
    expect(rollups[0]?.chatCount).toBe(0)
    expect(rollups[4]?.chatCount).toBe(9)
  })

  it('densifyRollupsForTimeline bucketing keeps averaged viewer samples per bucket', () => {
    const rollups = [
      { offsetSeconds: 0, chatCount: 10, viewerCount: 10_000 },
      { offsetSeconds: 60, chatCount: 12, viewerCount: 12_000 },
      { offsetSeconds: 120, chatCount: 8, viewerCount: 8_000 },
    ]
    const densified = densifyRollupsForTimeline(rollups, {
      fromOffset: 0,
      toOffset: 600 * 60,
      maxPoints: 480,
    })
    expect(densified.length).toBe(480)
    expect(densified.some(bucket => (bucket.viewerCount ?? 0) > 0)).toBe(true)
    const firstBucket = densified[0]
    expect(firstBucket?.viewerCount).toBe(10_000)
  })

  describe('late-start full-timeline honesty (P1-008)', () => {
    const coverage45m = 45 * 60

    function lateStartPayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
      return {
        login: 'test',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: coverage45m + 900,
        coverageStartOffsetSeconds: coverage45m,
        rollups: [],
        fullRollups: [
          { offsetSeconds: coverage45m, chatCount: 12 },
          { offsetSeconds: coverage45m + 60, chatCount: 18 },
          { offsetSeconds: coverage45m + 120, chatCount: 9 },
          { offsetSeconds: coverage45m + 180, chatCount: 22 },
        ],
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
        ...overrides,
      }
    }

    it('starts full-window densification at coverage start when first rollup is ~45 minutes', () => {
      const payload = lateStartPayload()
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
        coverageStartOffsetSeconds: coverage45m,
      })
      expect(rollups.length).toBeGreaterThan(0)
      expect(rollups[0]?.offsetSeconds).toBeGreaterThanOrEqual(coverage45m)
      expect(rollups.every(r => r.offsetSeconds >= coverage45m)).toBe(true)
      expect(rollups.some(r => r.offsetSeconds < coverage45m && (r.chatCount ?? 0) === 0 && !r.missing)).toBe(false)
      expect(rollups[0]?.chatCount).toBeGreaterThan(0)
    })

    it('does not synthesize quiet chat for 00:00 through pre-coverage minutes', () => {
      const payload = lateStartPayload()
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
      })
      const preCoverage = rollups.filter(r => r.offsetSeconds < coverage45m)
      expect(preCoverage).toHaveLength(0)
    })

    it('reads coverage start from nested payload.coverage when top-level field is absent', () => {
      const payload = lateStartPayload({
        coverageStartOffsetSeconds: undefined,
        coverage: {
          state: 'partial_live',
          coverageStartOffsetSeconds: coverage45m,
          coverageEndOffsetSeconds: coverage45m + 900,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
        },
      })
      expect(resolvePayloadCoverageStartOffset(payload)).toBe(coverage45m)
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
      })
      expect(rollups[0]?.offsetSeconds).toBeGreaterThanOrEqual(coverage45m)
    })

    it('honors explicit coverageStartOffsetSeconds override over payload defaults', () => {
      const payload = lateStartPayload({ coverageStartOffsetSeconds: 0 })
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
        coverageStartOffsetSeconds: coverage45m,
      })
      expect(rollups.every(r => r.offsetSeconds >= coverage45m)).toBe(true)
    })
  })

  describe('resolveFullChartFromOffset', () => {
    it('aligns at 00:00 when coverage start is within the 120-second tolerance', () => {
      expect(FULL_CHART_STREAM_START_TOLERANCE_SEC).toBe(120)
      expect(resolveFullChartFromOffset(90, 90)).toBe(0)
      expect(resolveFullChartFromOffset(120, 120)).toBe(0)
    })

    it('aligns at coverage start for true late joins with a missing prefix', () => {
      const coverage45m = 45 * 60
      expect(resolveFullChartFromOffset(coverage45m, coverage45m)).toBe(coverage45m)
      expect(
        resolveFullChartFromOffset(coverage45m, coverage45m, {
          state: 'missing_ranges_detected',
          coverageStartOffsetSeconds: coverage45m,
          coverageEndOffsetSeconds: coverage45m + 900,
          hasFullStreamCoverage: false,
          hasGaps: true,
          missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: coverage45m - 60 }],
          canBackfill: false,
          message: '',
        }),
      ).toBe(coverage45m)
    })

    it('still spans from 00:00 for quiet openings before the first chat minute', () => {
      expect(resolveFullChartFromOffset(240, 240)).toBe(0)
      expect(
        resolveFullChartFromOffset(240, 240, {
          state: 'partial_tracking',
          coverageStartOffsetSeconds: 240,
          coverageEndOffsetSeconds: 3600,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
          message: '',
        }),
      ).toBe(0)
    })

    it('uses the earlier of coverage start and first rollup offset for late joins', () => {
      const coverage45m = 45 * 60
      const lateCoverage = {
        state: 'missing_ranges_detected' as const,
        coverageStartOffsetSeconds: coverage45m,
        coverageEndOffsetSeconds: coverage45m + 900,
        hasFullStreamCoverage: false,
        hasGaps: true,
        missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: coverage45m - 60 }],
        canBackfill: false,
        message: '',
      }
      expect(resolveFullChartFromOffset(coverage45m, 3540, lateCoverage)).toBe(coverage45m)
      expect(resolveFullChartFromOffset(coverage45m, 3660, lateCoverage)).toBe(coverage45m)
    })
  })

  describe('resolveFullChartDensifyFromOffset', () => {
    it('clips long dead zones before the first active rollup minute', () => {
      const payload: PulsePayload = {
        login: 'test',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: 7200,
        coverageStartOffsetSeconds: 240,
        rollups: [],
        fullRollups: [
          { offsetSeconds: 2400, chatCount: 12, sevenTvEmoteCount: 4, viewerCount: 18_000 },
          { offsetSeconds: 2460, chatCount: 18, sevenTvEmoteCount: 6, viewerCount: 18_400 },
        ],
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
      }
      expect(FULL_CHART_DEAD_ZONE_CLIP_SEC).toBe(600)
      expect(resolveFullChartDensifyFromOffset(payload, payload.fullRollups!)).toBe(2400)
      const rollups = prepareChartRollups(payload, { chartWindow: 'full', currentOffsetSeconds: 7200 })
      expect(rollups[0]?.offsetSeconds).toBe(2400)
    })
  })

  describe('fullRollupsMissingStreamPrefix', () => {
    it('detects tail-trimmed fullRollups on long streams', () => {
      const payload: PulsePayload = {
        login: 'test',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: 532 * 60,
        coverageStartOffsetSeconds: 0,
        rollups: [],
        fullRollups: Array.from({ length: 480 }, (_, i) => ({
          offsetSeconds: (52 * 60) + i * 60,
          chatCount: 10,
          sevenTvEmoteCount: 5,
        })),
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
      }
      expect(fullRollupsMissingStreamPrefix(payload)).toBe(true)
    })

    it('returns false when fullRollups span from stream start', () => {
      const payload: PulsePayload = {
        login: 'test',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: 532 * 60,
        coverageStartOffsetSeconds: 0,
        rollups: [],
        fullRollups: Array.from({ length: 480 }, (_, i) => ({
          offsetSeconds: i * 60,
          chatCount: 10,
          sevenTvEmoteCount: 5,
        })),
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
      }
      expect(fullRollupsMissingStreamPrefix(payload)).toBe(false)
    })
  })

  it('caps plotted emote toggles at MAX_PLOTTED_EMOTES', () => {
    expect(MAX_PLOTTED_EMOTES).toBe(6)
    let keys = toggleEmotePlotKeys([], 'a')
    keys = toggleEmotePlotKeys(keys, 'b')
    keys = toggleEmotePlotKeys(keys, 'c')
    keys = toggleEmotePlotKeys(keys, 'd')
    keys = toggleEmotePlotKeys(keys, 'e')
    keys = toggleEmotePlotKeys(keys, 'f')
    expect(keys).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(toggleEmotePlotKeys(keys, 'g')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(toggleEmotePlotKeys(keys, 'b')).toEqual(['a', 'c', 'd', 'e', 'f'])
  })

  it('normalizes overlay axis per series when expanded', () => {
    expect(overlaySeriesAxisMax([10, 100, 50], false, 500)).toBe(500)
    expect(overlaySeriesAxisMax([10, 100, 50], true, 500)).toBe(100)
    expect(overlaySeriesAxisMax([0, null, 0], true, 500)).toBe(1)
  })
})

describe('emoteSyncDotColor', () => {
  it('maps sync tone to dot colors', () => {
    expect(emoteSyncDotColor('ok')).toBe('#34d399')
    expect(emoteSyncDotColor('warn')).toBe('#f97316')
    expect(emoteSyncDotColor('muted')).toBe('#6b7280')
  })
})
