import { describe, expect, it } from 'vitest'
import { isPulseRosterEligible, isPulseTop500Supported } from '../src/ui/pulseEligibility.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

const basePayload: PulsePayload = {
  login: 'test',
  isLive: true,
  tracking: false,
  currentOffsetSeconds: 0,
  rollups: [],
  lanes: { composite: [], chat: [], sevenTv: [] },
  recap: null,
}

describe('isPulseRosterEligible', () => {
  it('allows legacy payloads without the field', () => {
    expect(isPulseRosterEligible(basePayload)).toBe(true)
  })

  it('blocks when rosterEligible is false', () => {
    expect(isPulseRosterEligible({ ...basePayload, rosterEligible: false })).toBe(false)
  })

  it('allows when rosterEligible is true', () => {
    expect(isPulseRosterEligible({ ...basePayload, rosterEligible: true })).toBe(true)
  })

  it('blocks when top500Eligible is false (legacy dual-read)', () => {
    expect(isPulseRosterEligible({ ...basePayload, top500Eligible: false })).toBe(false)
  })

  it('prefers rosterEligible over top500Eligible', () => {
    expect(isPulseRosterEligible({ ...basePayload, rosterEligible: true, top500Eligible: false })).toBe(true)
    expect(isPulseRosterEligible({ ...basePayload, rosterEligible: false, top500Eligible: true })).toBe(false)
  })
})

describe('isPulseTop500Supported (deprecated alias)', () => {
  it('matches isPulseRosterEligible', () => {
    expect(isPulseTop500Supported(basePayload)).toBe(isPulseRosterEligible(basePayload))
    expect(isPulseTop500Supported({ ...basePayload, top500Eligible: false })).toBe(false)
  })
})
