import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: true }),
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('accumulates gentle animated wheel input while keeping drag release immediate', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++id, callback)
    return id
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key) })
  const flush = (elapsed = 0) => act(() => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(performance.now() + elapsed))
  })
  const detail = {
    stream: { streamId: 'navigation-test', startedAt: '2026-07-31T00:00:00Z' },
    rollups: Array.from({ length: 91 }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-31T00:00:00Z') + index * 60000).toISOString(),
      viewerAvg: 100, chatCount: 10, totalEmoteCount: 2, emotes: {},
    })),
    topEmotes: [], sources: [],
  } as unknown as AnalyticsStreamDetail
  const { container } = render(<AnalyticsChart detail={detail} selectedEmotes={new Set()}
    onSelectEmote={vi.fn()} selectedRollup={null} onSelectRollup={vi.fn()}
    viewMode="overview" onViewModeChange={vi.fn()} />)
  const plot = container.querySelector('[data-chart-touch-action]')!
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect)
  const range = () => [Number(plot.getAttribute('data-chart-viewport-start')), Number(plot.getAttribute('data-chart-viewport-end'))]
  const initial = range()
  const wheel = (deltaY: number) => fireEvent.wheel(plot, { deltaY, clientX: 500 })
  wheel(-100)
  wheel(-100)
  wheel(-100)
  flush()
  expect(range()).toEqual(initial)
  flush(60)
  const intermediate = range()
  expect(intermediate[1] - intermediate[0]).toBeLessThan(initial[1] - initial[0])
  flush(150)
  const burst = range()
  expect(burst[1] - burst[0]).toBeLessThan((initial[1] - initial[0]) * 0.8)
  expect(burst[1] - burst[0]).toBeGreaterThan((initial[1] - initial[0]) * 0.6)
  expect((burst[0] + burst[1]) / 2).toBeCloseTo((initial[0] + initial[1]) / 2)
  flush()
  expect(range()).toEqual(burst)
  wheel(100)
  flush()
  flush(150)
  expect(range()[1] - range()[0]).toBeGreaterThan(burst[1] - burst[0])

  vi.stubGlobal('PointerEvent', MouseEvent)
  const beforeDrag = range()
  fireEvent.pointerDown(plot, { clientX: 500, clientY: 100, button: 0 })
  fireEvent.pointerMove(plot, { clientX: 550, clientY: 100 })
  fireEvent.pointerMove(plot, { clientX: 600, clientY: 100 })
  // Release before rAF must publish the last pending movement immediately.
  fireEvent.pointerUp(plot, { clientX: 600, clientY: 100 })
  const released = range()
  expect(released[0]).toBeLessThan(beforeDrag[0])
  expect(released[1] - released[0]).toBeCloseTo(beforeDrag[1] - beforeDrag[0])
  flush()
  expect(range()).toEqual(released)
})
