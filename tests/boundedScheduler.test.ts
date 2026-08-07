import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoundedScheduler } from '../src/content/boundedScheduler.ts'

describe('createBoundedScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces mutation bursts without extending the deadline', async () => {
    const callback = vi.fn()
    const scheduler = createBoundedScheduler(callback, 500)

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(200)
    scheduler.schedule()
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(299)
    expect(callback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending check and allows a later check to be scheduled', async () => {
    const callback = vi.fn()
    const scheduler = createBoundedScheduler(callback, 500)

    scheduler.schedule()
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(500)
    expect(callback).not.toHaveBeenCalled()

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
