import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBoundedMeasureScheduler,
  SNAP_DEBOUNCE_MS,
  SNAP_MAX_LATENCY_MS,
} from '../src/content/twitchChat.ts'

describe('createBoundedMeasureScheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid schedules into one measure after the debounce', () => {
    vi.useFakeTimers()
    const measure = vi.fn()
    const scheduler = createBoundedMeasureScheduler(measure, {
      debounceMs: SNAP_DEBOUNCE_MS,
      maxLatencyMs: SNAP_MAX_LATENCY_MS,
      now: () => Date.now(),
      setTimeout: ((fn: TimerHandler, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0)
        return 1
      },
      cancelAnimationFrame: () => {},
    })

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    expect(measure).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SNAP_DEBOUNCE_MS)
    expect(measure).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('forces a measure within max latency even when mutations keep resetting debounce', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const measure = vi.fn()
    const scheduler = createBoundedMeasureScheduler(measure, {
      debounceMs: SNAP_DEBOUNCE_MS,
      maxLatencyMs: SNAP_MAX_LATENCY_MS,
      now: () => Date.now(),
      setTimeout: ((fn: TimerHandler, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0)
        return 1
      },
      cancelAnimationFrame: () => {},
    })

    const ticks = Math.ceil(SNAP_MAX_LATENCY_MS / (SNAP_DEBOUNCE_MS / 2)) + 2
    for (let i = 0; i < ticks; i++) {
      scheduler.schedule()
      vi.advanceTimersByTime(SNAP_DEBOUNCE_MS / 2)
    }

    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(Date.now()).toBeLessThan(4000)
    scheduler.dispose()
  })
})
