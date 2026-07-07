import { describe, expect, it, vi } from 'vitest'
import {
  absolutizeEmoteAssetUrl,
  isBackendEmoteProxyUrl,
  preferResolvableEmoteUrl,
} from '../src/lib/emoteAssetUrl'
import { buildEmoteLookup, resolveMomentEmote } from '../src/lib/pulseMomentsUtils'

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

describe('absolutizeEmoteAssetUrl', () => {
  it('prefixes backend-relative emote paths', () => {
    expect(absolutizeEmoteAssetUrl('/emotes/abc/1x.webp')).toBe(
      'https://api.streampulse.stream/emotes/abc/1x.webp',
    )
  })

  it('leaves absolute URLs unchanged', () => {
    const url = 'https://cdn.7tv.app/emote/01/test/4x.webp'
    expect(absolutizeEmoteAssetUrl(url)).toBe(url)
  })
})

describe('isBackendEmoteProxyUrl', () => {
  it('detects relative and absolute proxy paths', () => {
    expect(isBackendEmoteProxyUrl('/emotes/uuid/1x.webp')).toBe(true)
    expect(isBackendEmoteProxyUrl('https://api.streampulse.stream/emotes/uuid/1x.webp')).toBe(true)
    expect(isBackendEmoteProxyUrl('https://cdn.7tv.app/emote/abc/4x.webp')).toBe(false)
  })
})

describe('preferResolvableEmoteUrl', () => {
  it('prefers CDN over backend proxy on bucket rows', () => {
    expect(
      preferResolvableEmoteUrl(
        '/emotes/local-uuid/1x.webp',
        'https://cdn.7tv.app/emote/provider-id/4x.webp',
      ),
    ).toBe('https://cdn.7tv.app/emote/provider-id/4x.webp')
  })

  it('keeps direct CDN when bucket already has it', () => {
    const cdn = 'https://cdn.7tv.app/emote/abc/4x.webp'
    expect(preferResolvableEmoteUrl(cdn, 'https://cdn.example/fallback.webp')).toBe(cdn)
  })
})

describe('buildEmoteLookup provider keys', () => {
  it('resolves BTTV emotes by provider when names collide', () => {
    const lookup = buildEmoteLookup([
      { name: 'LUL', provider: 'twitch', count: 1, sharePct: 0, imageUrl: 'https://twitch/lul.png' },
      {
        name: 'OMEGALUL',
        provider: 'bttv',
        count: 2,
        sharePct: 0,
        imageUrl: '/emotes/bttv-id/1x.webp',
      },
    ])
    const resolved = resolveMomentEmote(
      { offsetSeconds: 1, score: 1, label: 'spike', topEmotes: [{ name: 'OMEGALUL', provider: 'bttv', count: 2 }] },
      lookup,
    )
    expect(resolved?.imageUrl).toBe('https://api.streampulse.stream/emotes/bttv-id/1x.webp')
  })

  it('matches seventv catalog rows when bucket uses 7tv provider label', () => {
    const lookup = buildEmoteLookup([
      {
        name: 'WideFire',
        provider: 'seventv',
        count: 1,
        sharePct: 0,
        imageUrl: 'https://cdn.7tv.app/emote/abc/4x.webp',
      },
    ])
    expect(lookup.get('7tv:widefire')?.imageUrl).toBe('https://cdn.7tv.app/emote/abc/4x.webp')
  })
})
