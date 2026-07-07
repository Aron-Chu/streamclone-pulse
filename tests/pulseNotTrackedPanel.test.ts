import { describe, expect, it } from 'vitest'
import { pulseNotTrackedCopy } from '../src/ui/PulseNotTrackedPanel.tsx'

describe('pulseNotTrackedCopy', () => {
  it('includes login and scale-back messaging', () => {
    const copy = pulseNotTrackedCopy('smallstreamer')
    expect(copy.title).toBe('Not tracked live')
    expect(copy.body).toContain('smallstreamer')
    expect(copy.body).toMatch(/IRC pool/i)
    expect(copy.body).toMatch(/scale capacity/i)
  })
})
