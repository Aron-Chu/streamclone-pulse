import { describe, expect, it } from 'vitest'

import { enrichRecapEmoteFromCatalog, enrichRecapEmotesFromCatalog } from '../../../twitch-7tv-clone/packages/analytics-console/src/utils/recapEmoteEnrich.ts'

describe('recap emote catalog enrichment', () => {
  const catalog = [
    {
      key: 'seventv:ez-id:EZ',
      name: 'EZ',
      id: 'ez-id',
      provider: 'seventv',
      imageUrl: 'https://cdn.7tv.app/emote/01EZ/4x.webp',
      count: 24,
    },
    {
      key: 'seventv:clap-id:Clap',
      name: 'Clap',
      id: 'clap-id',
      provider: 'seventv',
      imageUrl: 'https://cdn.7tv.app/emote/01CLAP/4x.webp',
      count: 112,
    },
  ]

  it('joins recap rows to stream top emote catalog by code', () => {
    const out = enrichRecapEmoteFromCatalog({ code: 'EZ', count: 24, provider: 'seventv' }, catalog)
    expect(out.id).toBe('ez-id')
    expect(out.imageUrl).toContain('cdn.7tv.app')
    expect(out.count).toBe(24)
  })

  it('keeps recap rows that already have image metadata', () => {
    const existing = {
      code: 'Clap',
      count: 112,
      provider: 'seventv',
      id: 'keep-me',
      imageUrl: 'https://cdn.7tv.app/emote/01KEEP/4x.webp',
    }
    const out = enrichRecapEmoteFromCatalog(existing, catalog)
    expect(out.id).toBe('keep-me')
  })

  it('enriches burst and list rows in batch', () => {
    const out = enrichRecapEmotesFromCatalog(
      [
        { code: 'EZ', count: 24, provider: 'seventv' },
        { code: 'UNKNOWN', count: 2, provider: 'seventv' },
      ],
      catalog,
    )
    expect(out[0].id).toBe('ez-id')
    expect(out[1].id).toBeUndefined()
  })
})
