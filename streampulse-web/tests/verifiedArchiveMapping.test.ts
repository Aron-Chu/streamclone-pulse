import { describe, expect, it } from 'vitest'
import { verifiedArchiveMapping } from '../src/lib/verifiedArchiveMapping'

const source = { vodId: '2865942971', vodAlignSeconds: 0, vodDurationSeconds: 600, vodTiming: { state: 'verified' } }
describe('atomic verified archive mapping', () => {
  it.each([0, -75.5, 13])('preserves signed alignment %s', alignment => {
    expect(verifiedArchiveMapping({ ...source, vodAlignSeconds: alignment })).toEqual({ vodId: source.vodId, alignment, duration: 600 })
  })
  it.each([
    { vodTiming: undefined }, { vodTiming: { state: 'unavailable' } }, { vodAlignSeconds: undefined },
    { vodAlignSeconds: Infinity }, { vodAlignSeconds: 21601 }, { vodDurationSeconds: 0 },
    { vodDurationSeconds: undefined }, { vodDurationSeconds: NaN }, { vodId: '12' },
    { stream: { vodId: '2865942972' } }, { availability: { vodId: 'evil/path' } },
  ])('rejects incomplete or contradictory mapping %j', change => {
    expect(verifiedArchiveMapping({ ...source, ...change })).toBeNull()
  })
})
