import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HubActivityChart } from '../src/ui/components/hub/HubActivityChart'

const firstBucketT = Math.floor(Date.now() / 60_000) * 60_000 - 60_000

const points = [
  {
    t: firstBucketT,
    chat: 24,
    seventv: 8,
    viewers: 120,
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
  },
  {
    t: firstBucketT + 60_000,
    chat: 18,
    seventv: 5,
    viewers: 90,
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
  },
]

type PointerEventType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel'

function dispatchPointerEvent(
  target: HTMLElement,
  type: PointerEventType,
  init: { pointerId: number; pointerType: string; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: 0 },
  })
  fireEvent(target, event)
}

function dispatchWheelEvent(target: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  fireEvent(target, event)
  return event
}

describe('HubActivityChart interaction contract', () => {
  it('exposes an interactive chart group with hidden geometry and accessible 44px marker controls', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        momentMarkers={[{ key: 'moment-1', bucketT: firstBucketT, kind: 'emote_spike' }]}
        onSelectMomentKey={onSelect}
      />,
    )
    const chart = container.querySelector<HTMLElement>('.hx-chart2')!
    expect(chart.getAttribute('role')).toBe('group')
    expect(chart.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    const marker = chart.querySelector<HTMLButtonElement>('[data-chart-marker-key="moment-1"]')!
    expect(marker.getAttribute('aria-label')).toMatch(/Signal marker/i)
    expect(marker.style.minWidth).toBe('44px')
    expect(marker.style.minHeight).toBe('44px')
    fireEvent.click(marker)
    expect(onSelect).toHaveBeenCalledWith('moment-1')
  })

  it('keeps one viewer foreground and keeps hover detail out of the plot', () => {
    const { container } = render(
      <HubActivityChart points={points} windowMinutes={2} channelCount={1} />,
    )

    // Viewers and emotes/min are independent line signals. Chat/min is the
    // only bar series; unlike units must never be stacked as one total.
    expect(container.querySelectorAll('.hx-chart-line--viewers').length).toBeGreaterThan(0)
    expect(
      container.querySelectorAll('[data-component="HubActivityBarSeries"] .hx-chat-bar').length,
    ).toBeGreaterThan(0)
    expect(container.querySelectorAll('.hx-chart-line--emotes').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.hx-bar-segment--viewers, .hx-bar-segment--emotes')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-line--chat')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-moment-marker')).toHaveLength(0)
    expect(container.querySelectorAll('.hdot')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-bucket-cue__node, .hx-bucket-cue__ring')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-line--chat-detail')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-tip-slot .tip')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-header__readout')).toHaveLength(1)
  })

  it('keeps viewers, chat, and emotes in one shared plot and time domain', () => {
    const { container } = render(
      <HubActivityChart points={points} windowMinutes={2} channelCount={1} />,
    )

    const chart = container.querySelector('.hx-chart2')
    const viewerPath = container.querySelector('.hx-chart-line--viewers')
    const bars = Array.from(container.querySelectorAll('[data-component="HubActivityBarSeries"] .hx-chat-bar'))
    const viewerCoordinates = viewerPath?.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []
    const viewerYs = viewerCoordinates
      .filter((_, index) => index % 2 === 1)
      .map(Number)

    expect(chart?.getAttribute('data-chart-layout')).toBe('viewer-lane')
    expect(viewerYs.length).toBeGreaterThan(0)
    expect(bars.length).toBeGreaterThan(0)
    expect(viewerYs.every((y) => y >= 6 && y <= 48)).toBe(true)
    expect(bars.every((bar) => Number(bar.getAttribute('y')) >= 58)).toBe(true)
    const emoteCoordinates = container.querySelector('.hx-chart-line--emotes')?.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []
    expect(emoteCoordinates.filter((_, index) => index % 2 === 1).map(Number).every((y) => y >= 58 && y <= 92)).toBe(true)
    const viewerXs = viewerCoordinates.filter((_, index) => index % 2 === 0).map(Number)
    expect(viewerXs).toEqual(emoteCoordinates.filter((_, index) => index % 2 === 0).map(Number))
  })

  it('dims unfocused series on legend click without restoring cue nodes', () => {
    const { container } = render(
      <HubActivityChart points={points} windowMinutes={2} channelCount={1} />,
    )

    const viewers = container.querySelector('.hx-legend-chip')
    expect(viewers).not.toBeNull()
    fireEvent.click(viewers!)

    expect(container.querySelector('.hx-series.is-dimmed')).not.toBeNull()
    expect(container.querySelector('.hx-series.is-dimmed .hx-chart-line--viewers')).toBeNull()
    expect(container.querySelectorAll('.hx-bucket-cue__node, .hx-bucket-cue__ring')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-moment-marker')).toHaveLength(0)
  })

  it('selects the nearest signal bucket and toggles the selected bucket off', () => {
    const onBucketSelect = vi.fn()
    const { container, rerender } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        onBucketSelect={onBucketSelect}
      />,
    )

    const chart = container.querySelector('.hx-chart2')
    expect(chart).not.toBeNull()

    fireEvent.click(chart!, { clientX: 0, clientY: 10 })
    expect(onBucketSelect).toHaveBeenLastCalledWith(firstBucketT)
    fireEvent.click(chart!, { clientX: 0, clientY: 300 })
    expect(onBucketSelect).toHaveBeenLastCalledWith(firstBucketT)

    rerender(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        selectedBucketT={firstBucketT}
        onBucketSelect={onBucketSelect}
      />,
    )

    fireEvent.click(chart!, { clientX: 0 })
    expect(onBucketSelect).toHaveBeenLastCalledWith(null)
  })

  it('updates the single header readout on hover and returns to calm after leaving', async () => {
    const { container } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        onBucketSelect={() => {}}
      />,
    )
    const chart = container.querySelector('.hx-chart2') as HTMLDivElement

    expect(chart.getAttribute('data-hover')).toBeNull()
    expect(container.querySelectorAll('.hx-chart-detail-layer')).toHaveLength(0)

    fireEvent.mouseMove(chart, { clientX: 0, clientY: 10 })

    await waitFor(() => expect(chart.getAttribute('data-hover')).toBe('true'))
    expect(container.querySelector('.hx-chart-header__readout')?.textContent).toContain('Viewers')
    expect(container.querySelector('.hx-detail-readout')).toBeNull()

    fireEvent.pointerLeave(chart)
    expect(chart.getAttribute('data-hover')).toBeNull()
    expect(container.querySelector('.hx-chart-header__readout')?.getAttribute('data-active')).toBeNull()
    expect(Array.from(container.querySelectorAll('.hx-hover-metrics strong')).map(el => el.textContent)).toEqual(['—', '—', '—'])
  })

  it('keeps the selected bucket in the chart readout after hover ends', async () => {
    const { container } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        selectedBucketT={firstBucketT}
      />,
    )
    const chart = container.querySelector('.hx-chart2') as HTMLDivElement
    const readout = container.querySelector('.hx-chart-header__readout')!
    expect(readout.getAttribute('data-active')).toBe('true')
    expect(readout.textContent).toContain('Selected bucket')
    expect(readout.textContent).not.toContain('No interval selected')
    const values = Array.from(readout.querySelectorAll('.hx-hover-metrics strong')).map(el => el.textContent)
    expect(values[0]).toContain('120')
    expect(values.slice(1)).toEqual(['24', '8'])

    fireEvent.mouseMove(chart, { clientX: 0, clientY: 10 })
    await waitFor(() => expect(readout.textContent).toContain('Hover preview'))
    fireEvent.pointerLeave(chart)
    expect(readout.textContent).toContain('Selected bucket')
    expect(readout.textContent).not.toContain('Hover preview')
  })

  it('words the status for the input used, including touch on a fine-pointer device', async () => {
    const { container } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        selectedBucketT={firstBucketT}
        onBucketSelect={vi.fn()}
      />,
    )
    const chart = container.querySelector('.hx-chart2') as HTMLDivElement
    const status = () => container.querySelector('.hx-hover-status')?.textContent ?? ''
    expect(status()).toContain('click another interval')

    dispatchPointerEvent(chart, 'pointerdown', { pointerId: 31, pointerType: 'touch', clientX: 0, clientY: 0 })
    await waitFor(() => expect(chart.getAttribute('data-hover')).toBe('true'))
    expect(status()).toContain('tap another interval')
    expect(status()).not.toContain('Hover preview')
    dispatchPointerEvent(chart, 'pointercancel', { pointerId: 31, pointerType: 'touch', clientX: 0, clientY: 0 })

    dispatchPointerEvent(chart, 'pointermove', { pointerId: 32, pointerType: 'mouse', clientX: 0, clientY: 10 })
    fireEvent.mouseMove(chart, { clientX: 0, clientY: 10 })
    await waitFor(() => expect(status()).toContain('Hover preview'))
  })

  it('shows incompatible viewers as unavailable while retaining measured reaction readouts', async () => {
    const { container } = render(<HubActivityChart
      points={points.map(p => ({...p, viewers: 0, hasViewerRollup: false, viewerCoverage: 'unknown', viewerSourceMismatch: true, hasChatRollup: true}))}
      windowMinutes={2} channelCount={1}
    />)
    const chart = container.querySelector('.hx-chart2') as HTMLDivElement
    fireEvent.mouseMove(chart, {clientX: 0, clientY: 10})
    await waitFor(() => expect(chart.getAttribute('data-hover')).toBe('true'))
    expect(container.querySelector('.hx-hover-status')?.textContent).toContain('snapshot unavailable')
    const values = Array.from(container.querySelectorAll('.hx-hover-metrics strong')).map(el => el.textContent)
    expect(values[0]).toBe('—')
    expect(values[1]).not.toBe('—')
    expect(values[2]).not.toBe('—')
    expect(container.querySelector('.tip')).toBeNull()
  })

  it('commits a pointer release but preserves vertical touch scrolling', () => {
    const onBucketSelect = vi.fn()
    const { container } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        onBucketSelect={onBucketSelect}
      />,
    )
    const chart = container.querySelector('.hx-chart2') as HTMLDivElement

    dispatchPointerEvent(chart, 'pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
    })
    expect(onBucketSelect).not.toHaveBeenCalled()
    dispatchPointerEvent(chart, 'pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 1,
      clientY: 10,
    })
    expect(onBucketSelect).not.toHaveBeenCalled()
    dispatchPointerEvent(chart, 'pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 1,
      clientY: 10,
    })

    expect(onBucketSelect).not.toHaveBeenCalled()

    dispatchPointerEvent(chart, 'pointerdown', {
      pointerId: 8,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
    })
    dispatchPointerEvent(chart, 'pointerup', {
      pointerId: 8,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
    })

    expect(onBucketSelect).toHaveBeenCalledWith(firstBucketT)
    fireEvent.click(chart, { clientX: 0 })
    expect(onBucketSelect).toHaveBeenCalledTimes(1)
  })

  it('uses the shared selection path for keyboard commit and keeps selection calm', () => {
    const onBucketSelect = vi.fn()
    const { container, rerender } = render(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        onBucketSelect={onBucketSelect}
      />,
    )
    const chart = container.querySelector('.hx-chart2') as HTMLDivElement

    chart.focus()
    fireEvent.keyDown(chart, { key: 'End' })
    fireEvent.keyDown(chart, { key: 'Enter' })
    expect(onBucketSelect).toHaveBeenCalledWith(firstBucketT + 60_000)

    rerender(
      <HubActivityChart
        points={points}
        windowMinutes={2}
        channelCount={1}
        selectedBucketT={firstBucketT + 60_000}
        onBucketSelect={onBucketSelect}
      />,
    )
    expect(chart.getAttribute('data-hover')).toBeNull()
  })

  it('provides a flush keyboard navigator that resets without changing the server range', () => {
    const navigatorPoints = Array.from({ length: 6 }, (_, index) => ({
      ...points[0],
      t: firstBucketT + index * 60_000,
      viewers: 120 + index * 10,
    }))
    const onRangeSelect = vi.fn()
    const { container } = render(<HubActivityChart
      points={navigatorPoints}
      windowMinutes={6}
      channelCount={1}
      rangeControl={{
        active: '24h',
        options: [{ key: '30m', label: '30m' }, { key: '24h', label: '24h' }, { key: '7d', label: '7d' }],
        onSelect: onRangeSelect,
      }}
    />)
    const navigator = container.querySelector('[data-hub-chart-navigator]') as HTMLElement
    const start = navigator.querySelector('[role="slider"][aria-label="Chart view start"]') as HTMLButtonElement
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:5')
    expect(navigator.querySelector('.hx-chart-navigator__controls')).toBeNull()
    expect(navigator.querySelector('[data-hub-chart-preset]')).toBeNull()
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:5')
    expect(container.querySelector('.hx-plot-stack')?.getAttribute('data-hub-chart-viewport-start')).toBe('1')
    expect(onRangeSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(start, { key: 'Escape' })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:5')
    expect(onRangeSelect).not.toHaveBeenCalled()
  })

  it('offers visible centered zoom controls without changing the server range', () => {
    const navigatorPoints = Array.from({ length: 16 }, (_, index) => ({
      ...points[0],
      t: firstBucketT + index * 60_000,
    }))
    const onRangeSelect = vi.fn()
    const onBucketSelect = vi.fn()
    const { container, getByRole } = render(<HubActivityChart
      points={navigatorPoints}
      windowMinutes={16}
      channelCount={1}
      onBucketSelect={onBucketSelect}
      rangeControl={{
        active: '24h',
        options: [{ key: '24h', label: '24h' }],
        onSelect: onRangeSelect,
      }}
    />)
    const navigator = container.querySelector('[data-hub-chart-navigator]') as HTMLElement
    const zoomIn = getByRole('button', { name: 'Zoom in' })
    const zoomOut = getByRole('button', { name: 'Zoom out' })
    const reset = getByRole('button', { name: 'Reset zoom' })
    expect(navigator.textContent).toContain('16 of 16 buckets')
    expect(zoomOut.hasAttribute('disabled')).toBe(true)
    fireEvent.click(zoomIn)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('4:11')
    expect(navigator.textContent).toContain('8 of 16 buckets')
    fireEvent.click(zoomIn)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('6:9')
    fireEvent.click(zoomOut)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('4:11')
    fireEvent.click(reset)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:15')
    expect(onRangeSelect).not.toHaveBeenCalled()
    expect(onBucketSelect).not.toHaveBeenCalled()
  })

  it('zooms toward a selected bucket at the edge of the loaded range', () => {
    const navigatorPoints = Array.from({ length: 16 }, (_, index) => ({
      ...points[0],
      t: firstBucketT + index * 60_000,
    }))
    const { container, getByRole } = render(<HubActivityChart
      points={navigatorPoints}
      windowMinutes={16}
      channelCount={1}
      selectedBucketT={firstBucketT}
    />)
    const navigator = container.querySelector('[data-hub-chart-navigator]') as HTMLElement
    fireEvent.click(getByRole('button', { name: 'Zoom in' }))
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:7')
    expect(container.querySelector('.hx-hover-status')?.textContent).not.toContain('outside the zoomed view')
  })

  it('focuses, pans, resizes both handles, and restores the committed viewport on cancellation', () => {
    const navigatorPoints = Array.from({ length: 6 }, (_, index) => ({ ...points[0], t: firstBucketT + index * 60_000 }))
    const { container } = render(<HubActivityChart points={navigatorPoints} windowMinutes={6} channelCount={1} />)
    const navigator = container.querySelector('[data-hub-chart-navigator]') as HTMLElement
    const track = navigator.querySelector('.hx-chart-navigator__track') as HTMLDivElement
    const window = navigator.querySelector('.hx-chart-navigator__window') as HTMLElement
    const start = navigator.querySelector('[aria-label="Chart view start"]') as HTMLButtonElement
    const end = navigator.querySelector('[aria-label="Chart view end"]') as HTMLButtonElement
    Object.defineProperty(track, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, right: 500, top: 0, bottom: 44, width: 500, height: 44, x: 0, y: 0, toJSON: () => ({}) }),
    })
    dispatchPointerEvent(window, 'pointerdown', { pointerId: 21, pointerType: 'mouse', clientX: 100, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointermove', { pointerId: 21, pointerType: 'mouse', clientX: 400, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointerup', { pointerId: 21, pointerType: 'mouse', clientX: 400, clientY: 10 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:4')
    dispatchPointerEvent(window, 'pointerdown', { pointerId: 22, pointerType: 'touch', clientX: 250, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointermove', { pointerId: 22, pointerType: 'touch', clientX: 350, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointerup', { pointerId: 22, pointerType: 'touch', clientX: 350, clientY: 10 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('2:5')
    dispatchPointerEvent(start, 'pointerdown', { pointerId: 23, pointerType: 'mouse', clientX: 200, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointermove', { pointerId: 23, pointerType: 'mouse', clientX: 100, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointerup', { pointerId: 23, pointerType: 'mouse', clientX: 100, clientY: 10 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:5')
    dispatchPointerEvent(end, 'pointerdown', { pointerId: 24, pointerType: 'mouse', clientX: 400, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointermove', { pointerId: 24, pointerType: 'mouse', clientX: 0, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointerup', { pointerId: 24, pointerType: 'mouse', clientX: 0, clientY: 10 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:2')
    dispatchPointerEvent(window, 'pointerdown', { pointerId: 25, pointerType: 'mouse', clientX: 200, clientY: 10 })
    dispatchPointerEvent(navigator, 'pointermove', { pointerId: 25, pointerType: 'mouse', clientX: 300, clientY: 10 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('2:3')
    dispatchPointerEvent(navigator, 'pointercancel', { pointerId: 25, pointerType: 'mouse', clientX: 300, clientY: 10 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:2')
  })

  it('zooms around the cursor and pans with Shift+wheel from chart and navigator surfaces', () => {
    const navigatorPoints = Array.from({ length: 6 }, (_, index) => ({ ...points[0], t: firstBucketT + index * 60_000 }))
    const { container, getByRole } = render(<HubActivityChart points={navigatorPoints} windowMinutes={6} channelCount={1} />)
    const navigator = container.querySelector('[data-hub-chart-navigator]') as HTMLElement
    const track = navigator.querySelector('.hx-chart-navigator__track') as HTMLDivElement
    const chart = container.querySelector('[data-hub-chart-wheel-surface]') as HTMLElement
    const rect = { left: 0, right: 500, top: 0, bottom: 200, width: 500, height: 200, x: 0, y: 0, toJSON: () => ({}) }
    Object.defineProperty(track, 'getBoundingClientRect', { configurable: true, value: () => rect })
    Object.defineProperty(chart, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const plain = dispatchWheelEvent(chart, { deltaY: -120, clientX: 250 })
    expect(plain.defaultPrevented).toBe(false)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:5')
    const zoom = dispatchWheelEvent(chart, { deltaY: -120, deltaX: 0, deltaMode: 0, clientX: 250, altKey: true })
    expect(zoom.defaultPrevented).toBe(true)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:4')
    const pan = dispatchWheelEvent(track, { deltaY: 120, deltaX: 0, deltaMode: 0, shiftKey: true, clientX: 250 })
    expect(pan.defaultPrevented).toBe(true)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('2:5')
    const browserZoom = dispatchWheelEvent(chart, { deltaY: -120, ctrlKey: true, clientX: 250 })
    expect(browserZoom.defaultPrevented).toBe(false)
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('2:5')

    dispatchPointerEvent(chart, 'pointerdown', { pointerId: 31, pointerType: 'mouse', clientX: 250, clientY: 40 })
    dispatchPointerEvent(chart, 'pointermove', { pointerId: 31, pointerType: 'mouse', clientX: 375, clientY: 40 })
    dispatchPointerEvent(chart, 'pointerup', { pointerId: 31, pointerType: 'mouse', clientX: 375, clientY: 40 })
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('1:4')

    fireEvent.click(getByRole('button', { name: 'Reset zoom' }))
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:5')
  })
})


it('preserves inspected timestamps when polling advances the grid', async () => {
  const end = Math.floor(Date.now() / 60000) * 60000 - 120000
  const samples = Array.from({ length: 30 }, (_, i) => ({ t: end - (29-i)*60000, viewers: 100+i, chat: 10+i, seventv: 5, hasViewerRollup: true, hasChatRollup: true, bucketComplete: true }))
  const view = render(<HubActivityChart points={samples} windowMinutes={30} channelCount={1} />)
  const start = view.getByRole('slider', { name: 'Chart view start' })
  const finish = view.getByRole('slider', { name: 'Chart view end' })
  fireEvent.keyDown(start, { key: 'ArrowRight' })
  fireEvent.keyDown(finish, { key: 'ArrowLeft' })
  const stack = view.container.querySelector('.hx-plot-stack')!
  const beforeStart = Number(stack.getAttribute('data-hub-chart-viewport-start'))
  const beforeEnd = Number(stack.getAttribute('data-hub-chart-viewport-end'))
  view.rerender(<HubActivityChart points={[...samples.slice(1), { ...samples[29], t: end + 60000 }]} windowMinutes={30} channelCount={1} />)
  await waitFor(() => expect(Number(stack.getAttribute('data-hub-chart-viewport-start'))).toBe(beforeStart - 1))
  expect(Number(stack.getAttribute('data-hub-chart-viewport-end'))).toBe(beforeEnd - 1)
})
