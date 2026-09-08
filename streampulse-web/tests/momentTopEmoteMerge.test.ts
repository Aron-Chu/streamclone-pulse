import { describe, expect, it } from 'vitest'
import { mergeMomentTopEmotes } from '../src/routes/analytics/AnalyticsMomentsPage'

describe('mergeMomentTopEmotes', () => {
  it('enriches matching saved emotes without replacing their measured counts', () => {
    const merged = mergeMomentTopEmotes(
      [{ name: 'KEKW', provider: '7tv', count: 81 }],
      [{ name: 'KEKW', provider: 'seventv', id: '01ABC', count: 99, imageUrl: 'https://cdn.7tv.app/emote/01ABC/2x.webp' }],
    )
    expect(merged).toEqual([{
      name: 'KEKW', provider: '7tv', id: '01ABC', count: 81,
      imageUrl: 'https://cdn.7tv.app/emote/01ABC/2x.webp',
    }])
  })

  it('does not append unmatched recap reactions to an exact saved detection', () => {
    expect(mergeMomentTopEmotes(
      [{ name: 'KEKW', provider: 'seventv', count: 81 }],
      [{ name: 'OMEGALUL', provider: 'seventv', id: '01OTHER', imageUrl: 'https://cdn.7tv.app/emote/01OTHER/2x.webp' }],
    )).toEqual([{ name: 'KEKW', provider: 'seventv', count: 81 }])
  })
})
