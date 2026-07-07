import { describe, expect, it } from 'vitest'
import type { ExtensionEmote, PulseRecapEmote } from '../src/shared/messages.ts'
import { recapEmoteToExtensionEmote, resolveRecapEmotes, buildRecapEmoteCatalog } from '../src/ui/recapEmotes.ts'

describe('recapEmoteToExtensionEmote', () => {
  it('maps recap fields to extension emote shape', () => {
    const emote: PulseRecapEmote = {
      code: 'KEKW',
      count: 42,
      provider: 'seventv',
      id: 'abc',
      imageUrl: 'https://cdn.example/kekw.webp',
    }
    expect(recapEmoteToExtensionEmote(emote)).toEqual({
      id: 'abc',
      name: 'KEKW',
      imageUrl: 'https://cdn.example/kekw.webp',
      count: 42,
      provider: 'seventv',
    })
  })
})

describe('resolveRecapEmotes', () => {
  const catalog: ExtensionEmote[] = [
    {
      id: 'cat-1',
      name: 'lol',
      imageUrl: 'https://cdn.example/lol.webp',
      count: 99,
      provider: 'seventv',
    },
  ]

  it('prefers backend id and imageUrl when present', () => {
    const resolved = resolveRecapEmotes([
      { code: 'KEKW', count: 10, id: 'direct', imageUrl: 'https://cdn.example/kekw.webp' },
    ])
    expect(resolved[0]?.id).toBe('direct')
    expect(resolved[0]?.imageUrl).toBe('https://cdn.example/kekw.webp')
  })

  it('joins catalog by case-insensitive code when image metadata is missing', () => {
    const resolved = resolveRecapEmotes([{ code: 'LOL', count: 12, provider: 'seventv' }], catalog)
    expect(resolved[0]).toMatchObject({
      name: 'LOL',
      count: 12,
      id: 'cat-1',
      imageUrl: 'https://cdn.example/lol.webp',
      provider: 'seventv',
    })
  })

  it('keeps code-only emotes when catalog has no match', () => {
    const resolved = resolveRecapEmotes([{ code: 'UNKNOWN', count: 3 }], catalog)
    expect(resolved[0]).toEqual({
      name: 'UNKNOWN',
      count: 3,
      id: undefined,
      imageUrl: undefined,
      provider: undefined,
    })
  })

  it('preserves recap count over catalog count', () => {
    const resolved = resolveRecapEmotes([{ code: 'lol', count: 5 }], catalog)
    expect(resolved[0]?.count).toBe(5)
  })
})

describe('buildRecapEmoteCatalog', () => {
  it('merges payload top emotes and rollup emotes', () => {
    const catalog = buildRecapEmoteCatalog({
      login: 'xqc',
      isLive: false,
      tracking: true,
      currentOffsetSeconds: 120,
      rollups: [
        {
          offsetSeconds: 60,
          chatCount: 10,
          topEmotes: [{ name: 'KEKW', id: 'rollup-id', imageUrl: 'https://cdn/kekw.webp', count: 3 }],
        },
      ],
      lanes: { composite: [], chat: [], seventv: [] },
      recap: null,
      topEmotes: [{ name: 'LUL', id: 'top-id', imageUrl: 'https://cdn/lul.webp', count: 9 }],
    })
    const names = catalog.map(emote => emote.name).sort()
    expect(names).toEqual(['KEKW', 'LUL'])
  })
})
