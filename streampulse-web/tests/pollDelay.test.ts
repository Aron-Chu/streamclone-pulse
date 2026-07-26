import { describe, expect, it } from 'vitest'
import { computeJitteredDelayMs, parseRetryAfterMs } from '../src/lib/pollDelay'

describe('pollDelay', () => {
  it('applies ±15% jitter on success path', () => {
    const d = computeJitteredDelayMs(40_000, 0, () => 1)
    expect(d).toBeGreaterThanOrEqual(40_000)
    expect(d).toBeLessThanOrEqual(46_000)
  })

  it('floors first failure delay at healthy cadence (never faster)', () => {
    expect(computeJitteredDelayMs(45_000, 1, () => 0.5)).toBe(45_000)
    const withNegJitter = computeJitteredDelayMs(45_000, 1, () => 0)
    expect(withNegJitter).toBeGreaterThanOrEqual(45_000)
  })

  it('exponentially increases failure delays from healthy cadence', () => {
    expect(computeJitteredDelayMs(45_000, 2, () => 0.5)).toBe(90_000)
    expect(computeJitteredDelayMs(45_000, 3, () => 0.5)).toBe(120_000) // capped
  })

  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000)
    expect(parseRetryAfterMs('0')).toBe(1_000)
  })
})
