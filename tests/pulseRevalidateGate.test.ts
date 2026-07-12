import { describe, expect, it } from 'vitest'
import {
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
})
