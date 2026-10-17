import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { barWidthPx } from '@streampulse/pulse-charts/spchart'
import AnalyticsChart from './AnalyticsChart.tsx'
import { SESSION_BAR_OPTIONS } from './SessionSpChart.tsx'
import {
  barMinutes,
  harnessDetail,
  holdFrames,
  setStackWidth,
  type HeldFrames,
} from './__fixtures__/sessionChartHarness.ts'

const motion = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: motion.enabled }) }))

let frames: HeldFrames | null = null
let restoreWidth: (() => void) | null = null
afterEach(() => {
  cleanup()
  frames?.restore()
  restoreWidth?.()
  frames = null
  restoreWidth = null
  motion.enabled = false
})

function renderAt(minutes: number, width: number, skip: number[] = []) {
  restoreWidth = setStackWidth(width)
  frames = holdFrames(act)
  const view = render(
    <AnalyticsChart
      detail={harnessDetail(minutes, { skip })}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
    />,
  )
  frames.flush()
  return view
}

const zoomIn = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  frames!.flush()
}
const laneRects = (container: HTMLElement, lane: 'chat' | 'emotes') =>
  [...container.querySelectorAll(`g.spc-lane-bars[data-lane="${lane}"] rect.spc-bar`)]

describe('SessionSpChart bars (F21: prod one-minute bars in lanes)', () => {
  it('uses prod bars: one per minute down to 1.05 px a minute, centred thin widths, a 1500-rect cap per lane', () => {
    expect(SESSION_BAR_OPTIONS).toEqual({ minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 1500 })
  })

  it('draws one bar a minute in the chat and emotes lanes for a 3h15 stream at 1400 px', () => {
    const { container } = renderAt(195, 1400)
    expect(barMinutes(container)).toBe('1')
    expect(container.querySelector('[data-chart-bar-bucket-minutes]')?.textContent).toBe('1-min bars')
    expect(laneRects(container, 'chat')).toHaveLength(195)
    expect(laneRects(container, 'emotes')).toHaveLength(195)
    // prod's rule at 1344 / 195 = 6.9 px a minute: 6.9 - 1.5 = 5.4 px, centred in the minute
    const sx = 1344 / 195
    const r = laneRects(container, 'chat')[10]!
    const x = Number(r.getAttribute('x')), w = Number(r.getAttribute('width'))
    expect(w * sx).toBeCloseTo(barWidthPx(sx, 'prod'), 2)
    expect(x + w / 2).toBeCloseTo(10.5, 3)
  })

  it('keeps one-minute bars for a 12h28 stream at 1400 px (1.8 px a minute) and coarsens below 1.05 px', () => {
    const { container } = renderAt(748, 1400)
    expect(barMinutes(container)).toBe('1')
    expect(laneRects(container, 'chat')).toHaveLength(748)
    cleanup()
    frames?.restore()
    restoreWidth?.()
    // 700 px: 644 / 748 = 0.86 px a minute, so 2-minute bars; zooming in returns to 1-minute bars
    const narrow = renderAt(748, 700)
    expect(barMinutes(narrow.container)).toBe('2')
    expect(narrow.container.querySelector('[data-chart-bar-bucket-minutes]')?.textContent).toBe('2-min bars')
    expect(laneRects(narrow.container, 'chat')).toHaveLength(374)
    zoomIn()
    expect(barMinutes(narrow.container)).toBe('1')
  })

  it('never draws a peak cap (F3) and keeps each lane under its rect cap at every level', () => {
    const { container } = renderAt(748, 1400)
    const caps = () => container.querySelectorAll('[data-activity-bar-peak], [data-activity-peak-cap], .spc-cap, .spc-peak')
    for (let click = 0; click < 6; click += 1) {
      expect(caps()).toHaveLength(0)
      for (const lane of ['chat', 'emotes'] as const) expect(laneRects(container, lane).length).toBeLessThanOrEqual(1500)
      zoomIn()
    }
    expect(laneRects(container, 'chat').length).toBeGreaterThan(0)
  })

  it('half-fades a bar with an unmeasured minute and says how many were measured on hover', () => {
    // Minute 52 was never measured: at 2-minute bars the 0:52-0:54 bar is partial.
    const { container } = renderAt(748, 700, [52])
    expect(barMinutes(container)).toBe('2')
    const partial = container.querySelectorAll('g.spc-lane-bars[data-lane="chat"] rect.spc-bar[data-lane-partial]')
    expect(partial).toHaveLength(1)
    expect(Number(partial[0]!.getAttribute('x'))).toBeGreaterThan(52)
    expect(Number(partial[0]!.getAttribute('x'))).toBeLessThan(54)
    // chat bars at .12, the partial one at half that
    expect(partial[0]!.getAttribute('fill-opacity')).toBe('0.06')

    const svg = container.querySelector<SVGSVGElement>('[data-bench-plot]')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 644, top: 0, bottom: 440, width: 644, height: 440, x: 0, y: 0 } as DOMRect)
    fireEvent.pointerMove(svg, { clientX: ((53 + 0.5) / 748) * 644, clientY: 200, pointerType: 'mouse' })
    frames!.flush()
    const readout = container.querySelector('[data-session-readout]')!
    expect(readout.textContent).toMatch(/^0:52:00–0:54:00 · 2-min avg · /)
    expect(readout.textContent).toContain('1 of 2 min measured')
  })

  it('moves bars with a transform while the view eases, and commits bars only at settle', () => {
    motion.enabled = true
    const { container } = renderAt(748, 1400)
    const scaled = () => container.querySelector('g[data-spc-scaled]')!
    const before = scaled().getAttribute('transform')
    const firstRect = laneRects(container, 'chat')[0]
    const firstX = firstRect!.getAttribute('x')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    frames!.step(40)
    // Mid-ease: same rect nodes and attributes, new transform.
    expect(scaled().getAttribute('transform')).not.toBe(before)
    expect(laneRects(container, 'chat')[0]).toBe(firstRect)
    expect(firstRect!.getAttribute('x')).toBe(firstX)
    frames!.flush()
    expect(frames!.pending()).toBe(0)
  })
})
