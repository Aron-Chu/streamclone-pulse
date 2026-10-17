/**
 * The Moments list keeps the strip's ranking (utils/sessionStripMoments.ts, so
 * chart pin N is row N) through the d3-v2 row port (2026-10-15). The HTML
 * golden of the old list is retired; what must not drift is each row's order,
 * offset, rank, reason and backend score.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recapMomentAnalyticalOffset } from '@streampulse/pulse-core'
import { SessionRecapMomentsStrip } from './SessionRecapMomentsStrip.tsx'
import {
  sessionStripMoments,
  setStripPinHover,
  stripHasReactionCoverage,
} from '../../utils/sessionStripMoments.ts'
import { STRIP_HEATMAP, STRIP_RECAP, STRIP_ROLLUPS, STRIP_STARTED_AT, STRIP_TOP_EMOTES } from './__fixtures__/sessionStripFixture.ts'

const props = () => ({
  recap: STRIP_RECAP,
  streamStartedAt: STRIP_STARTED_AT,
  onSelectOffset: vi.fn(),
  onPreviewOffset: vi.fn(),
  layout: 'rightRail' as const,
  rollups: STRIP_ROLLUPS,
  heatmapPoints: STRIP_HEATMAP,
  topEmotesCatalog: STRIP_TOP_EMOTES,
})

/** rank, offset label, reason, score: the strip fixture's seven moments in strip order. */
const GOLDEN = [
  { rank: 1, offset: 4518, label: '1:15:18', reason: 'Emote spike', score: '94' },
  { rank: 2, offset: 8960, label: '2:29:20', reason: 'Chat spike', score: '81' },
  { rank: 3, offset: 9720, label: '2:42:00', reason: 'Emote spike', score: '77' },
  { rank: 4, offset: 7200, label: '2:00:00', reason: 'Viewer surge', score: '70' },
  { rank: 5, offset: 5300, label: '1:28:20', reason: 'Emote spike', score: '66' },
  { rank: 6, offset: 5390, label: '1:29:50', reason: 'Chat spike', score: '52' },
  { rank: 7, offset: 1200, label: '0:20:00', reason: 'Chat spike', score: '41' },
]

function readRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-moment-row]')).map((row) => ({
    rank: Number(row.getAttribute('data-moment-rank')),
    offset: Number(row.getAttribute('data-moment-offset')),
    label: row.querySelector('.ssr-off')?.textContent,
    reason: row.querySelector('.ssr-why')?.textContent,
    score: row.querySelector('.ssr-sc b')?.textContent,
  }))
}

afterEach(() => {
  setStripPinHover(null)
  cleanup()
})

describe('SessionRecapMomentsStrip ranking golden', () => {
  it('rows follow the shared strip ranking (pin N is row N)', () => {
    const shared = sessionStripMoments({
      recap: STRIP_RECAP,
      hasReactionCoverage: stripHasReactionCoverage(STRIP_RECAP),
      heatmapPoints: STRIP_HEATMAP,
      streamStartedAt: STRIP_STARTED_AT,
      topEmotesCatalog: STRIP_TOP_EMOTES,
    }).map(recapMomentAnalyticalOffset)
    expect(shared).toEqual(GOLDEN.map((row) => row.offset))
  })

  it('shows the first three rows collapsed, in order, with backend reason and score', () => {
    const { container } = render(<SessionRecapMomentsStrip {...props()} />)
    expect(readRows(container)).toEqual(GOLDEN.slice(0, 3))
    expect(screen.getByRole('button', { name: 'Show 4 more moments' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('shows every row when expanded, and the footer folds them back', () => {
    const { container } = render(<SessionRecapMomentsStrip {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 4 more moments' }))
    expect(readRows(container)).toEqual(GOLDEN)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer moments' }))
    expect(readRows(container)).toEqual(GOLDEN.slice(0, 3))
  })

  it('rings the moment the chart selection holds', () => {
    const { container } = render(<SessionRecapMomentsStrip {...props()} selectedOffsetSeconds={8960} />)
    const pressed = container.querySelectorAll('[data-moment-row][aria-pressed="true"]')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.getAttribute('data-moment-rank')).toBe('2')
  })

  it('ghosts the row of a hovered chart pin and lets go after', () => {
    const { container } = render(<SessionRecapMomentsStrip {...props()} />)
    const rank2 = () => container.querySelector('[data-moment-rank="2"]')!
    expect(rank2().classList.contains('ghost')).toBe(false)
    act(() => setStripPinHover(8960))
    expect(rank2().classList.contains('ghost')).toBe(true)
    act(() => setStripPinHover(null))
    expect(rank2().classList.contains('ghost')).toBe(false)
  })
})
