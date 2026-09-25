import { describe, expect, it } from 'vitest'
import { SPARKLINE_MAX_POINTS } from '@streampulse/pulse-core'
import {
  aggregateSevenTvEmotes,
  activityAxisBounds,
  activityAxisBoundsFromZero,
  buildBaselineEmoteOverlays,
  buildBucketedEmoteSeries,
  buildEmoteCountIndex,
  buildEmoteOverlaySeries,
  buildSelectedEmoteSeries,
  chartMaxPoints,
  chartEmptyMessage,
  chartRollupSeries,
  chatSeriesFromRollups,
  emoteCountAtRollup,
  emoteSelectionKey,
  isSevenTvProvider,
  mergeEmoteOverlaySeries,
  overlaySeriesAxisMax,
  prepareChartRollups,
  densifyRollupsForTimeline,
  resolveFullChartDensifyFromOffset,
  fullRollupsMissingStreamPrefix,
  hasFullTimelineRollups,
  resolvePayloadCoverageStartOffset,
  resolveChartCoverageStartSeconds,
  FULL_CHART_STREAM_START_TOLERANCE_SEC,
  rollupSeries,
  sevenTvEmotesFromRollup,
  sparklineIndexFromClick,
  toggleEmotePlotKeys,
  MAX_PLOTTED_EMOTES,
  DEFAULT_CHART_TIMELINE_WINDOW,
  CHART_WINDOW_OPTIONS,
} from '../src/ui/chatActivityEmotes.ts'
import { makeFullHistoryActivation } from '../src/shared/fullHistoryAuth.ts'
import { emoteSyncDotColor } from '../src/ui/emoteSync.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import { downsampleRollupsForChart } from '../src/ui/extensionChartPoints.ts'

describe('chatActivityEmotes', () => {
  it('uses Full stream as the shared fresh-chart default', () => {
    expect(DEFAULT_CHART_TIMELINE_WINDOW).toBe('full')
    expect(CHART_WINDOW_OPTIONS.find(option => option.value === '60m')?.label).toBe('1 hour')
    expect(CHART_WINDOW_OPTIONS.at(-1)?.label).toBe('Full stream')
  })

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

  it('indexed emote lookup matches scan and stays within display limits', () => {
    const emote = { id: 'abc', name: 'KEKW', provider: 'seventv', count: 1 }
    const rollups = [
      { offsetSeconds: 0, topEmotes: [{ ...emote, count: 2 }, { id: 'z', name: 'Z', provider: 'seventv', count: 9 }] },
      { offsetSeconds: 60, topEmotes: [{ name: 'OTHER', provider: 'seventv', count: 1 }] },
      { offsetSeconds: 120, topEmotes: [{ ...emote, count: 5 }] },
    ]
    const index = buildEmoteCountIndex(rollups)
    expect(index.get(emoteSelectionKey(emote))).toEqual([2, 0, 5])
    expect(buildSelectedEmoteSeries(rollups, emote)).toEqual(
      rollups.map(rollup => emoteCountAtRollup(rollup, emote)),
    )
    const overlays = buildEmoteOverlaySeries(rollups, [emote, { id: 'z', name: 'Z', provider: 'seventv', count: 1 }])
    expect(overlays).toHaveLength(2)
    expect(overlays[0]?.values).toEqual([2, 0, 5])
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

  it('keeps an explicitly finalized quiet minute in the recent chart', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      rollups: [
        { offsetSeconds: 0, finalized: true, chatCount: 0, totalEmoteCount: 0 },
        { offsetSeconds: 60, finalized: false, chatCount: 0, totalEmoteCount: 0 },
        { offsetSeconds: 120, chatCount: 4 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    expect(rollupSeries(payload, 'recent').map(rollup => rollup.offsetSeconds)).toEqual([0, 120])
  })

  it('keeps a validated live full fallback nonempty while preserving its missing gap', () => {
    const activation = makeFullHistoryActivation({ login: 'xqc', streamId: '320977139673', vodId: '2852444512' })
    const fullRollups = Array.from({ length: 226 }, (_, index) => index * 60)
      .filter(offsetSeconds => offsetSeconds < 60 || offsetSeconds >= 180)
      .map(offsetSeconds => ({ offsetSeconds, chatCount: offsetSeconds > 180 ? 12 : 0, sevenTvEmoteCount: 2 }))
    const payload: PulsePayload = {
      login: 'xqc',
      streamId: activation.streamId,
      vodId: activation.vodId,
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 13_540,
      coverageStartOffsetSeconds: 0,
      rollups: [{ offsetSeconds: 13_500, chatCount: 12, sevenTvEmoteCount: 2 }],
      fullRollups,
      coverage: {
        state: 'missing_ranges_detected',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 13_440,
        hasFullStreamCoverage: false,
        trackedFromStart: true,
        hasGaps: true,
        missingRanges: [{ fromOffsetSeconds: 60, toOffsetSeconds: 180 }],
        canBackfill: true,
        message: 'Missing chat data from 00:01:00 to 00:03:00',
      },
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }

    expect(hasFullTimelineRollups(payload, activation)).toBe(true)
    const prepared = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: payload.currentOffsetSeconds,
      activation,
    })

    expect(prepared.length).toBeGreaterThan(0)
    expect(prepared.some(rollup => rollup.missing && rollup.offsetSeconds === 60)).toBe(true)
    expect(prepared.some(rollup => rollup.missing && rollup.offsetSeconds === 120)).toBe(true)
    expect(prepared.some(rollup => !rollup.missing && (rollup.chatCount ?? 0) > 0)).toBe(true)

    const wrongActivation = makeFullHistoryActivation({ login: 'xqc', streamId: 'different-stream' })
    const wrongActivationPrepared = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: payload.currentOffsetSeconds,
      activation: wrongActivation,
    })
    expect(wrongActivationPrepared).toHaveLength(SPARKLINE_MAX_POINTS)
    expect(wrongActivationPrepared[0]).toMatchObject({ offsetSeconds: 0, missing: true })
    expect(wrongActivationPrepared.some(rollup => (rollup.chatCount ?? 0) > 0)).toBe(true)
  })

  it('keeps recent rollups visible while a full-history response is unavailable', () => {
    const activation = makeFullHistoryActivation({ login: 'jynxzi', streamId: 'live-stream' })
    const payload: PulsePayload = {
      login: 'jynxzi',
      streamId: activation.streamId,
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 20_000,
      rollups: [
        { offsetSeconds: 19_880, chatCount: 4 },
        { offsetSeconds: 19_940, chatCount: 9 },
        { offsetSeconds: 20_000, chatCount: 12 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }

    const prepared = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: payload.currentOffsetSeconds,
      activation,
    })

    expect(prepared).toHaveLength(SPARKLINE_MAX_POINTS)
    expect(prepared[0]).toMatchObject({ offsetSeconds: 0, missing: true })
    expect(prepared.some(rollup => (rollup.chatCount ?? 0) > 0)).toBe(true)
  })

  it('preserves recent viewer samples when full history omits the tail viewer lane', () => {
    const activation = makeFullHistoryActivation({ login: 'jynxzi', streamId: 'viewer-tail' })
    const payload: PulsePayload = {
      login: 'jynxzi',
      streamId: activation.streamId,
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 120,
      rollups: [
        { offsetSeconds: 120, chatCount: 12, viewerCount: 42_000 },
      ],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 2 },
        { offsetSeconds: 60, chatCount: 4 },
        { offsetSeconds: 120, chatCount: 12 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }

    const prepared = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: payload.currentOffsetSeconds,
      activation,
    })

    expect(prepared.find(rollup => rollup.offsetSeconds === 120)?.viewerCount).toBe(42_000)
  })

  it('extends retained Full history with the recurring recent chat and emote tail', () => {
    const activation = makeFullHistoryActivation({ login: 'xqc', streamId: 'live-tail' })
    const payload: PulsePayload = {
      login: 'xqc',
      streamId: activation.streamId,
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 240,
      rollups: [{
        offsetSeconds: 180,
        chatCount: 298,
        sevenTvEmoteCount: 229,
        totalEmoteCount: 244,
        viewerCount: 21_800,
        topEmotes: [{ id: 'tail-emote', name: 'TAIL', count: 24 }],
      }],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 20, sevenTvEmoteCount: 4 },
        { offsetSeconds: 60, chatCount: 30, sevenTvEmoteCount: 5 },
        { offsetSeconds: 120, chatCount: 40, sevenTvEmoteCount: 6 },
      ],
      coverage: {
        state: 'live',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 120,
        hasFullStreamCoverage: true,
        hasGaps: false,
        canBackfill: false,
      },
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }

    const prepared = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: payload.currentOffsetSeconds,
      activation,
    })
    const tail = prepared.find(rollup => rollup.offsetSeconds === 180)

    expect(tail).toMatchObject({
      chatCount: 298,
      sevenTvEmoteCount: 229,
      totalEmoteCount: 244,
      viewerCount: 21_800,
    })
    expect(tail?.topEmotes?.[0]?.name).toBe('TAIL')
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

    expect(chartEmptyMessage({
      rollupCount: 59,
      visibleRollupCount: 0,
      chartWindow: 'full',
      hasFullRollups: false,
      confidence: 'Collecting',
      currentOffsetSeconds: 25_200,
    })).toContain('available outside this view')
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

  it('preserves hosted rollups whose minute phase is offset from :00', () => {
    const densified = densifyRollupsForTimeline([
      { offsetSeconds: 0, chatCount: 228, totalEmoteCount: 200 },
      { offsetSeconds: 21, chatCount: 325, totalEmoteCount: 392 },
      { offsetSeconds: 81, chatCount: 532, totalEmoteCount: 465 },
      { offsetSeconds: 141, chatCount: 615, totalEmoteCount: 314 },
    ], {
      fromOffset: 0,
      toOffset: 180,
      maxPoints: 480,
    })

    expect(densified.find(rollup => rollup.offsetSeconds === 21)?.chatCount).toBe(325)
    expect(densified.find(rollup => rollup.offsetSeconds === 81)?.chatCount).toBe(532)
    expect(densified.find(rollup => rollup.offsetSeconds === 141)?.totalEmoteCount).toBe(314)
    expect(densified.filter(rollup => (rollup.chatCount ?? 0) > 0)).toHaveLength(4)
  })

  it('does not flatten phase-shifted rollups when aggregating a long timeline', () => {
    const densified = densifyRollupsForTimeline(
      Array.from({ length: 12 }, (_, index) => ({
        offsetSeconds: index === 0 ? 0 : 21 + (index - 1) * 60,
        chatCount: 100 + index,
        totalEmoteCount: 200 + index,
      })),
      {
        fromOffset: 0,
        toOffset: 12 * 60 * 60,
        maxPoints: 120,
      },
    )

    expect(densified.some(rollup => (rollup.chatCount ?? 0) > 0 && !rollup.missing)).toBe(true)
    expect(densified.reduce((sum, rollup) => sum + (rollup.chatCount ?? 0), 0)).toBeGreaterThan(0)
  })

  it('preserves recent viewer samples when full buckets are offset by a few seconds', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 660,
      coverageStartOffsetSeconds: 0,
      rollups: [
        { offsetSeconds: 541, chatCount: 8, viewerCount: 12_340 },
        { offsetSeconds: 601, chatCount: 9, viewerCount: 12_510 },
      ],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1 },
        { offsetSeconds: 540, chatCount: 2 },
        { offsetSeconds: 600, chatCount: 3 },
        { offsetSeconds: 660, chatCount: 4 },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
      coverage: {
        state: 'full_stream_tracked',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 660,
        trackedFromStart: true,
        hasFullStreamCoverage: true,
        hasGaps: false,
        canBackfill: false,
      },
    }
    const rollups = prepareChartRollups(payload, {
      chartWindow: 'full',
      currentOffsetSeconds: 660,
    })
    expect(rollups.find(rollup => rollup.offsetSeconds === 540)?.viewerCount).toBe(12_340)
    expect(rollups.find(rollup => rollup.offsetSeconds === 600)?.viewerCount).toBe(12_510)
    expect(rollups.find(rollup => rollup.offsetSeconds === 0)?.viewerCount).toBeUndefined()
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
          { offsetSeconds: coverage45m + 900, chatCount: 5 },
        ],
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
        ...overrides,
      }
    }

    it('shows the true full-stream domain and marks the untracked prefix missing', () => {
      const payload = lateStartPayload()
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
        coverageStartOffsetSeconds: coverage45m,
      })
      expect(rollups.length).toBeGreaterThan(0)
      expect(rollups[0]?.offsetSeconds).toBe(0)
      expect(rollups.filter(r => r.offsetSeconds < coverage45m).every(r => r.missing)).toBe(true)
      expect(rollups.some(r => r.offsetSeconds >= coverage45m && (r.chatCount ?? 0) > 0)).toBe(true)
    })

    it('does not synthesize quiet chat for 00:00 through pre-coverage minutes', () => {
      const payload = lateStartPayload()
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
      })
      const preCoverage = rollups.filter(r => r.offsetSeconds < coverage45m)
      expect(preCoverage.length).toBeGreaterThan(0)
      expect(preCoverage.every(r => r.missing)).toBe(true)
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
      expect(rollups[0]?.offsetSeconds).toBe(0)
      expect(rollups.filter(r => r.offsetSeconds < coverage45m).every(r => r.missing)).toBe(true)
    })

    it('honors explicit coverageStartOffsetSeconds override over payload defaults', () => {
      const payload = lateStartPayload({ coverageStartOffsetSeconds: 0 })
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: payload.currentOffsetSeconds ?? 0,
        coverageStartOffsetSeconds: coverage45m,
      })
      expect(rollups[0]?.offsetSeconds).toBe(0)
      expect(rollups.filter(r => r.offsetSeconds < coverage45m).every(r => r.missing)).toBe(true)
    })
  })

  describe('resolveChartCoverageStartSeconds', () => {
    it('keeps the rail at stream start when full coverage is authoritative', () => {
      expect(resolveChartCoverageStartSeconds({
        coverageStartOffsetSeconds: 18 * 60,
        coverage: {
          state: 'full_stream_tracked',
          coverageStartOffsetSeconds: 0,
          coverageEndOffsetSeconds: 3600,
          trackedFromStart: true,
          hasFullStreamCoverage: true,
          hasGaps: false,
          canBackfill: false,
        },
      }, 18 * 60, 18 * 60)).toBe(0)
    })

    it('retains an explicit missing prefix for a late join', () => {
      expect(resolveChartCoverageStartSeconds({
        coverageStartOffsetSeconds: 45 * 60,
        coverage: {
          state: 'missing_ranges_detected',
          coverageStartOffsetSeconds: 45 * 60,
          coverageEndOffsetSeconds: 60 * 60,
          hasFullStreamCoverage: false,
          hasGaps: true,
          canBackfill: false,
          missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 45 * 60 }],
        },
      }, undefined, 46 * 60)).toBe(45 * 60)
    })

    it('does not infer a missing prefix from a quiet first rollup', () => {
      expect(resolveChartCoverageStartSeconds({
        coverageStartOffsetSeconds: 0,
        coverage: {
          state: 'partial_tracking',
          coverageStartOffsetSeconds: 0,
          coverageEndOffsetSeconds: 3600,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
        },
      }, undefined, 18 * 60)).toBe(0)
    })
  })

  describe('resolveFullChartDensifyFromOffset', () => {
    it('keeps long unavailable prefixes on the full-stream domain', () => {
      const payload: PulsePayload = {
        login: 'test',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: 7200,
        coverageStartOffsetSeconds: 240,
        rollups: [],
        fullRollups: [
          { offsetSeconds: 240, chatCount: 0, sevenTvEmoteCount: 0, viewerCount: 0 },
          { offsetSeconds: 2400, chatCount: 12, sevenTvEmoteCount: 4, viewerCount: 18_000 },
          { offsetSeconds: 2460, chatCount: 18, sevenTvEmoteCount: 6, viewerCount: 18_400 },
        ],
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
        coverage: {
          state: 'partial_tracking',
          coverageStartOffsetSeconds: 240,
          coverageEndOffsetSeconds: 2460,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
        },
      }
      expect(resolveFullChartDensifyFromOffset(payload, payload.fullRollups!)).toBe(0)
      const rollups = prepareChartRollups(payload, { chartWindow: 'full', currentOffsetSeconds: 7200 })
      expect(rollups[0]?.offsetSeconds).toBe(0)
    })

    it('keeps zero-filled quiet history aligned to the left edge when full coverage is authoritative', () => {
      const payload: PulsePayload = {
        login: 'test',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: 2400,
        coverageStartOffsetSeconds: 0,
        rollups: [],
        fullRollups: [
          { offsetSeconds: 0, chatCount: 0, sevenTvEmoteCount: 0 },
          { offsetSeconds: 1200, chatCount: 0, sevenTvEmoteCount: 0 },
          { offsetSeconds: 1800, chatCount: 12, sevenTvEmoteCount: 4 },
          { offsetSeconds: 2400, chatCount: 5, sevenTvEmoteCount: 2 },
        ],
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
        coverage: {
          state: 'full_stream_tracked',
          coverageStartOffsetSeconds: 0,
          coverageEndOffsetSeconds: 2400,
          trackedFromStart: true,
          hasFullStreamCoverage: true,
          hasGaps: false,
          canBackfill: false,
        },
      }
      expect(resolveFullChartDensifyFromOffset(payload, payload.fullRollups!)).toBe(0)
      const rollups = prepareChartRollups(payload, { chartWindow: 'full', currentOffsetSeconds: 2400 })
      expect(rollups[0]?.offsetSeconds).toBe(0)
      expect(rollups.some(rollup => rollup.offsetSeconds >= 1200 && rollup.offsetSeconds < 1800 && (rollup.chatCount ?? 0) === 0)).toBe(true)
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
        coverage: {
          state: 'partial_tracking',
          coverageStartOffsetSeconds: 0,
          coverageEndOffsetSeconds: 52 * 60 + 479 * 60,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
        },
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
        coverage: {
          state: 'partial_tracking',
          coverageStartOffsetSeconds: 0,
          coverageEndOffsetSeconds: 479 * 60,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
        },
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
