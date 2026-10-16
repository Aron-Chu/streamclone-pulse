import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameSegment } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { HARNESS_STARTED_AT, harnessDetail, holdFrames, viewportOf, type HeldFrames } from './__fixtures__/sessionChartHarness.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

let frames: HeldFrames | null = null
afterEach(() => {
  cleanup()
  frames?.restore()
  frames = null
})

const game = (id: number, gameName: string, offsetSeconds: number, durationSeconds: number): GameSegment => ({
  id,
  streamId: 'session-chart-harness',
  gameName,
  boxArtUrl: '',
  offsetSeconds,
  durationSeconds,
  createdAt: HARNESS_STARTED_AT,
})

// 210 minutes: Just Chatting for the first hour, then two games.
const GAMES = [game(1, 'Just Chatting', 0, 3_600), game(2, 'Elden Ring', 3_600, 5_400), game(3, 'Balatro', 9_000, 3_600)]

function renderBand(games: GameSegment[] | undefined) {
  frames = holdFrames(act)
  const view = render(
    <AnalyticsChart
      detail={harnessDetail(210)}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
      games={games}
      viewerCaption={{ peak: 200, avg: 120 }}
    />,
  )
  frames.flush()
  return view
}

const bandSegments = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-session-band]')]

describe('SessionSpChart category band', () => {
  it('draws one text-only segment per game in the 22 px band row', () => {
    const { container } = renderBand(GAMES)
    const segments = bandSegments(container)
    expect(segments.map(el => el.textContent)).toEqual(['Just Chatting', 'Elden Ring', 'Balatro'])
    expect(segments.map(el => el.getAttribute('aria-label'))).toEqual([
      'Just Chatting, zoom to this segment',
      'Elden Ring, zoom to this segment',
      'Balatro, zoom to this segment',
    ])
    // Text only: no box art, icons or emotes in the band.
    for (const el of segments) expect(el.querySelector('img, svg, picture')).toBeNull()
    // Left to right in time, never overlapping.
    const lefts = segments.map(el => Number(/translateX\(([\d.-]+)px\)/.exec(el.style.transform)?.[1]))
    const widths = segments.map(el => parseFloat(el.style.width))
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts)
    for (let i = 1; i < lefts.length; i += 1) expect(lefts[i]!).toBeGreaterThanOrEqual(lefts[i - 1]! + widths[i - 1]! - 0.5)
    expect(performance.getEntriesByName('sp:games-ready', 'mark').length).toBeGreaterThan(0)
  })

  it('keeps the band row reserved with no games, so the plot never shifts when they arrive', () => {
    const { container, rerender } = renderBand(undefined)
    expect(bandSegments(container)).toHaveLength(0)
    // lanes under the 22 px band: viewers 22-159, chat 167-304 (lane captions sit 1 px into each lane)
    const chatTop = container.querySelector<HTMLElement>('[data-chart-lane-caption="chat"]')!.style.top
    const viewersTop = container.querySelector<HTMLElement>('[data-chart-lane-caption="viewers"]')!.style.top
    expect([viewersTop, chatTop]).toEqual(['23px', '168px'])
    rerender(
      <AnalyticsChart
        detail={harnessDetail(210)}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={null}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        games={GAMES}
        viewerCaption={{ peak: 200, avg: 120 }}
      />,
    )
    frames!.flush()
    expect(bandSegments(container)).toHaveLength(3)
    expect(container.querySelector<HTMLElement>('[data-chart-lane-caption="chat"]')!.style.top).toBe(chatTop)
    expect(container.querySelector<HTMLElement>('[data-chart-lane-caption="viewers"]')!.style.top).toBe(viewersTop)
  })

  it('zooms to a segment on click', () => {
    const { container } = renderBand(GAMES)
    fireEvent.click(screen.getByRole('button', { name: 'Elden Ring, zoom to this segment' }))
    frames!.flush()
    // Elden Ring runs 01:00:00 to 02:30:00.
    const [start, end] = viewportOf(container)
    expect(start).toBe(3_600)
    expect(end).toBe(8_940)
  })

  it('lights the Games played row from the band, and the band from the Games played row', () => {
    const { container } = renderBand(GAMES)
    const segment = screen.getByRole('button', { name: 'Elden Ring, zoom to this segment' })
    fireEvent.pointerEnter(segment)
    expect(segment.hasAttribute('data-active')).toBe(true)
    const stripItem = [...container.querySelectorAll<HTMLElement>('[data-games-played-item]')]
      .find(el => el.getAttribute('aria-label')?.startsWith('Elden Ring'))!
    // headerless Games played posters (ssc-gp-b) light with data-hl
    expect(stripItem.hasAttribute('data-hl')).toBe(true)
    fireEvent.pointerLeave(segment)
    expect(segment.hasAttribute('data-active')).toBe(false)

    const other = [...container.querySelectorAll<HTMLElement>('[data-games-played-item]')]
      .find(el => el.getAttribute('aria-label')?.startsWith('Balatro'))!
    fireEvent.mouseEnter(other)
    expect(screen.getByRole('button', { name: 'Balatro, zoom to this segment' }).hasAttribute('data-active')).toBe(true)
    // Outside the hovered game's span the plot dims.
    expect(container.querySelector('.spc-hl-dim')).not.toBeNull()
  })
})
