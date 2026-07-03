import { describe, expect, it, vi } from 'vitest'
import { absolutizeEmoteAssetUrl } from '../src/lib/emoteAssetUrl'
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
})
