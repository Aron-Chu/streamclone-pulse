import { describe, expect, it } from 'vitest'
import {
  pulseSurfaceCursorSource,
  pulseSurfaceIsLive,
  pulseSurfaceShowsFutureFade,
  resolvePulseSurfaceMode,
} from '../src/ui/pulseSurfaceMode.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'test', vodId: null }
const VOD: TwitchPageContext = { kind: 'vod', login: 'test', vodId: '2838742057' }

function payload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [],
    recap: null,
    ...overrides,
  }
}

const RECAP: NonNullable<PulsePayload['recap']> = {
  streamId: '1',
  login: 'test',
  durationSeconds: 3600,
  totalMessages: 100,
  peakChatPerMin: 40,
  topMoments: [],
  topEmotes: [],
  clipCandidates: [],
}

describe('resolvePulseSurfaceMode', () => {
  it('reports channel_live for a tracked live channel', () => {
    expect(resolvePulseSurfaceMode({ context: CHANNEL, payload: payload(), pageIsLive: true }))
      .toBe('channel_live')
  })

  it('reports channel_live when the page is live but the backend is still stale', () => {
    expect(
      resolvePulseSurfaceMode({
        context: CHANNEL,
        payload: payload({ isLive: false }),
        pageIsLive: true,
      }),
    ).toBe('channel_live')
  })

  it('reports channel_recap for a finished stream even if the page still looks live', () => {
    expect(
      resolvePulseSurfaceMode({
        context: CHANNEL,
        payload: payload({ isLive: false, recap: RECAP }),
        pageIsLive: true,
      }),
    ).toBe('channel_recap')
  })

  it('reports channel_recap for an offline channel with no payload', () => {
    expect(resolvePulseSurfaceMode({ context: CHANNEL, payload: null, pageIsLive: false }))
      .toBe('channel_recap')
  })

  it('reports vod_player on /videos/{id} regardless of live flags', () => {
    expect(resolvePulseSurfaceMode({ context: VOD, payload: payload(), pageIsLive: true }))
      .toBe('vod_player')
  })
})

describe('surface mode predicates', () => {
  it('treats only channel_live as live', () => {
    expect(pulseSurfaceIsLive('channel_live')).toBe(true)
    expect(pulseSurfaceIsLive('channel_recap')).toBe(false)
    expect(pulseSurfaceIsLive('vod_player')).toBe(false)
  })

  it('maps each surface to its cursor source', () => {
    expect(pulseSurfaceCursorSource('channel_live')).toBe('live_edge')
    expect(pulseSurfaceCursorSource('vod_player')).toBe('player_time')
    expect(pulseSurfaceCursorSource('channel_recap')).toBe('none')
  })

  it('never fades the future on any surface (faded tail removed across the panel)', () => {
    expect(pulseSurfaceShowsFutureFade('channel_recap')).toBe(false)
    expect(pulseSurfaceShowsFutureFade('channel_live')).toBe(false)
    expect(pulseSurfaceShowsFutureFade('vod_player')).toBe(false)
  })
})
