import { describe, expect, it } from 'vitest'
import { resolveJumpMomentAction } from '../src/ui/jumpMomentAction.ts'
import { buildTwitchVodUrl } from '../src/shared/pastVods.ts'

const liveContext = { kind: 'channel' as const, login: 'xqc', vodId: null }

describe('resolveJumpMomentAction', () => {
  it('does not offer a live seek when the non-mutating player probe is outside the DVR range', () => {
    expect(resolveJumpMomentAction({
      context: liveContext,
      payloadIsLive: true,
      liveCurrentOffset: 30_000,
      liveSeekable: false,
      offsetSeconds: 10_000,
    })).toEqual({ kind: 'live-outside-buffer', offsetSeconds: 10_000 })
  })

  it('keeps a verified seekable live point in the player path', () => {
    expect(resolveJumpMomentAction({
      context: liveContext,
      payloadIsLive: true,
      liveCurrentOffset: 30_000,
      liveSeekable: true,
      offsetSeconds: 29_700,
    })).toEqual({ kind: 'seek-live-dvr', offsetSeconds: 29_700, liveCurrentOffset: 30_000 })
  })

  it('prefers an exact locally validated VOD over the live player', () => {
    expect(resolveJumpMomentAction({
      context: liveContext,
      payloadVodId: '2838742057',
      payloadIsLive: true,
      liveCurrentOffset: 30_000,
      liveSeekable: true,
      offsetSeconds: 10_000,
    })).toEqual({ kind: 'open-vod-tab', vodId: '2838742057', offsetSeconds: 10_000 })
  })

  it('prefers a current-broadcast navigation VOD over live DVR', () => {
    expect(resolveJumpMomentAction({
      context: liveContext,
      navigationVodId: '2839713915',
      payloadIsLive: true,
      liveCurrentOffset: 30_000,
      liveSeekable: true,
      offsetSeconds: 12_345,
    })).toEqual({ kind: 'open-vod-tab', vodId: '2839713915', offsetSeconds: 12_345 })
  })

  it('builds a timestamped Twitch VOD URL for navigation jumps', () => {
    const action = resolveJumpMomentAction({
      context: liveContext,
      navigationVodId: '2839713915',
      payloadIsLive: true,
      liveCurrentOffset: 30_000,
      liveSeekable: false,
      offsetSeconds: 3661,
    })
    expect(action).toEqual({ kind: 'open-vod-tab', vodId: '2839713915', offsetSeconds: 3661 })
    if (action.kind === 'open-vod-tab') {
      expect(buildTwitchVodUrl(action.vodId, action.offsetSeconds)).toBe(
        'https://www.twitch.tv/videos/2839713915?t=1h1m1s',
      )
    }
  })
})
