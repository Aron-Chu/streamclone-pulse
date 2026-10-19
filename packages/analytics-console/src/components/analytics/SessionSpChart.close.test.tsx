import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMemo, useState } from 'react'
import type { AnalyticsMinuteRollup } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { harnessDetail, holdFrames, showOnChart, type HeldFrames } from './__fixtures__/sessionChartHarness.ts'
import {
  STRIP_HEATMAP,
  STRIP_RECAP,
  STRIP_ROLLUPS,
  STRIP_STARTED_AT,
  STRIP_TOP_EMOTES,
} from './__fixtures__/sessionStripFixture.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

let frames: HeldFrames | null = null
afterEach(() => {
  cleanup()
  frames?.restore()
  frames = null
  vi.restoreAllMocks()
})

/** The console's part: it owns the selection and renders the selected detail with its × (click-only detail). */
function Console({ minutes, startedAt, spy, withPins = false }: {
  minutes: number
  startedAt?: string
  spy: (rollup: AnalyticsMinuteRollup | null) => void
  withPins?: boolean
}) {
  const detail = useMemo(() => harnessDetail(minutes, { startedAt }), [minutes, startedAt])
  const [rollup, setRollup] = useState<AnalyticsMinuteRollup | null>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const select = (next: AnalyticsMinuteRollup | null) => {
    spy(next)
    setRollup(next)
    if (!next) setOffset(null)
  }
  return (
    <AnalyticsChart
      detail={detail}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={rollup}
      selectedOffsetSeconds={offset}
      onSelectRollup={select}
      viewMode="overview"
      onViewModeChange={vi.fn()}
      selectedDetail={rollup ? (
        <div data-test-detail="">
          <button type="button" aria-label="Close" onClick={() => select(null)}>×</button>
        </div>
      ) : null}
      stripPins={withPins ? {
        recap: STRIP_RECAP,
        streamStartedAt: STRIP_STARTED_AT,
        heatmapPoints: STRIP_HEATMAP,
        topEmotesCatalog: STRIP_TOP_EMOTES,
        rollups: STRIP_ROLLUPS,
        onSelectOffset: seconds => {
          setOffset(seconds)
          select(detail.rollups[Math.floor(seconds / 60)] ?? null)
        },
      } : null}
    />
  )
}

function renderConsole(props: Omit<Parameters<typeof Console>[0], 'spy'>) {
  frames = holdFrames(act)
  const spy = vi.fn()
  const view = render(<Console {...props} spy={spy} />)
  frames.flush()
  const svg = view.container.querySelector<SVGSVGElement>('[data-bench-plot]')!
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 944, top: 0, bottom: 400, width: 944, height: 400, x: 0, y: 0 } as DOMRect)
  return { ...view, spy, svg }
}

// 90 minutes over the 944 px fallback plot: 10.5 px a minute, so a click picks a minute.
const xOfMinute = (minute: number, minutes = 90) => ((minute + 0.5) / minutes) * 944

function clickMinute(svg: SVGSVGElement, minute: number) {
  const clientX = xOfMinute(minute)
  fireEvent.pointerDown(svg, { clientX, clientY: 200, pointerType: 'mouse' })
  fireEvent.click(svg, { clientX, clientY: 200 })
}

const detailShown = (container: HTMLElement) => container.querySelector('[data-test-detail]') != null

describe('SessionSpChart selection closes (A3)', () => {
  it('never opens on hover: the readout follows the pointer, the detail stays closed', () => {
    const { container, spy, svg } = renderConsole({ minutes: 90 })
    const readout = () => container.querySelector('[data-session-readout]')!.textContent!.replace(/\s+/g, ' ')
    const resting = readout()
    fireEvent.pointerMove(svg, { clientX: xOfMinute(20), clientY: 200, pointerType: 'mouse' })
    frames!.flush()
    expect(readout()).not.toBe(resting)
    expect(readout()).toContain('0:20:00')
    expect(spy).not.toHaveBeenCalled()
    expect(detailShown(container)).toBe(false)
  })

  it('a click pins the minute; a second click on it closes and focus goes back to the plot', () => {
    const { container, spy, svg } = renderConsole({ minutes: 90 })
    clickMinute(svg, 20)
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ minuteTs: '2026-07-31T00:20:00.000Z' }))
    expect(detailShown(container)).toBe(true)
    // session-original readout: "Pinned 0:20:00 · viewers … · chat …/min · emotes …/min"
    expect(container.querySelector('[data-session-readout]')?.textContent).toMatch(/^Pinned 0:20:00 · /)
    clickMinute(svg, 20)
    expect(spy).toHaveBeenLastCalledWith(null)
    expect(detailShown(container)).toBe(false)
    expect(document.activeElement).toBe(svg)
  })

  it("the readout line's Clear shows while a minute is pinned, closes it, and focus goes back to the plot", () => {
    const { container, spy, svg } = renderConsole({ minutes: 90 })
    const clear = () => container.querySelector<HTMLButtonElement>('[data-session-readout-clear]')!
    expect(clear().hidden).toBe(true)
    clickMinute(svg, 20)
    expect(detailShown(container)).toBe(true)
    expect(clear().hidden).toBe(false)
    clear().focus()
    fireEvent.click(clear())
    expect(spy).toHaveBeenLastCalledWith(null)
    expect(detailShown(container)).toBe(false)
    expect(clear().hidden).toBe(true)
    expect(document.activeElement).toBe(svg)
  })

  it('Esc closes the pinned minute, keeps the zoom, and focus goes back to the plot', () => {
    const { container, spy, svg } = renderConsole({ minutes: 90 })
    fireEvent.click(screen.getByRole('button', { name: '1h' }))
    frames!.flush()
    const zoomed = container.querySelector('[data-hub-chart-navigator]')!.getAttribute('data-hub-chart-navigator-window')
    clickMinute(svg, 60)
    expect(detailShown(container)).toBe(true)
    fireEvent.keyDown(svg, { key: 'Escape' })
    frames!.flush()
    expect(spy).toHaveBeenLastCalledWith(null)
    expect(detailShown(container)).toBe(false)
    expect(container.querySelector('[data-hub-chart-navigator]')!.getAttribute('data-hub-chart-navigator-window')).toBe(zoomed)
    expect(document.activeElement).toBe(svg)
  })

  it('× closes, and focus goes back to what opened it (keyboard open on the plot)', () => {
    const { container, spy, svg } = renderConsole({ minutes: 90 })
    svg.focus()
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    fireEvent.keyDown(svg, { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ minuteTs: expect.any(String) }))
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.click(close)
    expect(spy).toHaveBeenLastCalledWith(null)
    expect(detailShown(container)).toBe(false)
    expect(document.activeElement).toBe(svg)
  })

  it('a pin opens the strip row; Esc closes it and focus returns to that pin', () => {
    const { container, spy } = renderConsole({ minutes: 210, startedAt: STRIP_STARTED_AT, withPins: true })
    // Pins draw only with Show on chart's Moments marker.
    showOnChart(act, container, 'moments')
    frames!.flush()
    const pin = container.querySelector<HTMLElement>('[data-session-pin="1"]')!
    pin.focus()
    fireEvent.click(pin)
    frames!.flush()
    expect(detailShown(container)).toBe(true)
    expect(container.querySelector('[data-session-pin="1"]')?.getAttribute('aria-pressed')).toBe('true')
    // Focus moved into the detail before closing (as a real click on × would).
    screen.getByRole('button', { name: 'Close' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    frames!.flush()
    expect(spy).toHaveBeenLastCalledWith(null)
    expect(detailShown(container)).toBe(false)
    expect(document.activeElement).toBe(container.querySelector('[data-session-pin="1"]'))
  })
})
