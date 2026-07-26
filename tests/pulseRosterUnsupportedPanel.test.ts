import { describe, expect, it } from 'vitest'
import { pulseRosterUnsupportedCopy } from '../src/ui/PulseRosterUnsupportedPanel.tsx'

describe('pulseRosterUnsupportedCopy', () => {
  it('uses roster language without a fixed channel count', () => {
    const copy = pulseRosterUnsupportedCopy('kaicenat')
    expect(copy.title).toBe('Outside tracked roster')
    expect(copy.body).toContain('kaicenat')
    expect(copy.body).toMatch(/actively tracked channel roster/i)
    expect(copy.body).not.toMatch(/top.?500/i)
    expect(copy.footer).toMatch(/added to the roster later/i)
  })
})
