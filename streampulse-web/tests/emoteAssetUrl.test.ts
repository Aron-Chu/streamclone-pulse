import { describe, expect, it, vi } from 'vitest'
import {
  absolutizeEmoteAssetUrl,
  emoteDisplaySrc,
  emoteSrcSet,
  emoteUrlForScale,
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

describe('emoteUrlForScale / emoteSrcSet', () => {
  it('transforms 7TV URLs across 1x/2x/4x', () => {
    const base = 'https://cdn.7tv.app/emote/abc/4x.webp'
    expect(emoteUrlForScale(base, '1x')).toBe('https://cdn.7tv.app/emote/abc/1x.webp')
    expect(emoteUrlForScale(base, '2x')).toBe('https://cdn.7tv.app/emote/abc/2x.webp')
    expect(emoteUrlForScale(base, '4x')).toBe('https://cdn.7tv.app/emote/abc/4x.webp')
    expect(emoteSrcSet(base)).toBe(
      'https://cdn.7tv.app/emote/abc/1x.webp 1x, https://cdn.7tv.app/emote/abc/2x.webp 2x, https://cdn.7tv.app/emote/abc/4x.webp 4x',
    )
  })

  it('transforms Twitch CDN URLs across 1.0/2.0/3.0', () => {
    const base = 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'
    expect(emoteUrlForScale(base, '1x')).toContain('/1.0')
    expect(emoteUrlForScale(base, '2x')).toContain('/2.0')
    expect(emoteUrlForScale(base, '4x')).toContain('/3.0')
    expect(emoteSrcSet(base)).toContain('1x')
    expect(emoteSrcSet(base)).toContain('2x')
  })

  it('transforms FFZ URLs across 1/2/4', () => {
    const base = 'https://cdn.frankerfacez.com/emote/12345/4'
    expect(emoteUrlForScale(base, '1x')).toBe('https://cdn.frankerfacez.com/emote/12345/1')
    expect(emoteUrlForScale(base, '2x')).toBe('https://cdn.frankerfacez.com/emote/12345/2')
    expect(emoteUrlForScale(base, '4x')).toBe('https://cdn.frankerfacez.com/emote/12345/4')
    expect(emoteSrcSet(base)).toContain('1x')
    expect(emoteSrcSet(base)).toContain('4x')
  })

  it('defaults small display src to 1x not 4x', () => {
    const base = 'https://cdn.7tv.app/emote/abc/4x.webp'
    expect(emoteDisplaySrc(base, 28)).toBe('https://cdn.7tv.app/emote/abc/1x.webp')
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
