import { describe, expect, it } from 'vitest'
import { panDeltaSecondsFromPointer } from '../src/ui/chartPanMath.ts'

describe('chart pointer pan math', () => {
  it('reveals earlier history when the plot is dragged right', () => {
    expect(panDeltaSecondsFromPointer(30, 600, 300)).toBe(-60)
  })

  it('uses the visible viewport rather than the full stream for scale', () => {
    expect(panDeltaSecondsFromPointer(-15, 120, 300)).toBe(6)
  })

  it('returns no movement for invalid geometry', () => {
    expect(panDeltaSecondsFromPointer(30, 0, 300)).toBe(0)
    expect(panDeltaSecondsFromPointer(30, 600, 0)).toBe(0)
  })
})
