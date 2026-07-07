import { describe, expect, it } from 'vitest'
import { isPulseTop500Supported } from '../src/ui/pulseEligibility.ts'
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

describe('isPulseTop500Supported', () => {
  it('allows legacy payloads without the field', () => {
    expect(isPulseTop500Supported(basePayload)).toBe(true)
  })

  it('blocks when top500Eligible is false', () => {
    expect(isPulseTop500Supported({ ...basePayload, top500Eligible: false })).toBe(false)
  })

  it('allows when top500Eligible is true', () => {
    expect(isPulseTop500Supported({ ...basePayload, top500Eligible: true })).toBe(true)
  })
})
