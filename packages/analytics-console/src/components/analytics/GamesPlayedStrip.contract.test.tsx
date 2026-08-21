import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChartGameSegment } from '@streampulse/pulse-charts'
import { GAMES_PLAYED_ART_WIDTH_PX, GAMES_PLAYED_ICON_SIZE_PX, GamesPlayedStrip, gameArtCandidates, initialsForGame, resolveGameArtUrl, safeGameArtUrl } from './GamesPlayedStrip.tsx'

const games: ChartGameSegment[] = [
  { gameName: 'Game A', offsetSeconds: 0, durationSeconds: 600 },
  { gameName: 'Game B', offsetSeconds: 600, durationSeconds: 600 },
  { gameName: 'Game C', offsetSeconds: 1200, durationSeconds: 600 },
]

const artAndRepeatFixture: ChartGameSegment[] = [
  {
    id: 'jc-first',
    gameName: 'Just Chatting',
    boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg',
    offsetSeconds: 0,
    durationSeconds: 300,
  },
  {
    id: 'minecraft',
    gameName: 'Minecraft',
    boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/27471-52x72.jpg',
    offsetSeconds: 300,
    durationSeconds: 300,
  },
  {
    id: 'jc-repeat',
    gameName: 'Just Chatting',
    categoryId: '509658',
    offsetSeconds: 600,
    durationSeconds: 300,
  },
  {
    id: 'unsafe-art',
    gameName: 'VALORANT',
    boxArtUrl: 'http://not-twitch.example/valorant.png',
    offsetSeconds: 900,
    durationSeconds: 300,
  },
]

afterEach(() => {
  cleanup()
})

describe('GamesPlayedStrip live versus offline contract', () => {
  it('is range-aware and expandable for a live visible range', () => {
    render(
      <GamesPlayedStrip
        games={games}
        durationSeconds={1800}
        visibleRange={{ startOffset: 0, endOffset: 900 }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Show all 3' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listitem', { name: /Game C/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show all 3' }))
    expect(screen.getByRole('button', { name: 'Chart window' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('listitem', { name: /Game C/i })).not.toBeNull()
  })

  it('is fully expanded with no range toggle for VOD/offline visibleRange=null', () => {
    render(
      <GamesPlayedStrip
        games={games}
        durationSeconds={1800}
        visibleRange={null}
      />,
    )

    expect(screen.getByRole('listitem', { name: /Game A/i })).not.toBeNull()
    expect(screen.getByRole('listitem', { name: /Game B/i })).not.toBeNull()
    expect(screen.getByRole('listitem', { name: /Game C/i })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Show all/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Chart window' })).toBeNull()
  })

  it('preserves repeated games and renders art with deterministic safe fallbacks', () => {
    expect(GAMES_PLAYED_ART_WIDTH_PX / GAMES_PLAYED_ICON_SIZE_PX).toBeCloseTo(52 / 72, 1)
    render(
      <GamesPlayedStrip
        games={artAndRepeatFixture}
        durationSeconds={1200}
        visibleRange={null}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items.map(item => item.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('Just Chatting'),
      expect.stringContaining('Minecraft'),
      expect.stringContaining('Just Chatting'),
      expect.stringContaining('VALORANT'),
    ])

    const firstArt = screen.getByRole('button', { name: /Just Chatting.*00:00:00/i }).querySelector('img')
    const minecraftArt = screen.getByRole('button', { name: /Minecraft/i }).querySelector('img')
    expect(firstArt?.getAttribute('src')).toContain('static-cdn.jtvnw.net')
    expect(minecraftArt?.getAttribute('src')).toContain('static-cdn.jtvnw.net')
    expect(screen.getByRole('button', { name: /Just Chatting.*00:10:00/i }).querySelector('img')?.getAttribute('src')).toContain('509658-144x192.jpg')
    expect(screen.getByRole('button', { name: /VALORANT/i }).querySelector('img')?.getAttribute('src'))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/VALORANT-144x192.jpg')

    expect(safeGameArtUrl('https://static-cdn.jtvnw.net/ttv-boxart/test.jpg')).toContain('static-cdn.jtvnw.net')
    expect(safeGameArtUrl('http://not-twitch.example/valorant.png')).toBeNull()
    expect(initialsForGame('Just Chatting')).toBe('JC')
    expect(gameArtCandidates(undefined, '123')).toEqual([
      'https://static-cdn.jtvnw.net/ttv-boxart/123-144x192.jpg',
      'https://static-cdn.jtvnw.net/ttv-boxart/123_IGDB-144x192.jpg',
    ])
    expect(resolveGameArtUrl(undefined, '676802825')).toContain('_IGDB-')
    expect(gameArtCandidates('', undefined, 'Call of Duty: Black Ops II')).toEqual([
      'https://static-cdn.jtvnw.net/ttv-boxart/Call%20of%20Duty%3A%20Black%20Ops%20II-144x192.jpg',
      'https://static-cdn.jtvnw.net/ttv-boxart/Call%20of%20Duty%3A%20Black%20Ops%20II_IGDB-144x192.jpg',
    ])
  })

  it('shows lightweight time metadata when an icon is pinned', () => {
    render(<GamesPlayedStrip games={artAndRepeatFixture} durationSeconds={1200} visibleRange={null} />)

    fireEvent.click(screen.getByRole('button', { name: /Minecraft/i }))
    const details = document.querySelector('[data-games-played-details]')
    expect(details).not.toBeNull()
    expect(details?.textContent).toContain('Minecraft')
    expect(details?.textContent).toContain('00:05:00')
    expect(details?.textContent).toMatch(/pinned/i)
    expect(details?.querySelector('img')).toBeNull()
  })
})
