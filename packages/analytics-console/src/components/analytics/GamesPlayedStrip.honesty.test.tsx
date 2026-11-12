// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChartGameSegment } from '@streampulse/pulse-charts'
import { GamesPlayedStrip, gamesOpenAtDataEnd, isEstimatedGameSource } from './GamesPlayedStrip.tsx'

afterEach(() => cleanup())

// /games for 316705728883 on 10-30 07:19Z (evidence/past-games.json, trimmed): the
// tracker never closed the stream, so Gakuen runs to the request (42 h 36 m).
const PAST_GAMES: ChartGameSegment[] = [
  { gameName: 'Just Chatting', categoryId: '509658', offsetSeconds: 0, durationSeconds: 13_273, source: 'snapshot' },
  { gameName: 'Gakuen iDOLM@STER', categoryId: '1419480843', offsetSeconds: 13_273, durationSeconds: 153_394, source: 'snapshot' },
]
// The newest measured minute ends at 6:35:49.
const DATA_END = 23_749

const runTimes = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-games-played-run-time]')]

describe('Games played run times past the data end (fix, 10-30, GP-3)', () => {
  it('gives the game the API runs past the data an open end, with the data end in its title', () => {
    const { container } = render(
      <GamesPlayedStrip games={PAST_GAMES} durationSeconds={DATA_END} dataEndSeconds={DATA_END} headerless />,
    )
    const [chatting, gakuen] = runTimes(container)
    // 10,476 s rounds to 2h 55m; the "+" says the length is not known.
    expect(gakuen!.textContent).toBe('≈2h 55m+')
    expect(gakuen!.getAttribute('title')).toBe('Data ends at 6:35:49; the games list runs past it. Estimated from the stream category.')
    // A game that ended before the data end keeps a plain length.
    expect(chatting!.textContent).toBe('≈3h 41m')
    expect(chatting!.getAttribute('title')).toBe('Estimated from the stream category.')
    expect(screen.getByRole('listitem', { name: /^Gakuen/ }).getAttribute('aria-label'))
      .toBe('Gakuen iDOLM@STER · 03:41:13–06:35:49 · about 2h 55m+ · Data ends at 6:35:49; the games list runs past it. Estimated from the stream category.')
  })

  it('reads a game that ends within two minutes of the data end as ended (the live poll runs to now)', () => {
    // evidence/live-games.json: one segment to the request time, 13 s past the newest minute.
    const live: ChartGameSegment[] = [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 10_747, source: 'snapshot' }]
    expect(gamesOpenAtDataEnd(live, 10_734).size).toBe(0)
    expect(gamesOpenAtDataEnd(PAST_GAMES, DATA_END)).toEqual(new Set(['gakuen idolm@ster:13273']))
    const { container } = render(<GamesPlayedStrip games={live} durationSeconds={10_734} dataEndSeconds={10_734} headerless />)
    expect(runTimes(container).map(el => el.textContent)).toEqual(['≈2h 59m'])
  })

  it('without a data end nothing is open', () => {
    const { container } = render(<GamesPlayedStrip games={PAST_GAMES} durationSeconds={DATA_END} headerless />)
    expect(runTimes(container).map(el => el.textContent)).toEqual(['≈3h 41m', '≈2h 55m'])
  })
})

describe('Estimated game switches (fix, 10-30, GP-7)', () => {
  it('marks category_fallback and snapshot segments as estimates, and stored ones as not', () => {
    expect(isEstimatedGameSource('category_fallback')).toBe(true)
    expect(isEstimatedGameSource('snapshot')).toBe(true)
    expect(isEstimatedGameSource('stored')).toBe(false)
    expect(isEstimatedGameSource(undefined)).toBe(false)
  })

  it('prefixes an estimated run time with ≈ and titles it; a stored one stays plain', () => {
    const { container } = render(
      <GamesPlayedStrip
        games={[
          { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1_800, source: 'category_fallback' },
          { gameName: 'Minecraft', offsetSeconds: 1_800, durationSeconds: 1_800, source: 'stored' },
        ]}
        durationSeconds={3_600}
        headerless
      />,
    )
    const [fallback, stored] = runTimes(container)
    expect(fallback!.textContent).toBe('≈30m')
    expect(fallback!.getAttribute('title')).toBe('Estimated from the stream category.')
    expect(stored!.textContent).toBe('30m')
    expect(stored!.hasAttribute('title')).toBe(false)
  })
})
