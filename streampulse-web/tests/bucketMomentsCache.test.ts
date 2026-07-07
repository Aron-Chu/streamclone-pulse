import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'
import {
  BUCKET_MOMENTS_CACHE_EMPTY_MS,
  BUCKET_MOMENTS_CACHE_READY_MS,
  bucketMomentsCacheKey,
  clearBucketMomentsCache,
  clearBucketMomentsMemoryForTests,
  hasBucketMomentsCache,
  readBucketMomentsCache,
  writeBucketMomentsCache,
} from '../src/lib/bucketMomentsCache'

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

const sampleMoment = (): FigmaMomentRow => ({
  login: 'xqc',
  displayName: 'xQc',
  label: 'Chat spike',
  score: 80,
  chatPerMin: 100,
  emotesPerMin: 20,
  viewers: 50_000,
  at: 1_719_000_000_000,
  offsetSeconds: 120,
  streamId: 's1',
  kind: 'chat',
  source: 'live_irc',
})

describe('bucketMomentsCache', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearBucketMomentsCache()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('read/write round-trips ready entries through memory and sessionStorage', () => {
    const rows = [sampleMoment()]
    writeBucketMomentsCache(1_719_000_000_000, '24h', rows)

    expect(hasBucketMomentsCache(1_719_000_000_000, '24h')).toBe(true)
    expect(readBucketMomentsCache(1_719_000_000_000, '24h')).toEqual(rows)

    clearBucketMomentsMemoryForTests()
    expect(readBucketMomentsCache(1_719_000_000_000, '24h')).toEqual(rows)
  })

  it('expires ready entries after the ready TTL', () => {
    writeBucketMomentsCache(1_719_000_000_000, '24h', [sampleMoment()])
    vi.advanceTimersByTime(BUCKET_MOMENTS_CACHE_READY_MS + 1)

    expect(hasBucketMomentsCache(1_719_000_000_000, '24h')).toBe(false)
    expect(readBucketMomentsCache(1_719_000_000_000, '24h')).toBeUndefined()
  })

  it('expires empty entries after the shorter empty TTL', () => {
    writeBucketMomentsCache(1_719_000_000_000, '24h', [])
    vi.advanceTimersByTime(BUCKET_MOMENTS_CACHE_EMPTY_MS + 1)

    expect(hasBucketMomentsCache(1_719_000_000_000, '24h')).toBe(false)
  })

  it('isolates cache keys by backend URL and activity window', () => {
    writeBucketMomentsCache(100, '24h', [sampleMoment()])
    expect(readBucketMomentsCache(100, '7d')).toBeUndefined()
    expect(readBucketMomentsCache(101, '24h')).toBeUndefined()
    expect(bucketMomentsCacheKey(100, '24h')).toContain('24h')
  })

  it('clearBucketMomentsCache removes all bucket entries', () => {
    writeBucketMomentsCache(100, '24h', [sampleMoment()])
    writeBucketMomentsCache(200, '7d', [])
    clearBucketMomentsCache()
    expect(hasBucketMomentsCache(100, '24h')).toBe(false)
    expect(hasBucketMomentsCache(200, '7d')).toBe(false)
  })
})
