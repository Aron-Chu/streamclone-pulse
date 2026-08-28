import { describe, expect, it } from 'vitest'
import {
  findNearestHeatmapPoint,
  findNearestRecapMoment,
} from './selectedMomentMatch.ts'
import { gameNameAtOffset } from './gameSegmentChart.ts'
import { buildSelectedMomentDisplay } from './selectedMomentDisplay.ts'
import type { VodLinkState } from './twitchVodUrl.ts'

describe('findNearestRecapMoment', () => {
  it('matches within tolerance and rejects far offsets', () => {
    const moments = [
      { offsetSeconds: 11580, score: 36, reasons: ['viewer_spike'] },
      { offsetSeconds: 11160, score: 35, reasons: ['twitch_emote_spike'] },
    ]
    expect(findNearestRecapMoment(moments, 11545)?.score).toBe(36)
    expect(findNearestRecapMoment(moments, 20000)).toBeNull()
  })

  it('matches refined recap rows by analytical onset instead of playback seek', () => {
    const moments = [
      {
        offsetSeconds: 600,
        reactionOnsetOffsetSeconds: 608,
        seekOffsetSeconds: 500,
        precisionSeconds: 1,
        score: 90,
      },
      {
        offsetSeconds: 720,
        reactionOnsetOffsetSeconds: 728,
        seekOffsetSeconds: 607,
        precisionSeconds: 1,
        score: 80,
      },
    ]
    expect(findNearestRecapMoment(moments, 608, 30)?.score).toBe(90)
  })
})

describe('findNearestHeatmapPoint', () => {
  it('prefers the closer heatmap bucket', () => {
    const points = [
      {
        offsetSeconds: 11520,
        durationSeconds: 60,
        score: 8,
        confidence: 0.5,
        reason: 'seventv_spike',
        topEmotes: [],
        vodId: '',
        streamId: '',
        minuteTs: '2026-07-13T21:48:00Z',
      },
      {
        offsetSeconds: 11580,
        durationSeconds: 60,
        score: 36,
        confidence: 0.8,
        reason: 'viewer_spike',
        topEmotes: [],
        vodId: '',
        streamId: '',
        minuteTs: '2026-07-13T21:49:00Z',
      },
    ]
    expect(findNearestHeatmapPoint(points, 11545)?.score).toBe(8)
    expect(findNearestHeatmapPoint(points, 11570)?.score).toBe(36)
  })
})

describe('gameNameAtOffset', () => {
  const games = [
    { gameName: 'Clash Royale', offsetSeconds: 0, durationSeconds: 960 },
    { gameName: 'Just Chatting', offsetSeconds: 960, durationSeconds: 4739 },
    { gameName: 'Clash Royale', offsetSeconds: 5700, durationSeconds: 10704 },
  ]

  it('returns the covering segment and live-tail last game', () => {
    expect(gameNameAtOffset(games, 11545)).toBe('Clash Royale')
    expect(gameNameAtOffset(games, 1000)).toBe('Just Chatting')
    expect(gameNameAtOffset(games, 20000)).toBe('Clash Royale')
  })
})

describe('buildSelectedMomentDisplay pulse parity', () => {
  const vodLinkState: VodLinkState = {
    status: 'unavailable',
    label: 'Live — no VOD yet',
    detail: 'VOD attaches after the stream ends',
  }
  const startedAt = '2026-07-13T18:31:35Z'
  const rollup = {
    minuteTs: '2026-07-13T21:43:40.000Z',
    chatCount: 375,
    totalEmoteCount: 206,
    seventvEmoteCount: 188,
    viewerLatest: 41046,
    emotes: {
      'seventv:SON': 14,
      'seventv:LOL': 13,
      'twitch:LUL': 6,
    },
  }

  it('uses Pulse Moment score and shared emote resolver when matched', () => {
    const display = buildSelectedMomentDisplay({
      rollup,
      rollups: [rollup],
      startedAt,
      vodLinkState,
      recapMoment: {
        offsetSeconds: 11580,
        score: 36,
        reasons: ['viewer_spike'],
        topEmotes: [
          { code: 'geeg', count: 24, provider: 'seventv' },
          { code: 'WW', count: 24, provider: 'seventv' },
          { code: 'jynxziVapeBreak', count: 21, provider: 'twitch' },
        ],
      },
      gameName: 'Clash Royale',
    })
    expect(display.scoreModel.score).toBe(36)
    expect(display.scoreModel.estimated).toBe(false)
    expect(display.scoreModel.reasonLabel.toLowerCase()).toContain('viewer')
    expect(display.momentEmotes.map((emote) => emote.name)).toEqual([
      'geeg',
      'WW',
      'jynxziVapeBreak',
    ])
    expect(display.gameName).toBe('Clash Royale')
  })
})
