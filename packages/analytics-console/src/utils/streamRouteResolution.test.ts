import { describe, expect, it } from 'vitest'
import type { AnalyticsStream } from '../apiTypes.ts'
import {
  recapMatchesStreamIds,
  resolveCanonicalStreamId,
  resolveMatchedStream,
  resolveTargetQueryStreamId,
} from './streamRouteResolution.ts'

const stream = (streamId: string, startedAt: string): AnalyticsStream => ({
  streamId,
  login: 'caseoh_',
  startedAt,
})

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

describe('date stream resolution', () => {
  it('preserves unique legacy date links', () => {
    const item = stream('stream-a', '2026-08-18T02:00:00Z')
    expect(resolveMatchedStream('2026-08-18', [item])?.streamId).toBe('stream-a')
    expect(resolveTargetQueryStreamId('2026-08-18', undefined, [
      { streamId: 'stream-a', startedAt: item.startedAt },
    ], false)).toBe('stream-a')
  })

  it('does not choose an arbitrary stream when a date has multiple broadcasts', () => {
    const first = stream('stream-a', '2026-08-18T02:00:00Z')
    const second = stream('stream-b', '2026-08-18T18:00:00Z')
    expect(resolveMatchedStream('2026-08-18', [first, second])).toBeUndefined()
    expect(resolveTargetQueryStreamId('2026-08-18', undefined, [
      { streamId: first.streamId, startedAt: first.startedAt },
      { streamId: second.streamId, startedAt: second.startedAt },
    ], false)).toBeUndefined()
    expect(resolveMatchedStream('stream-b', [first, second])?.streamId).toBe('stream-b')
  })
})
