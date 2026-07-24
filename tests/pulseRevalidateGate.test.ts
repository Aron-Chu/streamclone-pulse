import { describe, expect, it } from 'vitest'
import {
  coalesceInFlight,
  PULSE_REVALIDATE_FAILURE_COOLDOWN_MS,
  PULSE_REVALIDATE_MIN_GAP_MS,
  shouldAllowPulseRevalidate,
} from '../src/background/pulseRevalidateGate.ts'

describe('shouldAllowPulseRevalidate', () => {
  it('allows the first revalidate when there is no prior timestamp', () => {
    expect(shouldAllowPulseRevalidate(undefined, 10_000)).toBe(true)
  })

  it('blocks revalidate inside the debounce gap', () => {
    const last = 10_000
    expect(shouldAllowPulseRevalidate(last, last + PULSE_REVALIDATE_MIN_GAP_MS - 1)).toBe(false)
  })

  it('allows revalidate once the debounce gap elapses', () => {
    const last = 10_000
    expect(shouldAllowPulseRevalidate(last, last + PULSE_REVALIDATE_MIN_GAP_MS)).toBe(true)
  })

  it('force bypasses the debounce gap', () => {
    const last = 10_000
    expect(shouldAllowPulseRevalidate(last, last + 1, { force: true })).toBe(true)
  })

  it('blocks inside the failure cooldown even when success gap has elapsed', () => {
    const lastSuccess = 0
    const failedAt = 20_000
    expect(
      shouldAllowPulseRevalidate(lastSuccess, failedAt + 100, {
        lastFailureAtMs: failedAt,
        failureCooldownMs: PULSE_REVALIDATE_FAILURE_COOLDOWN_MS,
      }),
    ).toBe(false)
  })
})

describe('coalesceInFlight', () => {
  it('returns the same promise for concurrent callers', async () => {
    const map = new Map<string, Promise<string>>()
    let started = 0
    const p1 = coalesceInFlight(map, 'a', async () => {
      started += 1
      await new Promise(r => setTimeout(r, 10))
      return 'x'
    })
    const p2 = coalesceInFlight(map, 'a', async () => {
      started += 1
      return 'y'
    })
    expect(await p1).toBe('x')
    expect(await p2).toBe('x')
    expect(started).toBe(1)
  })
})
