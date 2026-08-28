import { describe, expect, it } from 'vitest'
import { resolveEmoteImageUrl, safeConsoleEmoteImageUrl } from './emoteImageUrl.ts'

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

  it('does not fabricate a backend path from a legacy display-name key', () => {
    expect(resolveEmoteImageUrl({
      provider: 'unknown',
      id: 'Clap',
    })).toBe('')
  })


  it('allows only provider CDNs and backend-relative emote assets', () => {
    expect(safeConsoleEmoteImageUrl('/emotes/11111111-1111-4111-8111-111111111111/1x.webp')).toBe(
      '/emotes/11111111-1111-4111-8111-111111111111/1x.webp',
    )
    expect(safeConsoleEmoteImageUrl('https://cdn.betterttv.net/emote/abc/3x')).toBe(
      'https://cdn.betterttv.net/emote/abc/3x',
    )
    expect(safeConsoleEmoteImageUrl('javascript:alert(1)')).toBe('')
    expect(safeConsoleEmoteImageUrl('https://example.com/emote.webp')).toBe('')
  })
})
