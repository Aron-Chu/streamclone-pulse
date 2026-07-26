import { describe, expect, it } from 'vitest'
import {
  recapMatchesStreamIds,
  resolveCanonicalStreamId,
} from './streamRouteResolution.ts'

describe('resolveCanonicalStreamId', () => {
  it('prefers detail streamId and falls back to the query target', () => {
    expect(resolveCanonicalStreamId('canonical-b', 'list-a')).toBe('canonical-b')
    expect(resolveCanonicalStreamId('  ', 'list-a')).toBe('list-a')
    expect(resolveCanonicalStreamId(null, 'list-a')).toBe('list-a')
  })
})

describe('recapMatchesStreamIds', () => {
  it('accepts either alias or canonical ids and rejects empty/mismatch', () => {
    expect(recapMatchesStreamIds('list-a', 'list-a', 'canonical-b')).toBe(true)
    expect(recapMatchesStreamIds('canonical-b', 'list-a', 'canonical-b')).toBe(true)
    expect(recapMatchesStreamIds('other', 'list-a', 'canonical-b')).toBe(false)
    expect(recapMatchesStreamIds(null, 'list-a', 'canonical-b')).toBe(false)
  })
})
