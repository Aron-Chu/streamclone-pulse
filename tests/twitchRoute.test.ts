import { describe, expect, it } from 'vitest'
import {
  contextFromRoute,
  isSameRouteSession,
  prefetchChannelLoginFromUrl,
  resolveRuntimeExtensionMode,
  resolveTwitchRoute,
  routeSessionKey,
} from '../src/routing/twitchRoute.ts'

describe('resolveTwitchRoute', () => {
  it('detects VOD ID from /videos/2806037629', () => {
    expect(resolveTwitchRoute('https://www.twitch.tv/videos/2806037629')).toEqual({
      kind: 'vod-replay',
      vodId: '2806037629',
    })
  })

  it('detects VOD ID with query params', () => {
    expect(resolveTwitchRoute('https://www.twitch.tv/videos/2806037629?t=1234')).toEqual({
      kind: 'vod-replay',
      vodId: '2806037629',
    })
  })

  it('detects channel login from /xqc', () => {
    expect(resolveTwitchRoute('https://www.twitch.tv/xqc')).toEqual({
      kind: 'live-channel',
      channelLogin: 'xqc',
    })
  })

  it('detects channel VOD watch URL', () => {
    expect(resolveTwitchRoute('https://www.twitch.tv/xqc/videos/1234567890')).toEqual({
      kind: 'vod-replay',
      vodId: '1234567890',
      channelLogin: 'xqc',
    })
  })

  it('handles trailing slash on channel', () => {
    expect(resolveTwitchRoute('https://www.twitch.tv/xqc/')).toEqual({
      kind: 'live-channel',
      channelLogin: 'xqc',
    })
  })

  it('ignores unsupported Twitch routes', () => {
    expect(resolveTwitchRoute('https://www.twitch.tv/directory')).toEqual({
      kind: 'missing-data',
      reason: 'unsupported_route',
    })
    expect(resolveTwitchRoute('https://www.twitch.tv/clips')).toEqual({
      kind: 'missing-data',
      reason: 'unsupported_route',
    })
    expect(resolveTwitchRoute('https://www.twitch.tv/drops')).toEqual({
      kind: 'missing-data',
      reason: 'unsupported_route',
    })
  })
})

describe('prefetchChannelLoginFromUrl', () => {
  it('maps channel routes only for single-segment paths', () => {
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc')).toBe('xqc')
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc/videos/1')).toBeNull()
  })
})

describe('route session keys', () => {
  it('uses distinct keys for channel and vod', () => {
    expect(routeSessionKey({ kind: 'live-channel', channelLogin: 'xqc' })).toBe('xqc')
    expect(routeSessionKey({ kind: 'vod-replay', vodId: '123' })).toBe('vod:123')
    expect(isSameRouteSession(
      { kind: 'live-channel', channelLogin: 'xqc' },
      { kind: 'offline-channel-recap', channelLogin: 'xqc' },
    )).toBe(true)
    expect(isSameRouteSession(
      { kind: 'vod-replay', vodId: '123' },
      { kind: 'live-channel', channelLogin: 'xqc' },
    )).toBe(false)
  })
})

describe('resolveRuntimeExtensionMode', () => {
  it('promotes offline channel with recap to offline-channel-recap', () => {
    expect(
      resolveRuntimeExtensionMode({
        route: { kind: 'live-channel', channelLogin: 'xqc' },
        pageIsLive: false,
        hasRecap: true,
      }),
    ).toEqual({ kind: 'offline-channel-recap', channelLogin: 'xqc' })
  })

  it('keeps live channel when page is live', () => {
    expect(
      resolveRuntimeExtensionMode({
        route: { kind: 'live-channel', channelLogin: 'xqc' },
        pageIsLive: true,
        hasRecap: true,
      }).kind,
    ).toBe('live-channel')
  })
})

describe('contextFromRoute', () => {
  it('maps vod replay to twitch page context', () => {
    expect(contextFromRoute({ kind: 'vod-replay', vodId: '99', channelLogin: 'xqc' })).toEqual({
      kind: 'vod',
      login: 'xqc',
      vodId: '99',
    })
  })
})
