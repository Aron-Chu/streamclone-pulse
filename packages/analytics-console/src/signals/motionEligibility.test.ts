import { describe, expect, it } from 'vitest'

import { getVerifiedTransition, isVerifiedSignalValue } from './motionEligibility'
import type { SignalValue } from './signalTypes'

const measured = (value: number): SignalValue => ({
  metric: 'chat',
  value,
  state: value === 0 ? 'measured_zero' : 'measured',
  observedAt: '2026-07-11T18:00:00.000Z',
})

describe('motion eligibility', () => {
  it('accepts only verified finite measured values', () => {
    expect(isVerifiedSignalValue(measured(0))).toBe(true)
    expect(isVerifiedSignalValue(measured(12))).toBe(true)
    expect(isVerifiedSignalValue({ ...measured(12), state: 'partial' })).toBe(false)
    expect(isVerifiedSignalValue({ ...measured(12), value: Number.NaN })).toBe(false)
    expect(isVerifiedSignalValue({ ...measured(12), observedAt: null })).toBe(false)
  })

  it('returns a transition only for comparable values of one metric', () => {
    expect(getVerifiedTransition(measured(10), measured(20))).toEqual({
      fromValue: 10,
      toValue: 20,
      delta: 10,
    })
    expect(getVerifiedTransition(measured(10), { ...measured(20), metric: 'emotes' })).toBeNull()
    expect(getVerifiedTransition(measured(10), { ...measured(20), state: 'stale' })).toBeNull()
  })
})
