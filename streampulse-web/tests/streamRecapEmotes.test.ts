import { describe, expect, it, beforeEach } from 'vitest'

import { configureEmoteAssetBase } from '@streamclone/analytics-console/configureApi'
import { getEmoteImageUrl } from '@streamclone/analytics-console/utils/consoleFormat'
import { enrichRecapEmoteFromCatalog } from '@streamclone/analytics-console/utils/recapEmoteEnrich'

describe('recap emote image URLs', () => {
  beforeEach(() => {
    configureEmoteAssetBase(() => 'https://api.streampulse.stream')
  })

  it('prefers hosted imageUrl from recap payload', () => {
    const url = getEmoteImageUrl({
      provider: 'seventv',
      id: '9ceb7717-39fc-4afa-a5cf-829ad4ef22e3',
      imageUrl: 'https://cdn.7tv.app/emote/01FZ975PV8000B4AWRZNMVNEXN/4x.webp',
    })
    expect(url).toBe('https://cdn.7tv.app/emote/01FZ975PV8000B4AWRZNMVNEXN/4x.webp')
  })

  it('resolves analytics catalog emote shape', () => {
    const url = getEmoteImageUrl({
      provider: 'seventv',
      id: '328172f0-64fd-4249-a164-9915fc87a26d',
      imageUrl: 'https://cdn.7tv.app/emote/01JP0FG0NN10YJPYVTZN5K67WY/4x.webp',
    })
    expect(url).toContain('cdn.7tv.app')
  })

  it('prefixes relative hosted emote paths with configured API base', () => {
    const url = getEmoteImageUrl({
      provider: 'seventv',
      id: '328172f0-64fd-4249-a164-9915fc87a26d',
      imageUrl: '/emotes/328172f0-64fd-4249-a164-9915fc87a26d/1x.webp',
    })
    expect(url).toBe(
      'https://api.streampulse.stream/emotes/328172f0-64fd-4249-a164-9915fc87a26d/1x.webp',
    )
  })

  it('resolves rollup emote hits with image_url and emote key', () => {
    const url = getEmoteImageUrl({
      key: 'seventv:328172f0-64fd-4249-a164-9915fc87a26d:LOL',
      name: 'LOL',
      provider: 'seventv',
      image_url: '/emotes/328172f0-64fd-4249-a164-9915fc87a26d/1x.webp',
    } as { key: string; name: string; provider: string; image_url: string })
    expect(url).toBe(
      'https://api.streampulse.stream/emotes/328172f0-64fd-4249-a164-9915fc87a26d/1x.webp',
    )
  })

  it('does not treat a plain 7TV emote name as a CDN id', () => {
    const url = getEmoteImageUrl({
      provider: 'seventv',
      id: 'RT',
    })

    expect(url).toBeUndefined()
  })
})

describe('recap emote catalog enrichment', () => {
  beforeEach(() => {
    configureEmoteAssetBase(() => 'https://api.streampulse.stream')
  })

  it('fills imageUrl from catalog when recap has unresolvable id only', () => {
    const enriched = enrichRecapEmoteFromCatalog(
      { code: 'BasedGod', count: 100, provider: 'seventv', id: 'BasedGod' },
      [
        {
          key: 'seventv:uuid-based:BasedGod',
          name: 'BasedGod',
          provider: 'seventv',
          imageUrl: '/emotes/uuid-based/1x.webp',
          count: 100,
        },
      ],
    )
    expect(enriched.imageUrl).toBe('/emotes/uuid-based/1x.webp')
    expect(
      getEmoteImageUrl({
        provider: enriched.provider,
        id: enriched.id,
        imageUrl: enriched.imageUrl,
      }),
    ).toBe('https://api.streampulse.stream/emotes/uuid-based/1x.webp')
  })

  it('skips catalog when recap already has resolvable imageUrl', () => {
    const enriched = enrichRecapEmoteFromCatalog(
      {
        code: 'KEKW',
        count: 10,
        provider: 'seventv',
        imageUrl: 'https://cdn.7tv.app/emote/01ABC/4x.webp',
      },
      [
        {
          key: 'seventv:other:KEKW',
          name: 'KEKW',
          provider: 'seventv',
          imageUrl: '/emotes/other/1x.webp',
          count: 5,
        },
      ],
    )
    expect(enriched.imageUrl).toBe('https://cdn.7tv.app/emote/01ABC/4x.webp')
  })
})
