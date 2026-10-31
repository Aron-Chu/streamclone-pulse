import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail, GameSegment } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { HARNESS_STARTED_AT, harnessDetail, holdFrames, viewportOf, type HeldFrames } from './__fixtures__/sessionChartHarness.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

let frames: HeldFrames | null = null
afterEach(() => {
  cleanup()
  frames?.restore()
  frames = null
})

const game = (id: number, gameName: string, offsetSeconds: number, durationSeconds: number, source?: string): GameSegment => ({
  id,
  streamId: 'session-chart-harness',
  gameName,
  boxArtUrl: '',
  offsetSeconds,
  durationSeconds,
  createdAt: HARNESS_STARTED_AT,
  source,
})

// 210 measured minutes (data ends at 3:30:00). Balatro is the stale-record case:
// the games API runs it on for ~35 h past the data.
const GAMES = [game(1, 'Just Chatting', 0, 3_600), game(2, 'Elden Ring', 3_600, 5_400), game(3, 'Balatro', 9_000, 125_000)]

function renderChart(detail: AnalyticsStreamDetail, games: GameSegment[] | undefined, extra: Partial<Parameters<typeof AnalyticsChart>[0]> = {}) {
  frames = holdFrames(act)
  const view = render(
    <AnalyticsChart
      detail={detail}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
      games={games}
      viewerCaption={{ peak: 200, avg: 120 }}
      {...extra}
    />,
  )
  frames.flush()
  return view
}

const poster = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLElement>('[data-games-played-item]')].find(el => el.getAttribute('aria-label')?.startsWith(name))!

describe('Games played posters zoom the chart (candidate, 10-30, GP1)', () => {
  it('a poster click zooms to the game like its band segment, and pins the poster', () => {
    const { container } = renderChart(harnessDetail(210), GAMES)
    fireEvent.click(poster(container, 'Elden Ring'))
    frames!.flush()
    // Elden Ring runs 01:00:00 to 02:30:00, the band click's range.
    expect(viewportOf(container)).toEqual([3_600, 8_940])
    expect(poster(container, 'Elden Ring').getAttribute('aria-pressed')).toBe('true')
    // The hovered or pinned poster outlines its band segment.
    expect(screen.getByRole('button', { name: /^Elden Ring, zoom to this segment/ }).hasAttribute('data-active')).toBe(true)
  })

  it('a second click unpins without moving the view', () => {
    const { container } = renderChart(harnessDetail(210), GAMES)
    fireEvent.click(poster(container, 'Elden Ring'))
    frames!.flush()
    fireEvent.click(poster(container, 'Elden Ring'))
    frames!.flush()
    expect(viewportOf(container)).toEqual([3_600, 8_940])
    expect(poster(container, 'Elden Ring').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Data end on the posters and the band (fix, 10-30, GP-3)', () => {
  it('gives the game that runs past the data an open end and marks the data end on the band', () => {
    const { container } = renderChart(harnessDetail(210), GAMES)
    const runTimes = [...container.querySelectorAll<HTMLElement>('[data-games-played-run-time]')]
    expect(runTimes.map(el => el.textContent)).toEqual(['1h 0m', '1h 30m', '1h 0m+'])
    expect(runTimes[2]!.getAttribute('title')).toBe('Data ends at 3:30:00; the games list runs past it.')

    const bands = [...container.querySelectorAll<HTMLElement>('[data-session-band]')]
    const balatro = bands.find(el => el.getAttribute('aria-label')?.startsWith('Balatro'))!
    expect(balatro.getAttribute('aria-label')).toBe('Balatro (data ends here), zoom to this segment')
    expect(balatro.hasAttribute('data-open-end')).toBe(true)
    // The end is on screen at full range, so the marker shows.
    expect(balatro.hasAttribute('data-end-visible')).toBe(true)
    expect(balatro.querySelector('[data-session-band-end]')?.textContent).toBe('Data ends')
    // Games that ended inside the data are unchanged.
    expect(bands.filter(el => el.hasAttribute('data-open-end'))).toHaveLength(1)
  })

  it('hides the band marker when the data end is zoomed off screen', () => {
    const { container } = renderChart(harnessDetail(210), GAMES)
    fireEvent.click(screen.getByRole('button', { name: 'Elden Ring, zoom to this segment' }))
    frames!.flush()
    const balatro = [...container.querySelectorAll<HTMLElement>('[data-session-band]')]
      .find(el => el.getAttribute('aria-label')?.startsWith('Balatro'))!
    expect(balatro.hasAttribute('data-end-visible')).toBe(false)
  })
})

describe('Games played without chart minutes (fix, 10-30, GP-6)', () => {
  const noMinutes = (stream: Record<string, unknown> = {}, state = 'historical') => ({
    state,
    stream: { streamId: 'no-minutes', startedAt: HARNESS_STARTED_AT, ...stream },
    rollups: [],
    topEmotes: [],
    sources: [],
  }) as unknown as AnalyticsStreamDetail

  const listRows = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[data-games-played-list-item]')].map(row => row.textContent)

  const SNAPSHOT_GAMES = [game(1, 'Just Chatting', 0, 13_273, 'snapshot'), game(2, 'Gakuen iDOLM@STER', 13_273, 153_394, 'snapshot')]

  it('lists the games in the no-minutes state; with no recorded end the last game shows its start, not a length', () => {
    const { container } = renderChart(noMinutes(), SNAPSHOT_GAMES)
    expect(container.textContent).toContain('No minute data')
    expect(screen.getByLabelText('Games played').hasAttribute('data-games-played-list')).toBe(true)
    expect(listRows(container)).toEqual(['Just Chatting≈3h 41m', 'Gakuen iDOLM@STERfrom 3:41:13'])
    const times = [...container.querySelectorAll<HTMLElement>('[data-games-played-list-time]')]
    expect(times[1]!.getAttribute('title')).toBe('No end recorded yet. Estimated from the stream category.')
    // Never the 42 h length the open record reports.
    expect(container.textContent).not.toMatch(/42h/)
  })

  it('shows the last length once the stream has a recorded end', () => {
    const { container } = renderChart(
      noMinutes({ endedAt: '2026-07-31T06:00:00.000Z' }),
      [game(1, 'Just Chatting', 0, 3_600, 'stored'), game(2, 'Minecraft', 3_600, 1_800, 'stored')],
    )
    expect(listRows(container)).toEqual(['Just Chatting1h 0m', 'Minecraft30m'])
  })

  it('lists the games while the chart is syncing', () => {
    const { container } = renderChart(noMinutes({}, 'syncing'), SNAPSHOT_GAMES)
    expect(container.textContent).toContain('Syncing chart data')
    expect(listRows(container)).toHaveLength(2)
  })

  it('lists the games while the chart loads', () => {
    const { container } = renderChart(undefined as unknown as AnalyticsStreamDetail, SNAPSHOT_GAMES, { loading: true })
    expect(container.textContent).toContain('Loading chart data')
    // No stream record yet, so no end is known.
    expect(listRows(container)).toEqual(['Just Chatting≈3h 41m', 'Gakuen iDOLM@STERfrom 3:41:13'])
  })

  it('adds nothing without games', () => {
    const { container } = renderChart(noMinutes(), [])
    expect(container.querySelector('[data-games-played-list]')).toBeNull()
  })
})
