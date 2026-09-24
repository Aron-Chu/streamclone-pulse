// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartPositionRail } from '../src/ChartPositionRail.tsx'
import type { ChartViewport } from '../src/chartViewport.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const durationSeconds = 60 * 60
const initialViewport: ChartViewport = { startSeconds: 600, endSeconds: 1200 }

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

function keyEvent(key: string) {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
}

describe('ChartPositionRail direct manipulation', () => {
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
    selectedOffsetSeconds: number | null = null,
    onJumpToOffset = vi.fn(),
  ) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <ChartPositionRail
          viewport={initialViewport}
          durationSeconds={durationSeconds}
          onViewportChange={onViewportChange}
          onInteractionChange={onInteractionChange}
          selectedOffsetSeconds={selectedOffsetSeconds}
          onJumpToOffset={onJumpToOffset}
        />,
      )
    })
    const rail = container.querySelector<HTMLElement>('[data-chart-position-rail="true"]')
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

  it('coalesces thumb drag updates and disables motion for the interaction lifetime', async () => {
    const changes: ChartViewport[] = []
    const interaction = vi.fn()
    const seek = vi.fn()
    const rail = renderRail((next) => changes.push(next), interaction, null, seek)
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    if (!thumb) throw new Error('thumb did not render')

    act(() => {
      thumb.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointermove', 82))
    })
    expect(changes).toHaveLength(0)
    expect(interaction).not.toHaveBeenCalled()

    act(() => {
      rail.dispatchEvent(pointerEvent('pointermove', 120))
      rail.dispatchEvent(pointerEvent('pointermove', 160))
    })
    expect(changes).toHaveLength(0)

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]?.startSeconds).toBeGreaterThan(initialViewport.startSeconds)
    expect(interaction).toHaveBeenNthCalledWith(1, true)

    act(() => {
      rail.dispatchEvent(pointerEvent('pointermove', 200))
      rail.dispatchEvent(pointerEvent('pointerup', 200))
    })
    expect(changes).toHaveLength(2)
    expect(interaction).toHaveBeenLastCalledWith(false)
    expect(seek).not.toHaveBeenCalled()
  })

  it('treats a track click as a center jump without starting a drag', () => {
    const changes: ChartViewport[] = []
    const interaction = vi.fn()
    const seek = vi.fn()
    const rail = renderRail((next) => changes.push(next), interaction, null, seek)

    act(() => {
      rail.dispatchEvent(pointerEvent('pointerdown', 260))
    })
    expect(changes).toHaveLength(1)
    expect(interaction).not.toHaveBeenCalled()
    expect(seek).toHaveBeenCalledTimes(1)

    act(() => {
      rail.dispatchEvent(pointerEvent('pointermove', 300))
    })
    expect(changes).toHaveLength(1)
  })

  it('keeps resize handles usable and exposes an off-screen selected marker', () => {
    const rail = renderRail(vi.fn(), vi.fn(), 3000)
    const handle = rail.querySelector<HTMLElement>('[data-chart-rail-resize="end"]')
    expect(handle?.getAttribute('style')).toContain('width: 14px')
    expect(rail.getAttribute('data-chart-selection-state')).toBe('off-screen')
    expect(rail.querySelector('[data-chart-rail-selection-marker="true"]')?.getAttribute('data-chart-rail-selection-offscreen')).toBe('true')
  })

  it('resizes from an edge while preserving the other edge and minimum span', async () => {
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

  it('preserves keyboard pan and Escape reset semantics', () => {
    const changes: ChartViewport[] = []
    const rail = renderRail((next) => changes.push(next))

    act(() => {
      rail.dispatchEvent(keyEvent('ArrowRight'))
    })
    expect(changes.at(-1)?.startSeconds).toBe(initialViewport.startSeconds + 60)
    act(() => {
      rail.dispatchEvent(keyEvent('Escape'))
    })
    expect(changes.at(-1)).toEqual({ startSeconds: 0, endSeconds: durationSeconds })
  })

  it('does not recenter or seek when the thumb is pressed without dragging', () => {
    const changes: ChartViewport[] = []
    const seek = vi.fn()
    const rail = renderRail((next) => changes.push(next), vi.fn(), null, seek)
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    if (!thumb) throw new Error('thumb did not render')

    act(() => {
      thumb.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointerup', 80))
    })

    expect(changes).toHaveLength(0)
    expect(seek).not.toHaveBeenCalled()
  })

  it('cancels a pending drag without publishing a queued viewport', async () => {
    const changes: ChartViewport[] = []
    const interaction = vi.fn()
    const rail = renderRail((next) => changes.push(next), interaction)
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
    expect(interaction).toHaveBeenNthCalledWith(1, true)
    expect(interaction).toHaveBeenLastCalledWith(false)
  })

  it('ends an active interaction when the rail unmounts', () => {
    const interaction = vi.fn()
    const rail = renderRail(vi.fn(), interaction)
    const thumb = rail.querySelector<HTMLElement>('[data-chart-rail-thumb]')
    if (!thumb) throw new Error('thumb did not render')

    act(() => {
      thumb.dispatchEvent(pointerEvent('pointerdown', 80))
      rail.dispatchEvent(pointerEvent('pointermove', 120))
    })
    expect(interaction).toHaveBeenNthCalledWith(1, true)

    act(() => {
      root?.unmount()
    })
    root = null
    expect(interaction).toHaveBeenLastCalledWith(false)
  })
})
