// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const START_MS = Date.parse('2026-09-20T00:00:00.000Z')
const MINUTES = 748

// Every measured minute, as the console passes them in `detailRollups`.
const detailRollups: ChartMinuteRollup[] = Array.from({ length: MINUTES }, (_, index) => ({
  minuteTs: new Date(START_MS + index * 60_000).toISOString(),
  viewerAvg: 20_000 + (index % 50) * 100,
  viewerSamples: 2,
  chatCount: 100 + ((index * 37) % 17) * 10,
  totalEmoteCount: 40 + ((index * 11) % 13) * 5,
}))

// Long streams chart a thinned series: the busiest minute of each ~3-minute
// window, so the rows are unevenly spaced and miss most minutes.
const rollups: ChartMinuteRollup[] = []
for (let start = 0; start < MINUTES; start += 3) {
  const window = detailRollups.slice(start, start + 3)
  rollups.push(window.reduce((best, row) => ((row.chatCount ?? 0) > (best.chatCount ?? 0) ? row : best)))
}

const ONE_HOUR = { startSeconds: 300 * 60, endSeconds: 360 * 60 }

type Rect = { x: number; y: number; width: number; height: number }

function rectOf(element: Element): Rect {
  return {
    x: Number(element.getAttribute('x')),
    y: Number(element.getAttribute('y')),
    width: Number(element.getAttribute('width')),
    height: Number(element.getAttribute('height')),
  }
}

describe('activity hover and pin bands on per-minute bars over a thinned series', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const frames: FrameRequestCallback[] = []

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    frames.length = 0
    vi.unstubAllGlobals()
  })

  function flushFrames() {
    act(() => {
      while (frames.length > 0) frames.shift()!(performance.now())
    })
  }

  function renderChart(props: {
    selectedOffsetSeconds?: number | null
    selectedRollup?: ChartMinuteRollup | null
    onSelectOffset?: (offsetSeconds: number) => void
    onHoverRollupChange?: (rollup: ChartMinuteRollup | null) => void
  }) {
    if (!container) {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    }
    act(() => {
      root?.render(
        <PulseMultiSignalChartInner
          rollups={rollups}
          detailRollups={detailRollups}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={MINUTES * 60}
          viewport={ONE_HOUR}
          variant="console"
          chromeless
          motionEnabled={false}
          activityBucketing="time"
          onSelectRollup={() => {}}
          {...props}
        />,
      )
    })
    const plot = container.querySelector<SVGRectElement>('rect[data-chart-touch-action]')
    if (!plot) throw new Error('plot overlay did not render')
    // Client pixels equal SVG units, so a bar's x is also its clientX.
    const box = rectOf(plot)
    Object.defineProperty(plot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        right: box.x + box.width,
        bottom: box.y + box.height,
        x: box.x,
        y: box.y,
      }),
    })
    return plot
  }

  const chatBars = () =>
    [...container!.querySelectorAll('rect[data-activity-bar="chat"]')].map(rectOf)
  const band = (name: 'hover' | 'pin') => {
    const element = container!.querySelector(`[data-chart-${name}-band="true"]`)
    return element ? rectOf(element) : null
  }

  it('lights the bar under the pointer and keeps a locked band after a click', () => {
    const hovered: Array<ChartMinuteRollup | null> = []
    const onSelectOffset = vi.fn()
    const plot = renderChart({ onSelectOffset, onHoverRollupChange: rollup => hovered.push(rollup) })
    expect(container!.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes'))
      .toBe('1')
    const bars = chatBars()
    expect(bars.length).toBeGreaterThan(50)

    // Consecutive bars, so two of every three sit between thinned rows.
    for (const bar of bars.slice(20, 29)) {
      const centerX = bar.x + bar.width / 2
      act(() => {
        plot.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: centerX, clientY: bar.y }))
      })
      flushFrames()
      const hoverBand = band('hover')
      expect(hoverBand).not.toBeNull()
      expect(hoverBand!.x).toBeLessThanOrEqual(centerX)
      expect(hoverBand!.x + hoverBand!.width).toBeGreaterThanOrEqual(centerX)
      expect(hoverBand!.x).toBeCloseTo(bar.x, 3)
    }

    // The readout names the minute that a click there selects.
    const target = bars[25]!
    const centerX = target.x + target.width / 2
    act(() => {
      plot.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: centerX, clientY: target.y + target.height / 2 }))
    })
    flushFrames()
    const readout = hovered[hovered.length - 1]
    expect(readout).not.toBeNull()
    act(() => {
      plot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: centerX, clientY: target.y + target.height / 2 }))
    })
    expect(onSelectOffset).toHaveBeenCalledTimes(1)
    const offset = onSelectOffset.mock.calls[0]![0] as number
    expect((Date.parse(readout!.minuteTs) - START_MS) / 1000).toBe(offset)

    // The console then selects that minute from the per-minute data, which the
    // thinned rows usually lack. The locked band must still be the clicked bar.
    const selectedRollup = detailRollups.find(row => (Date.parse(row.minuteTs) - START_MS) / 1000 === offset)!
    renderChart({ onSelectOffset, selectedOffsetSeconds: offset, selectedRollup })
    act(() => {
      plot.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    })
    const pinBand = band('pin')
    expect(pinBand).not.toBeNull()
    expect(pinBand!.width).toBeGreaterThan(1.5)
    expect(pinBand!.x).toBeCloseTo(target.x, 3)
    expect(pinBand!.width).toBeCloseTo(target.width, 3)
  })

  it('pins the hovered minute from a click on the viewer line at full range', () => {
    const hovered: Array<ChartMinuteRollup | null> = []
    const onSelectOffset = vi.fn()
    const plot = renderChart({
      onSelectOffset,
      onHoverRollupChange: rollup => hovered.push(rollup),
    })
    // Full range: re-render without the one-hour viewport.
    act(() => {
      root?.render(
        <PulseMultiSignalChartInner
          rollups={rollups}
          detailRollups={detailRollups}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={MINUTES * 60}
          variant="console"
          chromeless
          motionEnabled={false}
          activityBucketing="time"
          onSelectRollup={() => {}}
          onSelectOffset={onSelectOffset}
          onHoverRollupChange={rollup => hovered.push(rollup)}
        />,
      )
    })
    expect(Number(container!.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes')))
      .toBeGreaterThan(1)
    const box = rectOf(plot)
    // The viewer band is the top of the plot, above the activity lanes, so a
    // click there reaches the chart-minute path rather than a bar's peak.
    const clientY = box.y + box.height * 0.08
    let clicks = 0
    for (let step = 1; step < 40; step += 1) {
      const clientX = box.x + (box.width * step) / 40
      act(() => {
        plot.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }))
      })
      flushFrames()
      const readout = hovered[hovered.length - 1]
      expect(readout, `hover readout at x=${clientX}`).not.toBeNull()
      act(() => {
        plot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }))
      })
      clicks += 1
      // Every in-plot click pins something...
      expect(onSelectOffset, `click at x=${clientX} pinned nothing`).toHaveBeenCalledTimes(clicks)
      // ...and it is the minute the readout showed.
      const offset = onSelectOffset.mock.calls[clicks - 1]![0] as number
      expect(offset, `click at x=${clientX}`).toBe((Date.parse(readout!.minuteTs) - START_MS) / 1000)
    }
  })

  function renderFullRange(props: {
    onSelectOffset: (offsetSeconds: number) => void
    onHoverRollupChange: (rollup: ChartMinuteRollup | null) => void
  }) {
    const plot = renderChart(props)
    act(() => {
      root?.render(
        <PulseMultiSignalChartInner
          rollups={rollups}
          detailRollups={detailRollups}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={MINUTES * 60}
          variant="console"
          chromeless
          motionEnabled={false}
          activityBucketing="time"
          onSelectRollup={() => {}}
          {...props}
        />,
      )
    })
    return plot
  }

  it('pins the hovered minute from a click in the chat and emote lanes on bucketed bars', () => {
    const hovered: Array<ChartMinuteRollup | null> = []
    const onSelectOffset = vi.fn()
    const plot = renderFullRange({ onSelectOffset, onHoverRollupChange: rollup => hovered.push(rollup) })
    // Several minutes per bar, as on a 12h stream at the owner's width.
    expect(Number(container!.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes')))
      .toBeGreaterThan(1)
    const box = rectOf(plot)
    const laneY = (name: 'chat' | 'emotes') => {
      const bars = [...container!.querySelectorAll(`rect[data-activity-bar="${name}"]`)].map(rectOf)
      const tallest = bars.reduce((best, bar) => (bar.height > best.height ? bar : best))
      return tallest.y + tallest.height - 1
    }
    let clicks = 0
    for (const lane of ['chat', 'emotes'] as const) {
      const clientY = laneY(lane)
      for (let step = 1; step < 40; step += 1) {
        // Off the bar centres, so the bar's peak minute is usually not the one under the pointer.
        const clientX = box.x + (box.width * (step + 0.37)) / 40
        act(() => {
          plot.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }))
        })
        flushFrames()
        const readout = hovered[hovered.length - 1]
        if (!readout) continue
        act(() => {
          plot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }))
        })
        clicks += 1
        expect(onSelectOffset, `${lane} click at x=${clientX} pinned nothing`).toHaveBeenCalledTimes(clicks)
        const offset = onSelectOffset.mock.calls[clicks - 1]![0] as number
        expect(offset, `${lane} click at x=${clientX}`).toBe((Date.parse(readout.minuteTs) - START_MS) / 1000)
      }
    }
    expect(clicks).toBeGreaterThan(60)
  })

  it('keeps the hovered minute when a mouse press lands half a pixel from the last mousemove', () => {
    const hovered: Array<ChartMinuteRollup | null> = []
    const plot = renderFullRange({ onSelectOffset: vi.fn(), onHoverRollupChange: rollup => hovered.push(rollup) })
    const box = rectOf(plot)
    const clientY = box.y + box.height * 0.08
    let moved = 0
    for (let step = 1; step < 80; step += 1) {
      // Mousemove and click carry whole pixels; the pointer event of the same
      // press carries the fractional position (Windows at 125%, for example).
      const clientX = Math.floor(box.x + (box.width * step) / 80)
      act(() => {
        plot.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }))
      })
      flushFrames()
      const before = hovered[hovered.length - 1]?.minuteTs
      const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: clientX + 0.8, clientY, button: 0 })
      Object.defineProperty(press, 'pointerType', { value: 'mouse' })
      Object.defineProperty(press, 'pointerId', { value: 1 })
      act(() => {
        plot.dispatchEvent(press)
      })
      const release = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: clientX + 0.8, clientY, button: 0 })
      Object.defineProperty(release, 'pointerType', { value: 'mouse' })
      Object.defineProperty(release, 'pointerId', { value: 1 })
      act(() => {
        plot.dispatchEvent(release)
      })
      flushFrames()
      const after = hovered[hovered.length - 1]?.minuteTs
      expect(after, `press at x=${clientX + 0.8}`).toBe(before)
      if (before) moved += 1
    }
    expect(moved).toBeGreaterThan(60)
  })
})
