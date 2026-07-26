import { describe, expect, it, beforeEach } from 'vitest'

import { configureEmoteAssetBase } from '@streampulse/analytics-console/configureApi'
import { getEmoteImageUrl } from '@streampulse/analytics-console/utils/consoleFormat'
import {
  enrichRecapEmoteFromCatalog,
  findPeakEmoteMinuteFromRollups,
  resolveBurstDisplayEmote,
  resolveRecapBurstHighlight,
  resolveRecapDisplayEmotes,
} from '@streampulse/analytics-console/utils/recapEmoteEnrich'

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

describe('resolveRecapDisplayEmotes', () => {
  it('merges recap seventv-only rows with multi-provider session catalog', () => {
    const merged = resolveRecapDisplayEmotes(
      [{ code: 'BasedGod', count: 500, provider: 'seventv' }],
      [
        {
          key: 'twitch:1:Kappa',
          name: 'Kappa',
          provider: 'twitch',
          count: 800,
        },
        {
          key: 'seventv:2:BasedGod',
          name: 'BasedGod',
          provider: 'seventv',
          count: 500,
        },
        {
          key: 'bttv:3:KEKW',
          name: 'KEKW',
          provider: 'bttv',
          count: 300,
        },
      ],
      5,
    )
    expect(merged.map((emote) => emote.code)).toEqual(['Kappa', 'BasedGod', 'KEKW'])
    expect(merged.some((emote) => emote.provider === 'twitch')).toBe(true)
  })
})

describe('peak emote minute highlight', () => {
  const catalog = [
    {
      key: 'seventv:lol-id:LOL',
      name: 'LOL',
      id: 'lol-id',
      provider: 'seventv',
      imageUrl: '/emotes/lol-id/1x.webp',
      count: 13_100,
    },
    {
      key: 'seventv:forsen-id:forsenPls',
      name: 'forsenPls',
      id: 'forsen-id',
      provider: 'seventv',
      imageUrl: '/emotes/forsen-id/1x.webp',
      count: 4,
    },
  ]

  const streamStartedAt = '2026-07-07T08:00:00.000Z'
  const rollups: Array<{
    minuteTs: string
    chatCount: number
    emotes: Record<string, number>
  }> = [
    {
      minuteTs: '2026-07-07T10:53:00.000Z',
      chatCount: 100,
      emotes: { 'seventv:forsen-id:forsenPls': 4 },
    },
    {
      minuteTs: '2026-07-07T10:56:00.000Z',
      chatCount: 480,
      emotes: { 'seventv:lol-id:LOL': 297 },
    },
  ]

  beforeEach(() => {
    configureEmoteAssetBase(() => 'https://api.streampulse.stream')
  })

  it('findPeakEmoteMinuteFromRollups picks highest per-minute emote count', () => {
    const peak = findPeakEmoteMinuteFromRollups({
      rollups,
      streamStartedAt,
      topEmotesCatalog: catalog,
    })
    expect(peak?.emote.code).toBe('LOL')
    expect(peak?.emote.count).toBe(297)
    expect(peak?.offsetSeconds).toBe(10_560)
  })

  it('resolveRecapBurstHighlight ignores stale recap burst code when rollups disagree', () => {
    const highlight = resolveRecapBurstHighlight({
      burst: { offsetSeconds: 10_380, code: 'forsenPls', count: 4, provider: 'seventv' },
      rollups,
      streamStartedAt,
      topEmotesCatalog: catalog,
    })
    expect(highlight?.emote.code).toBe('LOL')
    expect(highlight?.emote.id).toBe('lol-id')
    expect(getEmoteImageUrl({
      provider: highlight?.emote.provider,
      id: highlight?.emote.id,
      imageUrl: highlight?.emote.imageUrl,
    })).toBeTruthy()
  })

  it('resolveBurstDisplayEmote matches catalog by name across providers', () => {
    const out = resolveBurstDisplayEmote(
      { code: 'LOL', count: 12, provider: 'twitch' },
      catalog,
    )
    expect(out.id).toBe('lol-id')
    expect(out.count).toBe(12)
  })
})
