import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkMoment } from '../src/lib/momentsChecked'
import type { MomentsFeedCategoryFacet, MomentsFeedItem } from '../src/lib/momentsFeed'
import { momentsGameArt, momentsGameLabel, momentsGames } from '../src/lib/momentsGames'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const pool = fixture.items.map(item => checkMoment(item, fixture.generatedAt))
const art = (id: string, size = '144x192') => `https://static-cdn.jtvnw.net/ttv-boxart/${id}-${size}.jpg`

describe('Moments Games tab (B2)', () => {
  it('counts the moments Latest shows for each game, busiest first, then by name', () => {
    const games = momentsGames(pool, null)
    expect(games.slice(0, 5).map(g => [g.name, g.moments])).toEqual([
      ['Overwatch', 6], ['Minecraft', 5], ['Grand Theft Auto V', 4], ['IRL', 3], ['Just Chatting', 3],
    ])
    // the moments that don't hold up aren't counted: a game with only those has no card
    expect(games.map(g => g.name)).not.toContain('Counter-Strike')
    expect(games.reduce((n, g) => n + g.moments, 0)).toBe(fixture.items.filter(item => item.category && item.verdict !== 'bad').length)
    // a big card's cover, and none for a game Twitch sent none for
    expect(games[0]).toMatchObject({ id: '515025', art: art('515025', '285x380'), live: null })
    expect(games.find(g => g.name === 'Slots')?.art).toBeNull()
  })

  it('takes each game’s live channels and cover from the feed’s facets', () => {
    const facets: MomentsFeedCategoryFacet[] = [
      { id: '515025', name: 'Overwatch', boxArtUrl: art('515025', '52x72'), moments: 8, liveChannels: 41 },
      { id: '27471', name: 'Minecraft', moments: 6, liveChannels: 0 },
    ]
    const games = momentsGames(pool, facets)
    // the count stays the list's (8 in the facet counts the ones that don't hold up)
    expect(games[0]).toMatchObject({ name: 'Overwatch', moments: 6, live: 41, art: art('515025', '285x380') })
    expect(games[1]).toMatchObject({ name: 'Minecraft', live: 0, art: art('27471', '285x380') })
    expect(games.find(g => g.name === 'IRL')?.live).toBeNull()
  })

  it('takes only a Twitch cover for that same game', () => {
    expect(momentsGameArt(art('515025'), '515025')).toBe(art('515025', '285x380'))
    expect(momentsGameArt(art('515025'), '27471')).toBeNull()
    expect(momentsGameArt('https://example.com/ttv-boxart/515025-144x192.jpg', '515025')).toBeNull()
    expect(momentsGameArt(undefined, '515025')).toBeNull()
  })

  it('names the picked game from the moments held, or the facets alone', () => {
    expect(momentsGameLabel('515025', pool, null)).toEqual({ name: 'Overwatch', art: art('515025', '285x380') })
    // a game no moment held here has: the facets name it
    const facets: MomentsFeedCategoryFacet[] = [{ id: '516575', name: 'VALORANT', moments: 1, liveChannels: 3 }]
    expect(momentsGameLabel('516575', pool, facets)).toEqual({ name: 'VALORANT', art: null })
    expect(momentsGameLabel('1', pool, facets)).toBeNull()
  })
})
