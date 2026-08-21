import { describe, expect, it } from 'vitest'
import { deviationBounds, deviationBoundsAreFlat } from '../src/ui/deviationHairlines.ts'

describe('deviationBounds', () => {
  it('brackets the smoothed core with the raw signal', () => {
    const bounds = deviationBounds([10, 2, 8], [5, 5, 5])
    expect(bounds.lower).toEqual([5, 2, 5])
    expect(bounds.upper).toEqual([10, 5, 8])
  })

  it('preserves gaps instead of bridging them', () => {
    const bounds = deviationBounds([10, null, 8], [5, 5, 5])
    expect(bounds.lower).toEqual([5, null, 5])
    expect(bounds.upper).toEqual([10, null, 8])
  })

  it('treats a missing smoothed value as a gap too', () => {
    const bounds = deviationBounds([10, 4], [5, null])
    expect(bounds.lower).toEqual([5, null])
    expect(bounds.upper).toEqual([10, null])
  })

  it('rejects non-finite samples', () => {
    const bounds = deviationBounds([Number.NaN, Number.POSITIVE_INFINITY], [5, 5])
    expect(bounds.lower).toEqual([null, null])
    expect(bounds.upper).toEqual([null, null])
  })

  it('keeps a rise the average flattened visible on the upper hairline', () => {
    const raw = [10, 10, 90, 10, 10]
    const smoothed = [10, 36, 36, 36, 10]
    const bounds = deviationBounds(raw, smoothed)
    expect(bounds.upper[2]).toBe(90)
    expect(bounds.upper[2]! - smoothed[2]!).toBeGreaterThan(0)
  })

  it('keeps a drop the average filled in visible on the lower hairline', () => {
    const raw = [90, 90, 5, 90, 90]
    const smoothed = [90, 61, 61, 61, 90]
    const bounds = deviationBounds(raw, smoothed)
    expect(bounds.lower[2]).toBe(5)
    expect(smoothed[2]! - bounds.lower[2]!).toBeGreaterThan(0)
  })

  it('stops at the shorter of the two series', () => {
    const bounds = deviationBounds([1, 2, 3], [1, 2])
    expect(bounds.lower).toHaveLength(2)
    expect(bounds.upper).toHaveLength(2)
  })
})

describe('deviationBoundsAreFlat', () => {
  it('is flat when the raw signal never departs from the core', () => {
    expect(deviationBoundsAreFlat(deviationBounds([3, 4, 5], [3, 4, 5]))).toBe(true)
  })

  it('is flat when every index is a gap', () => {
    expect(deviationBoundsAreFlat(deviationBounds([null, null], [1, 2]))).toBe(true)
  })

  it('is not flat once any sample departs', () => {
    expect(deviationBoundsAreFlat(deviationBounds([3, 9, 5], [3, 4, 5]))).toBe(false)
  })
})
