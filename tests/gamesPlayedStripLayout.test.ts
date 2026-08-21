import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GamesPlayedStrip, GAMES_PLAYED_CHIP_MIN_WIDTH_PX } from '../src/ui/GamesPlayedStrip.tsx'

describe('GamesPlayedStrip equal chips', () => {
  it('keeps a readable minimum chip width for short late games', () => {
    expect(GAMES_PLAYED_CHIP_MIN_WIDTH_PX).toBeGreaterThanOrEqual(96)
  })

  it('renders normalized Twitch box art and keeps category identity available', () => {
    const html = renderToStaticMarkup(createElement(GamesPlayedStrip, {
      durationSeconds: 1200,
      games: [
        {
          gameName: 'Just Chatting',
          categoryId: '509658',
          boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg',
          offsetSeconds: 0,
          durationSeconds: 600,
        },
        {
          gameName: 'VALORANT',
          categoryId: '516575',
          offsetSeconds: 600,
          durationSeconds: 600,
        },
      ],
    }))

    expect(html).toContain('data-game-art="true"')
    expect(html).toContain('ttv-boxart/509658-144x192.jpg')
    expect(html).toContain('ttv-boxart/516575-144x192.jpg')
  })
})
