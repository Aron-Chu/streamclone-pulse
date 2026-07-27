import { describe, expect, it } from 'vitest'
import {
  buildTwitchVodUrl,
  resolveAnalyticsVodId,
  resolveSessionFallbackVodId,
  resolveVodLinkState,
} from '@streampulse/analytics-console/utils/twitchVodUrl'

describe('resolveAnalyticsVodId', () => {
  it('falls back to recap vod id when stream detail has none', () => {
    expect(
      resolveAnalyticsVodId(
        { vodId: undefined, stream: {} },
        '2809816759',
      ),
    ).toBe('2809816759')
  })
})

describe('resolveVodLinkState', () => {
  it('links when vod id is on stream detail', () => {
    const state = resolveVodLinkState({
      detail: {
        vodId: '123',
        stream: { vodId: '123', endedAt: null },
      },
    })
    expect(state.status).toBe('linked')
    expect(state.vodId).toBe('123')
    expect(buildTwitchVodUrl(state.vodId!, 125)).toContain('123')
    expect(buildTwitchVodUrl(state.vodId!, 125)).toContain('t=2m5s')
  })

  it('labels linked live collector vod as live archive', () => {
    const state = resolveVodLinkState({
      detail: {
        vodId: '2814106332',
        state: 'live',
        stream: { vodId: '2814106332', endedAt: null },
      },
      isLiveCollector: true,
    })
    expect(state.status).toBe('linked')
    expect(state.label).toMatch(/live archive/i)
  })

  it('explains live sessions without a vod id', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'live',
        stream: { endedAt: null },
      },
      isLiveCollector: true,
    })
    expect(state.status).toBe('live')
    expect(state.label).toMatch(/live/i)
  })

  it('marks ended sessions with no vod as unavailable', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'historical',
        stream: {
          endedAt: '2026-06-01T06:00:00Z',
        },
        availability: { vodState: 'unavailable' },
      },
    })
    expect(state.status).toBe('unavailable')
    expect(state.detail.toLowerCase()).toContain('deleted')
  })

  it('does not show live copy when channelIsLive is false on stale open row', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'live',
        stream: { endedAt: undefined },
      },
      channelIsLive: false,
      isLiveCollector: false,
    })
    expect(state.status).not.toBe('live')
    expect(state.label).not.toMatch(/no VOD yet/i)
  })

  it('does not use another sidebar session vod as fallback', () => {
    const fallback = resolveSessionFallbackVodId({
      targetQueryStreamId: '111',
      sidebarStreams: [
        { streamId: '222', vodId: '2814106332' },
        { streamId: '111' },
      ],
      detail: { stream: {} },
    })
    expect(fallback).toBeUndefined()
    const state = resolveVodLinkState({
      detail: { stream: { endedAt: '2026-07-07T08:00:00Z' } },
      fallbackVodId: fallback,
      channelIsLive: false,
    })
    // Offline + unresolved: wait for Twitch publication (not neighbor VOD, not terminal unavailable).
    expect(state.status).toBe('syncing')
    expect(state.vodId).toBeUndefined()
    expect(state.detail.toLowerCase()).toMatch(/waiting|publication/)
  })

  it('uses vod id from the current sidebar session row', () => {
    const fallback = resolveSessionFallbackVodId({
      targetQueryStreamId: '111',
      sidebarStreams: [{ streamId: '111', vodId: '2814106332' }],
      detail: { stream: {} },
    })
    expect(fallback).toBe('2814106332')
    const state = resolveVodLinkState({
      detail: { stream: { endedAt: '2026-07-07T08:00:00Z' } },
      fallbackVodId: fallback,
      channelIsLive: false,
    })
    expect(state.status).toBe('linked')
    expect(state.vodId).toBe('2814106332')
  })
})
