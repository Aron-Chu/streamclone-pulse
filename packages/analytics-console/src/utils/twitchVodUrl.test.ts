import { describe, expect, it } from 'vitest'
import { resolveVodLinkState } from './twitchVodUrl.ts'

describe('resolveVodLinkState availability transitions', () => {
  it('tracks live → ended resolving → linked without remount heuristics', () => {
    const live = resolveVodLinkState({
      detail: {
        state: 'live',
        stream: { endedAt: null },
        availability: { vodState: 'pending_live', vodMessage: 'VOD pending while live' },
      },
      channelIsLive: true,
    })
    expect(live.status).toBe('live')
    expect(live.label).toMatch(/Live/i)

    const resolving = resolveVodLinkState({
      detail: {
        state: 'historical',
        stream: { endedAt: '2026-07-25T12:00:00Z' },
        availability: {
          vodState: 'resolving',
          vodMessage: 'Stream ended — waiting for Twitch VOD publication.',
        },
      },
      channelIsLive: false,
    })
    expect(resolving.status).toBe('syncing')
    expect(resolving.label).toMatch(/Waiting for Twitch VOD/i)
    expect(resolving.detail).toMatch(/waiting for Twitch VOD publication/i)

    const linked = resolveVodLinkState({
      detail: {
        state: 'historical',
        stream: { endedAt: '2026-07-25T12:00:00Z', vodId: '123456' },
        availability: { vodState: 'linked', vodId: '123456' },
      },
      channelIsLive: false,
    })
    expect(linked.status).toBe('linked')
    expect(linked.vodId).toBe('123456')
  })

  it('treats external offline without VOD as waiting, not unavailable', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'live',
        stream: { endedAt: null },
      },
      channelIsLive: false,
    })
    expect(state.status).toBe('syncing')
    expect(state.detail).toMatch(/Stream ended — waiting for Twitch VOD publication/i)
  })

  it('surfaces request_failed and unavailable as distinct terminal states', () => {
    expect(
      resolveVodLinkState({
        detail: { availability: { vodState: 'request_failed', vodMessage: 'Helix timeout' } },
      }).status,
    ).toBe('request_failed')
    expect(
      resolveVodLinkState({
        detail: { availability: { vodState: 'unavailable' } },
      }).status,
    ).toBe('unavailable')
  })
})
