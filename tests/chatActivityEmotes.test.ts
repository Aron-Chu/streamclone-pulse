import { describe, expect, it } from 'vitest'
import {
  aggregateSevenTvEmotes,
  buildSelectedEmoteSeries,
  chartMaxPoints,
  chartEmptyMessage,
  chartRollupSeries,
  chatSeriesFromRollups,
  emoteSelectionKey,
  isSevenTvProvider,
  prepareChartRollups,
  rollupSeries,
  sevenTvEmotesFromRollup,
  sparklineIndexFromClick,
} from '../src/ui/chatActivityEmotes.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

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
    expect(chartMaxPoints(payload)).toBe(480)
  })

  it('chartEmptyMessage explains warming and missing full rollups', () => {
    expect(
      chartEmptyMessage({
        rollupCount: 0,
        fullTimelineRequested: false,
        hasFullRollups: false,
        confidence: 'Waiting for first minute',
        currentOffsetSeconds: 0,
      }),
    ).toContain('first minute')

    expect(
      chartEmptyMessage({
        rollupCount: 0,
        fullTimelineRequested: true,
        hasFullRollups: false,
        confidence: 'Collecting',
        currentOffsetSeconds: 7200,
      }),
    ).toContain('no rollups')
  })

  it('densifies sparse full-stream rollups across the stream timeline', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 240,
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
    const rollups = prepareChartRollups(payload, { fullTimeline: true, currentOffsetSeconds: 240 })
    expect(rollups).toHaveLength(5)
    expect(rollups[0]?.offsetSeconds).toBe(0)
    expect(rollups[0]?.chatCount).toBe(0)
    expect(rollups[4]?.chatCount).toBe(9)
  })
})
