// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChartPositionRail,
  LONG_STREAM_OVERVIEW_SECONDS,
  MIN_MEANINGFUL_CHART_DURATION_SECONDS,
  resolveRailKeyboardViewport,
  resolveRailPointerViewport,
  shouldShowChartRail,
} from '../src/ui/ChartPositionRail.tsx'
import type { ChartViewport } from '../src/ui/chartViewport.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function pointerEvent(type: string, clientX: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
    button: { value: 0 },
  })
  return event
}

describe('ChartPositionRail', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  function renderRail(
    onViewportChange: (viewport: ChartViewport) => void,
    onInteractionChange = vi.fn(),
    onJumpToOffset = vi.fn(),
    disabled = false,
  ) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <ChartPositionRail
          viewport={{ startSeconds: 600, endSeconds: 1200 }}
          durationSeconds={3600}
          onViewportChange={onViewportChange}
          onInteractionChange={onInteractionChange}
          onJumpToOffset={onJumpToOffset}
          disabled={disabled}
        />,
      )
    })
    const rail = container.querySelector<HTMLElement>('[data-chart-rail]')
    if (!rail) throw new Error('rail did not render')
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
      width: 320,
      height: 20,
      top: 0,
      left: 0,
      right: 320,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    return rail
  }

  it('shows a full-range rail once a short timeline has meaningful data', () => {
    const fullViewport = { startSeconds: 0, endSeconds: 60 * 60 }
    expect(shouldShowChartRail(fullViewport, 60 * 60)).toBe(true)
    expect(
      shouldShowChartRail(
        { startSeconds: 0, endSeconds: MIN_MEANINGFUL_CHART_DURATION_SECONDS },
        MIN_MEANINGFUL_CHART_DURATION_SECONDS,
      ),
    ).toBe(true)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 30 }, 30)).toBe(false)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 30 * 60 }, 60 * 60)).toBe(true)
  })

  it('shows the overview rail for long timelines at the full range', () => {
    const durationSeconds = LONG_STREAM_OVERVIEW_SECONDS
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: durationSeconds }, durationSeconds)).toBe(true)
  })

  it('renders an accessible rail with a bounded viewport thumb', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 3_600, endSeconds: 7_200 }}
        durationSeconds={7_200}
        onViewportChange={() => undefined}
        ariaLabel="Chart zoom and position"
      />,
    )

    expect(html).toContain('data-chart-rail="true"')
    expect(html).toContain('data-chart-rail-thumb="true"')
    expect(html).toContain('aria-label="Chart zoom and position"')
    expect(html).toContain('aria-valuemax="7200"')
    expect(html).toContain('data-chart-rail-handle="start"')
    expect(html).toContain('data-chart-rail-handle="end"')
    expect(html).not.toContain('display:none')
  })

  it('marks disabled rails as unavailable and ignores pointer and keyboard navigation', () => {
    const changes = vi.fn()
    const interaction = vi.fn()
    const seek = vi.fn()
    const rail = renderRail(changes, interaction, seek, true)
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    const handle = rail.querySelector<HTMLElement>('[data-chart-rail-resize="end"]')
    if (!thumb || !handle) throw new Error('rail controls did not render')

    expect(rail.getAttribute('aria-disabled')).toBe('true')
    expect(rail.tabIndex).toBe(-1)
    expect(rail.style.cursor).toBe('default')
    expect(rail.hasAttribute('title')).toBe(false)
    expect(rail.classList.contains('pulse-chart-rail-track')).toBe(true)
    expect(thumb.classList.contains('pulse-chart-rail-thumb')).toBe(true)

    act(() => {
      for (const target of [rail, thumb, handle]) {
        target.dispatchEvent(pointerEvent('pointerdown', 80))
        rail.dispatchEvent(pointerEvent('pointermove', 180))
        rail.dispatchEvent(pointerEvent('pointerup', 180))
      }
      for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', '[', ']', 'Escape']) {
        rail.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      }
    })

    expect(changes).not.toHaveBeenCalled()
    expect(interaction).not.toHaveBeenCalled()
    expect(seek).not.toHaveBeenCalled()
    expect(rail.dataset.chartInteracting).toBe('false')
  })

  it('shows selected-bucket state and marks an off-screen selection on the full rail', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 1_800, endSeconds: 2_400 }}
        durationSeconds={3_600}
        selectedOffsetSeconds={600}
        onViewportChange={() => undefined}
      />,
    )

    expect(html).toContain('data-chart-selection-state="off-screen"')
    expect(html).toContain('data-chart-rail-selection-marker="true"')
    expect(html).toContain('data-chart-rail-selection-offscreen="true"')
    expect(html).toContain('selected minute is outside the window')
  })

  it('positions the selection marker against the covered rail timeline', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 1_200, endSeconds: 1_800 }}
        durationSeconds={3_600}
        coverageStartSeconds={600}
        selectedOffsetSeconds={1_200}
        onViewportChange={() => undefined}
      />,
    )

    expect(html).toContain('data-chart-selection-state="in-view"')
    expect(html).toContain('left:20%')
  })

  it('keeps an unloaded pre-coverage selection off the covered rail', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 1_200, endSeconds: 1_800 }}
        durationSeconds={3_600}
        coverageStartSeconds={600}
        selectedOffsetSeconds={300}
        onViewportChange={() => undefined}
      />,
    )

    expect(html).toContain('data-chart-selection-state="off-screen"')
    expect(html).not.toContain('data-chart-rail-selection-marker="true"')
  })

  it('can keep the visible range label with controls above the plot', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 3_600, endSeconds: 7_200 }}
        durationSeconds={7_200}
        onViewportChange={() => undefined}
        hideRangeLabel
      />,
    )

    expect(html).toContain('data-chart-rail="true"')
    expect(html).not.toContain('Viewing 01:00:00')
  })

  it('renders an incoming stale viewport at the covered edge without a dead rail segment', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 2_000, endSeconds: 4_000 }}
        durationSeconds={25_200}
        coverageStartSeconds={21_060}
        onViewportChange={() => undefined}
        ariaLabel="Chart zoom and position"
      />,
    )

    expect(html).toContain('aria-valuenow="21060"')
    expect(html).not.toContain('data-chart-rail-uncovered')
  })

  it('bounds pointer navigation to covered timeline data', () => {
    const startResult = resolveRailPointerViewport({
      clientX: 8,
      trackLeft: 0,
      trackWidth: 100,
      viewport: { startSeconds: 300, endSeconds: 600 },
      durationSeconds: 1_000,
      coverageStartSeconds: 200,
    })
    expect(startResult?.offsetSeconds).toBe(264)

    const result = resolveRailPointerViewport({
      clientX: 90,
      trackLeft: 0,
      trackWidth: 100,
      viewport: { startSeconds: 300, endSeconds: 600 },
      durationSeconds: 1_000,
      coverageStartSeconds: 200,
    })
    expect(result?.offsetSeconds).toBe(920)
    expect(result?.viewport.startSeconds).toBeGreaterThanOrEqual(200)
    expect(result?.viewport.endSeconds).toBeLessThanOrEqual(1_000)
  })

  it('keeps a short-stream rail bounded while still reporting the clicked offset', () => {
    const result = resolveRailPointerViewport({
      clientX: 50,
      trackLeft: 0,
      trackWidth: 100,
      viewport: { startSeconds: 0, endSeconds: 240 },
      durationSeconds: 240,
    })

    expect(result?.offsetSeconds).toBe(120)
    expect(result?.viewport).toEqual({ startSeconds: 0, endSeconds: 240 })
  })

  it('keeps keyboard pan and Home/End navigation inside coverage', () => {
    const args = {
      viewport: { startSeconds: 300, endSeconds: 600 },
      durationSeconds: 1_000,
      coverageStartSeconds: 200,
    }
    expect(resolveRailKeyboardViewport({ ...args, key: 'ArrowLeft' })?.viewport).toEqual({
      startSeconds: 240,
      endSeconds: 540,
    })
    expect(resolveRailKeyboardViewport({ ...args, key: 'Home' })?.viewport).toEqual({
      startSeconds: 200,
      endSeconds: 500,
    })
    expect(resolveRailKeyboardViewport({ ...args, key: 'End' })?.viewport).toEqual({
      startSeconds: 700,
      endSeconds: 1_000,
    })
    expect(resolveRailKeyboardViewport({ ...args, key: 'ArrowRight', shiftKey: true })?.viewport).toEqual({
      startSeconds: 700,
      endSeconds: 1_000,
    })
  })

  it('resizes with Alt+arrows without crossing the shared zoom floor', () => {
    const args = {
      viewport: { startSeconds: 600, endSeconds: 1_200 },
      durationSeconds: 3_600,
    }

    expect(resolveRailKeyboardViewport({ ...args, key: 'ArrowLeft', altKey: true })?.viewport).toEqual({
      startSeconds: 540,
      endSeconds: 1_200,
    })
    expect(resolveRailKeyboardViewport({
      ...args,
      key: 'ArrowRight',
      altKey: true,
      shiftKey: true,
    })?.viewport).toEqual({
      startSeconds: 900,
      endSeconds: 1_200,
    })
  })

  it('does not recenter or seek when the thumb is pressed without dragging', () => {
    const changes: ChartViewport[] = []
    const seek = vi.fn()
    const rail = renderRail((next) => changes.push(next), vi.fn(), seek)
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    if (!thumb) throw new Error('thumb did not render')

    act(() => {
      thumb.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointerup', 80))
    })

    expect(changes).toHaveLength(0)
    expect(seek).not.toHaveBeenCalled()
  })

  it('centers the chart without seeking or opening a VOD', () => {
    const changes: ChartViewport[] = []
    const seek = vi.fn()
    const rail = renderRail((next) => changes.push(next), vi.fn(), seek)

    act(() => {
      rail.dispatchEvent(pointerEvent('pointerdown', 260))
      rail.dispatchEvent(pointerEvent('pointerup', 260))
    })

    expect(changes).toHaveLength(1)
    expect(seek).not.toHaveBeenCalled()
    act(() => {
      for (const key of ['Home', 'End']) rail.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    expect(seek).not.toHaveBeenCalled()
  })

  it('pans the thumb only after the pixel threshold and preserves its span', async () => {
    const changes: ChartViewport[] = []
    const interaction = vi.fn()
    const rail = renderRail((next) => changes.push(next), interaction)
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    if (!thumb) throw new Error('thumb did not render')

    act(() => {
      thumb.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointermove', 84))
    })
    expect(changes).toHaveLength(0)
    expect(interaction).not.toHaveBeenCalled()

    act(() => {
      rail.dispatchEvent(pointerEvent('pointermove', 120))
    })
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    const last = changes.at(-1)
    expect(last).toBeDefined()
    expect(last!.endSeconds - last!.startSeconds).toBe(600)
    expect(last!.startSeconds).toBeGreaterThan(600)
    expect(interaction).toHaveBeenNthCalledWith(1, true)

    act(() => {
      rail.dispatchEvent(pointerEvent('pointerup', 120))
    })
    expect(interaction).toHaveBeenLastCalledWith(false)
  })

  it('cancels a drag and keeps the viewport unchanged', async () => {
    const changes: ChartViewport[] = []
    const rail = renderRail((next) => changes.push(next))
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    if (!thumb) throw new Error('thumb did not render')

    act(() => {
      thumb.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointermove', 120))
      rail.dispatchEvent(pointerEvent('pointercancel', 120))
    })
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    expect(changes).toHaveLength(0)
  })

  it('resizes an edge without crossing coverage or the minimum duration', async () => {
    const changes: ChartViewport[] = []
    const rail = renderRail((next) => changes.push(next))
    const handle = rail.querySelector<HTMLElement>('[data-chart-rail-resize="end"]')
    if (!handle) throw new Error('end handle did not render')

    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointermove', -1_000))
    })
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })

    expect(changes.at(-1)).toEqual({ startSeconds: 600, endSeconds: 900 })
  })

  it('keeps edge resize targets invisible instead of rendering white blocks', () => {
    const rail = renderRail(vi.fn())
    const start = rail.querySelector<HTMLElement>('[data-chart-rail-resize="start"]')
    const end = rail.querySelector<HTMLElement>('[data-chart-rail-resize="end"]')
    expect(start?.getAttribute('style')).toContain('background: transparent')
    expect(end?.getAttribute('style')).toContain('background: transparent')
    expect(start?.getAttribute('style')).not.toContain('255, 255, 255')
    expect(end?.getAttribute('style')).not.toContain('255, 255, 255')
  })

  it('uses the clamped coverage boundary in its label and slider minimum', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      act(() => {
        root.render(
          <ChartPositionRail
            viewport={{ startSeconds: 0, endSeconds: 3_600 }}
            durationSeconds={3_600}
            coverageStartSeconds={-120}
            onViewportChange={vi.fn()}
          />,
        )
      })
      const rail = host.querySelector<HTMLElement>('[data-chart-rail]')
      expect(rail?.getAttribute('aria-valuemin')).toBe('0')
      expect(host.textContent).toContain('Full stream')
      expect(host.textContent).not.toContain('Available coverage')
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })
})
