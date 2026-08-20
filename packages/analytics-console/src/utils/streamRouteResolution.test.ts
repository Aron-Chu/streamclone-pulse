import { describe, expect, it } from 'vitest'
import {
  recapMatchesStreamIds,
  resolveCanonicalStreamId,
  resolveMatchedStream,
  resolveTargetQueryStreamId,
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

describe('date session resolution', () => {
  const streams = [
    {
      streamId: 'aug-20',
      login: 'hasanabi',
      startedAt: '2026-08-20T18:05:35Z',
    },
    {
      streamId: 'aug-19',
      login: 'hasanabi',
      startedAt: '2026-08-19T17:58:07Z',
    },
  ]

  it('resolves distinct UTC dates to distinct exact ids', () => {
    expect(resolveMatchedStream('2026-08-20', streams)).toMatchObject({ streamId: 'aug-20' })
    expect(resolveMatchedStream('2026-08-19', streams)).toMatchObject({ streamId: 'aug-19' })
  })

  it('does not silently choose when two sessions share a UTC date', () => {
    const sameDay = [
      ...streams,
      { streamId: 'second-aug-20', login: 'hasanabi', startedAt: '2026-08-20T23:05:35Z' },
    ]
    expect(resolveMatchedStream('2026-08-20', sameDay)).toBeUndefined()
    expect(resolveTargetQueryStreamId('2026-08-20', undefined, sameDay, false)).toBeUndefined()
  })
})
