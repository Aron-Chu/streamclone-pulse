import { describe, expect, it } from 'vitest'
import { extensionEmoteImageUrl } from '../src/shared/emoteUrl.ts'

describe('extensionEmoteImageUrl', () => {
  it('prefixes local emote proxy paths with the configured backend', () => {
    const url = extensionEmoteImageUrl(
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        provider: 'seventv',
        imageUrl: '/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1x.webp',
      },
      'http://localhost:8081',
    )
    expect(url).toBe(
      'http://localhost:8081/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1x.webp',
    )
  })

  it('keeps absolute CDN urls unchanged', () => {
    const url = extensionEmoteImageUrl(
      {
        id: '12345',
        provider: 'seventv',
        imageUrl: 'https://cdn.7tv.app/emote/12345/4x.webp',
      },
      'http://localhost:8081',
    )
    expect(url).toBe('https://cdn.7tv.app/emote/12345/4x.webp')
  })

  it('falls back to provider and id when imageUrl is empty', () => {
    const url = extensionEmoteImageUrl(
      {
        id: '12345',
        provider: 'seventv',
      },
      'http://localhost:8081',
    )
    expect(url).toBe('https://cdn.7tv.app/emote/12345/4x.webp')
  })

  it('uses 7TV CDN for legacy ids even when backend returns a broken local path', () => {
    const url = extensionEmoteImageUrl(
      {
        id: '62a3bf572b964d6cc2766004',
        provider: '7TV',
        imageUrl: '/emotes/62a3bf572b964d6cc2766004/1x.webp',
      },
      'http://localhost:8081',
    )
    expect(url).toBe('https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp')
  })
})
