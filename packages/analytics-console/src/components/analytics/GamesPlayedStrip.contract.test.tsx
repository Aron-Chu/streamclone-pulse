// @vitest-environment jsdom

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

  // (candidate, 10-30) GP1: the name and run time under each poster are visible
  // lines a screen reader reads too (they were aria-hidden, the name title-only).
  it('headerless (session chart): no header, every game on the rail, each poster with its name and run time', () => {
    const { container } = render(
      <GamesPlayedStrip
        games={games}
        durationSeconds={1800}
        visibleRange={{ startOffset: 0, endOffset: 900 }}
        headerless
      />,
    )
    expect(container.querySelector('[data-games-played-header]')).toBeNull()
    expect(screen.queryByText('Games played')).toBeNull()
    expect(screen.queryByRole('button', { name: /Show all/i })).toBeNull()
    expect(screen.getByLabelText('Games played')).not.toBeNull()
    expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Game A/),
      expect.stringMatching(/^Game B/),
      expect.stringMatching(/^Game C/),
    ])
    const runTimes = [...container.querySelectorAll('[data-games-played-run-time]')]
    expect(runTimes.map(el => el.textContent)).toEqual(['10m', '10m', '10m'])
    expect(runTimes.some(el => el.closest('[aria-hidden="true"]'))).toBe(false)
    const names = [...container.querySelectorAll('[data-games-played-name]')]
    expect(names.map(el => el.textContent)).toEqual(['Game A', 'Game B', 'Game C'])
    expect(names.some(el => el.closest('[aria-hidden="true"]'))).toBe(false)
    // One line each, the name cut with an ellipsis (sp-session-chart.css .ssc-gp-name).
    expect(names.every(el => el.classList.contains('ssc-gp-name'))).toBe(true)
    expect(runTimes.every(el => el.classList.contains('ssc-gp-rt'))).toBe(true)
  })

  it('headerless items size to the name, up to 96 px, so a long name does not run under the next poster', () => {
    render(
      <GamesPlayedStrip
        games={[{ gameName: 'Call of Duty: Black Ops II', offsetSeconds: 0, durationSeconds: 600 }]}
        durationSeconds={600}
        headerless
      />,
    )
    const item = screen.getByRole('listitem')
    expect(item.style.flex).toBe('0 0 auto')
    expect(item.style.minWidth).toBe('52px')
    expect(item.style.maxWidth).toBe('96px')
  })

  it('headerless run times round to the minute and stop at the timeline end, like session-original fdm', () => {
    const { container } = render(
      <GamesPlayedStrip
        games={[
          { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 2_430 },
          // The games API's last segment can run past the data (a stale live record).
          { gameName: 'Grand Theft Auto V', offsetSeconds: 2_430, durationSeconds: 125_000 },
        ]}
        durationSeconds={38_130}
        headerless
      />,
    )
    const runTimes = [...container.querySelectorAll('[data-games-played-run-time]')].map(el => el.textContent)
    // 40.5 min rounds up; 35,700 s is 9h 55m.
    expect(runTimes).toEqual(['41m', '9h 55m'])
    expect(screen.getByRole('listitem', { name: /^Grand Theft Auto V/ }).getAttribute('aria-label'))
      .toBe('Grand Theft Auto V · 00:40:30–10:35:30 · 9h 55m')
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

  it('marks the details parts so the wide layout can put the name and the window on separate lines', () => {
    render(<GamesPlayedStrip games={artAndRepeatFixture} durationSeconds={1200} visibleRange={null} />)

    fireEvent.click(screen.getByRole('button', { name: /Minecraft/i }))
    const details = document.querySelector('[data-games-played-details]')
    const name = details?.querySelector('[data-games-played-details-name]')
    const separator = details?.querySelector('[data-games-played-details-sep]')
    expect(name?.textContent).toBe('Minecraft')
    expect(separator?.getAttribute('aria-hidden')).toBe('true')
    // The name comes first; the window and the pinned mark follow it.
    expect(details?.firstElementChild).toBe(name)
    expect(details?.lastElementChild?.textContent).toMatch(/pinned/i)
  })
})
