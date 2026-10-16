import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { recapMomentAnalyticalOffset } from '@streampulse/pulse-core'
import AnalyticsChart from './AnalyticsChart.tsx'
import { SESSION_PINS_TOP_PX } from './SessionChartPins.tsx'
import {
  getStripPinHover,
  sessionStripMoments,
  setStripPinHover,
  stripHasReactionCoverage,
} from '../../utils/sessionStripMoments.ts'
import {
  STRIP_HEATMAP,
  STRIP_RECAP,
  STRIP_ROLLUPS,
  STRIP_STARTED_AT,
  STRIP_TOP_EMOTES,
} from './__fixtures__/sessionStripFixture.ts'
import { harnessDetail, holdFrames, setStackWidth, showOnChart, viewportOf, type HeldFrames } from './__fixtures__/sessionChartHarness.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

let frames: HeldFrames | null = null
let restoreWidth: (() => void) | null = null
afterEach(() => {
  cleanup()
  frames?.restore()
  restoreWidth?.()
  frames = null
  restoreWidth = null
  setStripPinHover(null)
})

// The strip's own order: pin N must be strip row N.
const stripOffsets = sessionStripMoments({
  recap: STRIP_RECAP,
  hasReactionCoverage: stripHasReactionCoverage(STRIP_RECAP),
  heatmapPoints: STRIP_HEATMAP,
  streamStartedAt: STRIP_STARTED_AT,
  topEmotesCatalog: STRIP_TOP_EMOTES,
}).map(moment => recapMomentAnalyticalOffset(moment))

// 12 600 s = 210 measured minutes.
const detail = harnessDetail(210, { startedAt: STRIP_STARTED_AT })

type Props = ComponentProps<typeof AnalyticsChart>

function renderPins(width: number, overrides: Partial<Props> = {}, onSelectOffset = vi.fn(), moments = true) {
  restoreWidth = setStackWidth(width)
  frames = holdFrames(act)
  const props: Props = {
    detail,
    selectedEmotes: new Set(),
    onSelectEmote: vi.fn(),
    selectedRollup: null,
    onSelectRollup: vi.fn(),
    viewMode: 'overview',
    onViewModeChange: vi.fn(),
    stripPins: {
      recap: STRIP_RECAP,
      streamStartedAt: STRIP_STARTED_AT,
      heatmapPoints: STRIP_HEATMAP,
      topEmotesCatalog: STRIP_TOP_EMOTES,
      rollups: STRIP_ROLLUPS,
      onSelectOffset,
    },
    ...overrides,
  }
  const view = render(<AnalyticsChart {...props} />)
  frames.flush()
  // Pins draw only with Show on chart's Moments marker (off on every load).
  if (moments) {
    showOnChart(act, view.container, 'moments')
    frames.flush()
  }
  return { ...view, props, onSelectOffset }
}

const pinMembers = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-session-pin], [data-session-pin-cluster]')].flatMap(el =>
    el.hasAttribute('data-session-pin')
      ? [Number(el.getAttribute('data-session-pin'))]
      : el.getAttribute('data-session-pin-cluster')!.split(',').map(Number),
  )

describe('SessionSpChart pins', () => {
  it('pins the first five Pulse Moments strip rows, numbered in strip order, in the rail above the plot', () => {
    const { container } = renderPins(1400)
    expect(stripOffsets.length).toBeGreaterThan(5)
    const rail = screen.getByRole('group', { name: 'Top moments on the timeline' })
    expect(rail.hasAttribute('data-session-pins')).toBe(true)
    expect(pinMembers(container).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    // 6 px gap + the 28 px rail, above the plot (the plot itself does not move).
    expect(SESSION_PINS_TOP_PX).toBe(34)
    expect(container.querySelector<HTMLElement>('.spc-top')?.style.height).toBe('34px')
    // Each single pin names its strip rank and time.
    // At 1400 px the five pins stand apart; each names its strip rank, time and top emote.
    expect(container.querySelectorAll('[data-session-pin-cluster]')).toHaveLength(0)
    expect(container.querySelector('[data-session-pin="1"]')?.getAttribute('aria-label'))
      .toBe('Moment 1 at 1:15:18, top emote OMEGALUL')
    expect(container.querySelector('[data-session-pin="4"]')?.getAttribute('aria-label')).toBe('Moment 4 at 2:00:00')
    expect(performance.getEntriesByName('sp:pins-ready', 'mark').length).toBeGreaterThan(0)
  })

  it('a pin click is the strip row click: same handler, same offset', () => {
    const { container, onSelectOffset } = renderPins(1400)
    const pin = container.querySelector<HTMLElement>('[data-session-pin]')!
    const rank = Number(pin.getAttribute('data-session-pin'))
    fireEvent.click(pin)
    expect(onSelectOffset).toHaveBeenCalledTimes(1)
    expect(onSelectOffset).toHaveBeenCalledWith(stripOffsets[rank - 1])
  })

  it('hovering a pin lights its strip row and draws the ghost rule; leaving clears both', () => {
    const { container } = renderPins(1400)
    const pin = container.querySelector<HTMLElement>('[data-session-pin]')!
    const rank = Number(pin.getAttribute('data-session-pin'))
    fireEvent.pointerEnter(pin)
    expect(getStripPinHover()).toBe(stripOffsets[rank - 1])
    frames!.flush()
    expect(container.querySelector('[data-session-pin-ghost]')?.getAttribute('d')).toMatch(/^M[\d.]+ /)
    fireEvent.pointerLeave(pin)
    frames!.flush()
    expect(getStripPinHover()).toBeNull()
    expect(container.querySelector('[data-session-pin-ghost]')?.getAttribute('d')).toBe('')
  })

  it('presses the selected moment pin; a second click clears the selection', () => {
    const offset = stripOffsets[0]!
    const rollup = detail.rollups[Math.floor(offset / 60)]!
    const onSelectRollup = vi.fn()
    const { container, onSelectOffset } = renderPins(1400, { selectedOffsetSeconds: offset, selectedRollup: rollup, onSelectRollup })
    const pin = container.querySelector<HTMLElement>('[data-session-pin="1"]')!
    expect(pin.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('[data-session-pin][aria-pressed="true"]')).toHaveLength(1)
    // The teal leader is the selected pin's.
    expect(container.querySelector('.ssc-leader-on')?.getAttribute('d')).toMatch(/^M/)
    fireEvent.click(pin)
    expect(onSelectRollup).toHaveBeenCalledWith(null)
    expect(onSelectOffset).not.toHaveBeenCalled()
  })

  it('merges pins closer than 46 px into one cluster; a cluster click zooms until they separate', () => {
    const { container } = renderPins(600)
    // At 600 px, rows 1 and 5 (13 min apart) and rows 2 and 3 merge; row 4 stands alone.
    const clusters = [...container.querySelectorAll<HTMLElement>('[data-session-pin-cluster]')]
    expect(clusters.map(el => el.querySelector('.ssc-pn')?.textContent)).toEqual(['1·5', '2·3'])
    expect(container.querySelector('[data-session-pin="4"]')).not.toBeNull()
    const cluster = clusters[0]!
    const members = cluster.getAttribute('data-session-pin-cluster')!.split(',').map(Number)
    expect(members).toEqual([1, 5])
    expect(cluster.getAttribute('aria-label')).toBe('Moments 1 and 5, zoom in to separate them')
    const full = viewportOf(container)
    fireEvent.click(cluster)
    frames!.flush()
    const zoomed = viewportOf(container)
    expect(zoomed[1] - zoomed[0]).toBeLessThan(full[1] - full[0])
    // The cluster's moments are now separate pins.
    for (const rank of members) expect(container.querySelector(`[data-session-pin="${rank}"]`)).not.toBeNull()
  })

  it('draws no pins, rail or leaders until Show on chart turns Moments on', () => {
    const { container } = renderPins(1400, {}, vi.fn(), false)
    expect(container.querySelector('[data-session-pin], [data-session-pin-cluster]')).toBeNull()
    expect(container.querySelector('.spc-top')).toBeNull()
    expect(container.querySelector('.ssc-leader')).toBeNull()
    showOnChart(act, container, 'moments')
    frames!.flush()
    expect(pinMembers(container).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(container.querySelector<HTMLElement>('.spc-top')?.style.height).toBe('34px')
  })

  it('draws no pins while the strip does not render', () => {
    const { container } = renderPins(1400, { stripPins: null })
    expect(container.querySelector('[data-session-pin], [data-session-pin-cluster]')).toBeNull()
  })
})
