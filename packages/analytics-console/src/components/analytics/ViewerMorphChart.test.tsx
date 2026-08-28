import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseMultiSignalChartInner, type ChartMinuteRollup } from '@streampulse/pulse-charts'

const rollups: ChartMinuteRollup[] = [
  { minuteTs: '2026-07-31T00:00:00.000Z', viewerAvg: 100, viewerSamples: 1, chatCount: 10, totalEmoteCount: 2 },
  { minuteTs: '2026-07-31T00:01:00.000Z', viewerAvg: 900, viewerSamples: 1, chatCount: 12, totalEmoteCount: 3 },
  { minuteTs: '2026-07-31T00:02:00.000Z', viewerAvg: 180, viewerSamples: 1, chatCount: 9, totalEmoteCount: 1 },
  { minuteTs: '2026-07-31T00:03:00.000Z', viewerAvg: 220, viewerSamples: 1, chatCount: 14, totalEmoteCount: 4 },
]

function Harness({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState<ChartMinuteRollup | null>(null)
  return (
    <PulseMultiSignalChartInner
      rollups={rollups}
      selectedRollup={selected}
      onSelectRollup={setSelected}
      motionEnabled={false}
      variant={compact ? 'compact' : 'console'}
      chromeless={!compact}
    />
  )
}

function chartNodes(container: HTMLElement) {
  const svg = container.querySelector('svg')
  const overlay = container.querySelector('rect[fill="transparent"]')
  if (!svg || !overlay) throw new Error('chart interaction nodes not found')
  Object.defineProperty(overlay, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400 }),
  })
  return { svg, overlay: overlay as SVGRectElement }
}

function pointerClick(overlay: SVGRectElement, clientX: number) {
  dispatchPointer(overlay, 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY: 120 })
  dispatchPointer(overlay, 'pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY: 120 })
  fireEvent.click(overlay, { clientX, clientY: 120 })
}

function dispatchPointer(target: Element, type: string, init: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, Object.fromEntries(
    Object.entries(init).map(([key, value]) => [key, { configurable: true, value }]),
  ))
  fireEvent(target, event)
}

afterEach(() => cleanup())

describe('session viewer morph chart', () => {
  it('caches interaction bounds during steady pointer movement', async () => {
    const { container } = render(<Harness />)
    const svg = container.querySelector('svg')
    const overlay = container.querySelector('rect[fill="transparent"]') as SVGRectElement | null
    if (!svg || !overlay) throw new Error('chart interaction nodes not found')
    const measure = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 400,
      right: 1000,
      bottom: 400,
    }))
    Object.defineProperty(overlay, 'getBoundingClientRect', {
      configurable: true,
      value: measure,
    })

    fireEvent.pointerEnter(overlay, { clientX: 120, clientY: 120 })
    for (const clientX of [120, 180, 240, 300, 360]) {
      fireEvent.mouseMove(overlay, { clientX, clientY: 120 })
    }
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('hover-preview'))

    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('reports the responsive rendered plot width after matching the viewBox to CSS pixels', async () => {
    const { container } = render(<Harness />)
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('chart svg not found')
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 480, height: 400, right: 480, bottom: 400 }),
    })
    fireEvent(window, new Event('resize'))
    await waitFor(() => {
      expect(svg.getAttribute('viewBox')).toBe('0 0 480 400')
      expect(svg.getAttribute('data-viewer-plot-css-width')).toBe('392.00')
    })
  })

  it('keeps immutable detail d while hover only changes clip widths and preserves historical line focus', async () => {
    const { container } = render(<Harness />)
    const { svg, overlay } = chartNodes(container)
    const idle = container.querySelector('[data-viewer-layer="idle"]')
    const before = container.querySelector('[data-viewer-layer="before-cursor"]') as SVGPathElement | null
    const after = container.querySelector('[data-viewer-layer="after-cursor"]') as SVGPathElement | null
    const cursor = container.querySelector('[data-viewer-layer="cursor"]')
    expect(idle).not.toBeNull()
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(cursor).not.toBeNull()
    expect(container.querySelectorAll('[data-viewer-layer="idle"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-viewer-layer="before-cursor"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-viewer-layer="after-cursor"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-viewer-layer="cursor"]')).toHaveLength(1)
    const detailD = before?.getAttribute('d')
    const clipRects = Array.from(container.querySelectorAll('[data-viewer-clip]')) as SVGRectElement[]
    const restWidths = clipRects.map(rect => rect.getAttribute('width'))

    fireEvent.mouseMove(overlay, { clientX: 680, clientY: 120 })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('hover-preview'))
    expect(before?.getAttribute('d')).toBe(detailD)
    expect(after?.getAttribute('d')).toBe(detailD)
    // Inspection keeps one active hue while reducing the later portion's
    // optical weight, matching the activity-lane future fade.
    expect(Number(after?.getAttribute('opacity'))).toBeLessThan(0.85)
    expect(Number(after?.getAttribute('opacity'))).toBeGreaterThan(0.2)
    expect(container.querySelector('[data-activity-future-fade="true"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('[data-viewer-clip]')).map(rect => rect.getAttribute('width'))).not.toEqual(restWidths)

    for (const clientX of [140, 820, 460]) {
      fireEvent.mouseMove(overlay, { clientX, clientY: 120 })
      await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('hover-preview'))
      expect(before?.getAttribute('d')).toBe(detailD)
      expect(after?.getAttribute('d')).toBe(detailD)
    }

    fireEvent.mouseLeave(overlay)
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('rest'))
    const restBefore = container.querySelector('[data-viewer-layer="before-cursor"]') as SVGPathElement | null
    const restAfter = container.querySelector('[data-viewer-layer="after-cursor"]') as SVGPathElement | null
    expect(restBefore?.getAttribute('d')).toBe(detailD)
    expect(restBefore?.getAttribute('opacity')).toBe('0')
    expect(restAfter?.getAttribute('opacity')).toBe('0')

    pointerClick(overlay, 350)
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('locked'))
    fireEvent.mouseLeave(overlay)
    expect(svg.getAttribute('data-viewer-state')).toBe('locked')
    expect(before?.getAttribute('opacity')).toBe('0.85')
  })

  it('unlocks with the same bucket and Escape', async () => {
    const { container } = render(<Harness />)
    const { svg, overlay } = chartNodes(container)

    pointerClick(overlay, 350)
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('locked'))
    pointerClick(overlay, 350)
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('rest'))

    pointerClick(overlay, 680)
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('locked'))
    fireEvent.keyDown(svg, { key: 'Escape' })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('rest'))
  })

  it('lets exact-offset hosts own a click without a second rollup selection', () => {
    const onSelectOffset = vi.fn()
    const onSelectRollup = vi.fn()
    const { container } = render(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt={rollups[0]?.minuteTs}
        onSelectOffset={onSelectOffset}
        onSelectRollup={onSelectRollup}
        motionEnabled={false}
      />,
    )
    const { overlay } = chartNodes(container)

    pointerClick(overlay, 350)

    expect(onSelectOffset).toHaveBeenCalledOnce()
    expect(onSelectRollup).not.toHaveBeenCalled()
  })

  it('commits horizontal scrub release and suppresses its synthetic click', async () => {
    const { container } = render(<Harness />)
    const { svg, overlay } = chartNodes(container)
    const before = container.querySelector('[data-viewer-layer="before-cursor"]')
    const detailD = before?.getAttribute('d')

    dispatchPointer(overlay, 'pointerdown', { pointerId: 4, pointerType: 'touch', button: 0, clientX: 0, clientY: 120 })
    dispatchPointer(overlay, 'pointermove', { pointerId: 4, pointerType: 'touch', clientX: 720, clientY: 122 })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('scrub'))
    expect(before?.getAttribute('d')).toBe(detailD)
    dispatchPointer(overlay, 'pointerup', { pointerId: 4, pointerType: 'touch', clientX: 720, clientY: 122 })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('locked'))
    expect(before?.getAttribute('d')).toBe(detailD)
    fireEvent.click(overlay, { clientX: 720, clientY: 122 })
    expect(svg.getAttribute('data-viewer-state')).toBe('locked')
  })

  it('cancels vertical gestures without committing a selection', async () => {
    const { container } = render(<Harness />)
    const { svg, overlay } = chartNodes(container)

    dispatchPointer(overlay, 'pointerdown', { pointerId: 5, pointerType: 'touch', button: 0, clientX: 350, clientY: 100 })
    dispatchPointer(overlay, 'pointermove', { pointerId: 5, pointerType: 'touch', clientX: 352, clientY: 120 })
    dispatchPointer(overlay, 'pointerup', { pointerId: 5, pointerType: 'touch', clientX: 352, clientY: 120 })
    fireEvent.click(overlay, { clientX: 352, clientY: 120 })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('rest'))
  })

  it('cancels pointercancel gestures without committing a selection', async () => {
    const { container } = render(<Harness />)
    const { svg, overlay } = chartNodes(container)

    dispatchPointer(overlay, 'pointerdown', { pointerId: 6, pointerType: 'touch', button: 0, clientX: 350, clientY: 100 })
    dispatchPointer(overlay, 'pointercancel', { pointerId: 6, pointerType: 'touch', clientX: 350, clientY: 100 })
    fireEvent.click(overlay, { clientX: 350, clientY: 100 })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('rest'))
  })

  it('grows the SVG detail viewport while toggling plot overlays and selection', async () => {
    const compact = render(<Harness compact />)
    const { svg, overlay } = chartNodes(compact.container)
    const rootClass = compact.container.querySelector('.sc-chart-root')?.getAttribute('class')
    const collapsedViewBox = svg.getAttribute('viewBox')

    fireEvent.click(screen.getByRole('button', { name: /show reaction and spike markers/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset' })).not.toBeNull())
    await waitFor(() => expect(svg.getAttribute('viewBox')).not.toBe(collapsedViewBox))
    pointerClick(overlay, 680)
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('locked'))

    expect(compact.container.querySelector('.sc-chart-root')?.getAttribute('class')).toBe(rootClass)
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 520')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(svg.getAttribute('viewBox')).toBe(collapsedViewBox))
    compact.unmount()
  })

  it('keeps keyboard navigation and Expand available', async () => {
    const compact = render(<Harness compact />)
    const { svg } = chartNodes(compact.container)
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('hover-preview'))
    fireEvent.keyDown(svg, { key: 'Enter' })
    await waitFor(() => expect(svg.getAttribute('data-viewer-state')).toBe('locked'))
    expect(screen.getByRole('button', { name: 'Expand' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByRole('button', { name: 'Reset' })).not.toBeNull()
    compact.unmount()
  })
})
