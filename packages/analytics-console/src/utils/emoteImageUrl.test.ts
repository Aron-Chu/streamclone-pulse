import { describe, expect, it } from 'vitest'
import { resolveEmoteImageUrl } from './emoteImageUrl.ts'

describe('resolveEmoteImageUrl', () => {
  it('uses a console-sized 7TV asset for provider IDs', () => {
    expect(resolveEmoteImageUrl({
      provider: '7tv',
      id: '62a3bf572b964d6cc2766004',
    })).toBe('https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/2x.webp')
  })

  it('preserves an explicit direct 7TV URL from the payload', () => {
    expect(resolveEmoteImageUrl({
      provider: '7tv',
      id: '62a3bf572b964d6cc2766004',
      imageUrl: 'https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp',
    })).toBe('https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp')
  })
})
