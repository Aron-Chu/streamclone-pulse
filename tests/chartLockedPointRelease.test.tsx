// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * A 33h Full chart: 480 source buckets drawn as 120 points, four to a point.
 * A Top Moments pick pins the bucket that holds the moment (here source
 * bucket 4), which is usually not the busiest bucket the point draws (6).
 * Clicking or pressing Enter on that locked point must release or keep the
 * pin, never move it to the drawn bucket.
 */
const STEP = 254
const rollups: ExtensionRollup[] = Array.from({ length: 480 }, (_, index) => ({
  offsetSeconds: index * STEP,
  // Jitter, so a point's busiest bucket is not its first: 4..7 -> 30, 21, 35, 26.
  chatCount: 20 + ((index * 37) % 23),
  sevenTvEmoteCount: 2,
}))
const DURATION = rollups.length * STEP
const PINNED = 4

describe('locked point after a Top Moments pick', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.restoreAllMocks()
  })

  function renderPinned(select: (index: number) => void, clear: () => void): SVGRectElement {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(
      <PulseOverviewChart
        rollups={rollups}
        durationSeconds={DURATION}
        viewport={{ startSeconds: 0, endSeconds: DURATION }}
        selectedIndex={PINNED}
        onSelectIndex={select}
        onClearSelection={clear}
        reducedMotion
      />,
    ))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('data-chart-locked-index')).toBe('1')
    const plot = container.querySelector<SVGRectElement>('[data-chart-scrubber]')
    if (!plot) throw new Error('Chart plot did not render')
    const x = Number(plot.getAttribute('x'))
    const y = Number(plot.getAttribute('y'))
    const width = Number(plot.getAttribute('width'))
    const height = Number(plot.getAttribute('height'))
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x, y, left: x, top: y, width, height,
      right: x + width, bottom: y + height, toJSON: () => ({}),
    })
    return plot
  }

  function pointX(plot: SVGRectElement, index: number): number {
    const x = Number(plot.getAttribute('x'))
    const width = Number(plot.getAttribute('width'))
    return x + (index / 119) * width
  }

  it('clears the pin when the locked column is clicked', () => {
    const select = vi.fn()
    const clear = vi.fn()
    const plot = renderPinned(select, clear)
    const bottom = Number(plot.getAttribute('y')) + Number(plot.getAttribute('height')) - 2
    act(() => {
      plot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: pointX(plot, 1), clientY: bottom }))
    })
    expect(select).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('still moves the pin when another column is clicked', () => {
    const select = vi.fn()
    const clear = vi.fn()
    const plot = renderPinned(select, clear)
    const bottom = Number(plot.getAttribute('y')) + Number(plot.getAttribute('height')) - 2
    act(() => {
      plot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: pointX(plot, 3), clientY: bottom }))
    })
    expect(clear).not.toHaveBeenCalled()
    // Point 3 draws its busiest bucket of 12..15.
    expect(select).toHaveBeenCalledTimes(1)
    const [index] = select.mock.calls[0]!
    expect(index).toBeGreaterThanOrEqual(12)
    expect(index).toBeLessThan(16)
  })

  it('keeps the pin when Enter is pressed on the locked point', () => {
    const select = vi.fn()
    const clear = vi.fn()
    const plot = renderPinned(select, clear)
    const press = (key: string) => act(() => {
      plot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
    })
    // Preview steps away from the lock and back onto it, then commits.
    press('ArrowRight')
    press('ArrowLeft')
    press('Enter')
    expect(select).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    // Enter on a neighbouring point still locks it.
    press('ArrowRight')
    press('Enter')
    expect(select).toHaveBeenCalledTimes(1)
  })
})
