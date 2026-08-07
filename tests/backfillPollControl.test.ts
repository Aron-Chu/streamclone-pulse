import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackfillPollControl } from '../src/ui/backfillPollControl.ts'

describe('createBackfillPollControl', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves a pending delay as cancelled and invalidates its generation', async () => {
    const control = createBackfillPollControl()
    const generation = control.begin()
    const wait = control.wait(generation, 2_000)

    control.cancel()

    await expect(wait).resolves.toBe(false)
    expect(control.isCurrent(generation)).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
  })

  it('only lets the newest generation continue polling', async () => {
    const control = createBackfillPollControl()
    const first = control.begin()
    const firstWait = control.wait(first, 2_000)
    const second = control.begin()
    const secondWait = control.wait(second, 2_000)

    await expect(firstWait).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(secondWait).resolves.toBe(true)
    expect(control.isCurrent(first)).toBe(false)
    expect(control.isCurrent(second)).toBe(true)
  })
})
