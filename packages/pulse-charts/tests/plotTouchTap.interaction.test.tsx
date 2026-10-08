// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rollups: ChartMinuteRollup[] = Array.from({ length: 24 }, (_, index) => ({
  minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString(),
  viewerAvg: 100 + index * 10,
  viewerSamples: 1,
  chatCount: 10,
  totalEmoteCount: 2,
}))

function pointerEvent(type: string, clientX: number, pointerType: 'touch' | 'mouse') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: 120 },
    pointerId: { value: 7 },
    pointerType: { value: pointerType },
    button: { value: 0 },
  })
  return event
}

function click(clientX: number) {
  return new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY: 120 })
}

describe('plot tap selection', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  function renderChart(onSelectRollup: (rollup: ChartMinuteRollup | null) => void) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <PulseMultiSignalChartInner
          rollups={rollups}
          onSelectRollup={onSelectRollup}
          motionEnabled={false}
          variant="console"
          chromeless
        />,
      )
    })
    const plot = container.querySelector<SVGRectElement>('rect[data-chart-touch-action]')
    if (!plot) throw new Error('plot overlay did not render')
    Object.defineProperty(plot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400, x: 0, y: 0 }),
    })
    return plot
  }

  it('selects the tapped minute after the implicit touch capture is released', () => {
    const onSelectRollup = vi.fn()
    const plot = renderChart(onSelectRollup)

    // Browser order for a touch tap: touch pointers are captured implicitly, so
    // releasing that capture in pointerup fires lostpointercapture before click.
    act(() => {
      plot.dispatchEvent(pointerEvent('pointerdown', 500, 'touch'))
      plot.dispatchEvent(pointerEvent('pointerup', 500, 'touch'))
      plot.dispatchEvent(pointerEvent('lostpointercapture', 500, 'touch'))
      plot.dispatchEvent(click(500))
    })

    expect(onSelectRollup).toHaveBeenCalledTimes(1)
    expect(onSelectRollup.mock.calls[0]?.[0]).toMatchObject({ minuteTs: expect.any(String) })
  })

  it('still swallows the click when the browser cancels the touch gesture', () => {
    const onSelectRollup = vi.fn()
    const plot = renderChart(onSelectRollup)

    act(() => {
      plot.dispatchEvent(pointerEvent('pointerdown', 500, 'touch'))
      plot.dispatchEvent(pointerEvent('pointercancel', 500, 'touch'))
      plot.dispatchEvent(pointerEvent('lostpointercapture', 500, 'touch'))
      plot.dispatchEvent(click(500))
    })

    expect(onSelectRollup).not.toHaveBeenCalled()
  })

  it('keeps a mouse scrub to a single selection when capture is released', () => {
    const onSelectRollup = vi.fn()
    const plot = renderChart(onSelectRollup)

    act(() => {
      plot.dispatchEvent(pointerEvent('pointerdown', 300, 'mouse'))
      plot.dispatchEvent(pointerEvent('pointermove', 400, 'mouse'))
      plot.dispatchEvent(pointerEvent('pointermove', 600, 'mouse'))
      plot.dispatchEvent(pointerEvent('pointerup', 600, 'mouse'))
      plot.dispatchEvent(pointerEvent('lostpointercapture', 600, 'mouse'))
      plot.dispatchEvent(click(600))
    })

    // The scrub release selects once; the trailing click must not toggle it.
    expect(onSelectRollup).toHaveBeenCalledTimes(1)
  })

  it('selects on a plain mouse click', () => {
    const onSelectRollup = vi.fn()
    const plot = renderChart(onSelectRollup)

    act(() => {
      plot.dispatchEvent(pointerEvent('pointerdown', 500, 'mouse'))
      plot.dispatchEvent(pointerEvent('pointerup', 500, 'mouse'))
      plot.dispatchEvent(click(500))
    })

    expect(onSelectRollup).toHaveBeenCalledTimes(1)
  })
})
