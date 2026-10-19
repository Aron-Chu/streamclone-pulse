import { describe, expect, it } from 'vitest'
import { pulseNotTrackedCopy } from '../src/ui/PulseNotTrackedPanel.tsx'

describe('pulseNotTrackedCopy', () => {
  it('says there is no live chart and why, in plain words', () => {
    const copy = pulseNotTrackedCopy('smallstreamer')
    expect(copy.title).toBe('Not tracked live')
    expect(copy.body).toContain('smallstreamer’s chat')
    expect(copy.body).toMatch(/no live chart/i)
    expect(copy.body).toMatch(/limited number of live channels/i)
    expect(copy.body).not.toMatch(/\bIRC\b|pool|rollup/i)
  })
})
