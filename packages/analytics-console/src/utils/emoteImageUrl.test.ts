import { describe, expect, it } from 'vitest'
import { getEmoteImageUrl } from './consoleFormat.ts'
import { emoteDisplaySources, resolveEmoteImageUrl } from './emoteImageUrl.ts'

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

  it('does not request a hosted emote path from a name-only portal key', () => {
    expect(resolveEmoteImageUrl({ provider: 'unknown', id: 'Clap' })).toBe('')
    expect(resolveEmoteImageUrl({ provider: '7tv', id: 'Clap' })).toBe('')
    expect(resolveEmoteImageUrl({ provider: '7tv', id: 'Clap', imageUrl: '/emotes/Clap/1x.webp' })).toBe('')
    expect(getEmoteImageUrl({ key: '7tv:Clap:Clap' })).toBeUndefined()
  })
})

describe('emoteDisplaySources', () => {
  it('requests 1x with a 2x candidate for provider CDN scales', () => {
    expect(emoteDisplaySources('https://cdn.7tv.app/emote/01J9SW1G38000124YQG75TYD8M/4x.webp')).toEqual({
      src: 'https://cdn.7tv.app/emote/01J9SW1G38000124YQG75TYD8M/1x.webp',
      srcSet: 'https://cdn.7tv.app/emote/01J9SW1G38000124YQG75TYD8M/1x.webp 1x, https://cdn.7tv.app/emote/01J9SW1G38000124YQG75TYD8M/2x.webp 2x',
    })
    expect(emoteDisplaySources('https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc/default/dark/2.0').src)
      .toBe('https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc/default/dark/1.0')
    expect(emoteDisplaySources('https://cdn.frankerfacez.com/emoticon/12345/4').srcSet)
      .toBe('https://cdn.frankerfacez.com/emoticon/12345/1 1x, https://cdn.frankerfacez.com/emoticon/12345/2 2x')
    expect(emoteDisplaySources('https://cdn.betterttv.net/emote/5e76d338d6581c3724c0f0b2/3x.webp').src)
      .toBe('https://cdn.betterttv.net/emote/5e76d338d6581c3724c0f0b2/1x.webp')
  })

  it('leaves relative, proxy and unknown URLs unchanged', () => {
    expect(emoteDisplaySources('/emotes/295e06df-204b-49c6-8204-b6fd84c01221/1x.webp')).toEqual({ src: '/emotes/295e06df-204b-49c6-8204-b6fd84c01221/1x.webp' })
    expect(emoteDisplaySources('https://api.streampulse.stream/emotes/295e06df-204b-49c6-8204-b6fd84c01221/1x.webp').srcSet).toBeUndefined()
    expect(emoteDisplaySources('https://cdn.example/emote/4x.webp')).toEqual({ src: 'https://cdn.example/emote/4x.webp' })
  })
})

