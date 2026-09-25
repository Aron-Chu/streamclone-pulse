import { describe, expect, it } from 'vitest'
import {
  buildTwitchVodUrl,
  resolveAnalyticsVodId,
  resolveVodLinkState,
} from './twitchVodUrl.ts'

describe('Twitch VOD links', () => {
  it('does not promise pending video for a legacy live status without lifecycle evidence', () => {
    const state = resolveVodLinkState({ detail: {
      stream: { lifecycleState: 'unknown' },
      availability: { vodState: 'pending_live', vodMessage: 'VOD pending while live' },
    } })
    expect(state.status).toBe('unavailable')
    expect(state.label).toBe('VOD not linked')
    expect(state.detail).toContain('Analytics are available')
    expect(state.detail).not.toMatch(/pending|processing|still live/i)
  })
  it('does not turn missing video into an archive-existence or lifecycle claim', () => {
    for (const vodState of ['unavailable', 'pending_live', 'resolving']) {
      const state = resolveVodLinkState({ detail: { stream: { lifecycleState: 'unknown' }, availability: { vodState } } })
      expect(state.detail).not.toMatch(/No Twitch VOD exists|deleted|Stream ended|still live/i)
      expect(state.status).not.toBe('live')
    }
  })
  it('does not call a confirmed-ended broadcast live when the archive poll is a cache miss', () => {
    const state = resolveVodLinkState({ detail: {
      stream: { lifecycleState: 'confirmed_ended' },
      availability: { vodState: 'pending_live' },
    } })
    expect(state.status).toBe('unavailable')
    expect(state.detail).toContain('confirmed ended')
    expect(state.detail).not.toMatch(/still live|waiting for Twitch VOD/i)
  })
  it('does not repeat stale live copy under a confirmed past broadcast', () => {
    for (const vodState of ['pending_live', 'resolving', 'request_failed', 'unavailable', 'linked']) {
      const state = resolveVodLinkState({
        detail: {
          stream: { lifecycleState: 'confirmed_ended' },
          availability: { vodState, vodMessage: 'This session is still live.' },
          ...(vodState === 'linked' ? { vodId: '2834444095' } : {}),
        },
        isLiveCollector: true,
      })
      expect(state.status).not.toBe('live')
      expect(`${state.label} ${state.detail}`).not.toMatch(/still live|live archive/i)
    }
  })
  it('lets past detail override stale live flags when lifecycle is absent', () => {
    for (const pastDetail of [
      { state: 'historical' },
      { availability: { liveDvrState: 'ended' } },
    ]) {
      const pending = resolveVodLinkState({
        detail: {
          ...pastDetail,
          availability: { ...pastDetail.availability, vodState: 'pending_live', vodMessage: 'This session is still live.' },
        },
        isLiveCollector: true,
        channelIsLive: true,
      })
      expect(pending.status).not.toBe('live')
      expect(`${pending.label} ${pending.detail}`).not.toMatch(/still live|live archive/i)

      const withoutArchiveState = resolveVodLinkState({
        detail: pastDetail,
        isLiveCollector: true,
        channelIsLive: true,
      })
      expect(withoutArchiveState.status).not.toBe('live')

      const linked = resolveVodLinkState({
        detail: {
          ...pastDetail,
          vodId: '2834444095',
          availability: { ...pastDetail.availability, vodState: 'pending_live', vodMessage: 'This session is still live.' },
        },
        isLiveCollector: true,
        channelIsLive: true,
      })
      expect(linked.status).toBe('linked')
      expect(`${linked.label} ${linked.detail}`).not.toMatch(/still live|live archive/i)
    }
  })
  it('uses the validated VOD id and stream-relative offset', () => {
    expect(buildTwitchVodUrl('2834270468', 240)).toBe(
      'https://www.twitch.tv/videos/2834270468?t=4m0s',
    )
  })

  it('rejects arbitrary video URLs instead of embedding them in a Twitch path', () => {
    expect(buildTwitchVodUrl('https://www.twitch.tv/videos/2834444095', 240)).toBe(
      'https://www.twitch.tv',
    )
    expect(resolveAnalyticsVodId({ vodId: 'https://www.twitch.tv/videos/2834444095' })).toBeUndefined()
    expect(resolveVodLinkState({
      fallbackVodId: 'https://www.twitch.tv/videos/2834444095',
      channelIsLive: false,
    }).status).toBe('unavailable')
  })

  it('links a concrete archive even when the live availability poll is stale', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'live',
        vodId: '2834444095',
        availability: {
          vodState: 'pending_live',
          vodMessage: 'VOD pending while live',
        },
      },
      isLiveCollector: true,
    })
    expect(state.status).toBe('linked')
    expect(state.vodId).toBe('2834444095')
    expect(state.label).toBe('Jump to VOD (live archive)')
  })
})
