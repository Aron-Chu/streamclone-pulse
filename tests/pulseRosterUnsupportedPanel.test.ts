import { describe, expect, it } from 'vitest'
import { pulseRosterUnsupportedCopy } from '../src/ui/PulseRosterUnsupportedPanel.tsx'

describe('pulseRosterUnsupportedCopy', () => {
  it('says the channel is not on the tracked list, without a fixed channel count', () => {
    const copy = pulseRosterUnsupportedCopy('kaicenat')
    expect(copy.title).toBe('Not on the tracked list')
    expect(copy.body).toContain('kaicenat')
    expect(copy.body).toMatch(/no live chart/i)
    expect(copy.body).not.toMatch(/top.?500/i)
    expect(copy.body).not.toMatch(/\bIRC\b|roster|rollup/i)
    expect(copy.footer).toBe('Check back later.')
  })
})
