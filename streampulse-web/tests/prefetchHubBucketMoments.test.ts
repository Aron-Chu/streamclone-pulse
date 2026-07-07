import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activityBucketMs } from '../src/lib/hubActivitySummary'
import { clearBucketMomentsCache, writeBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import {
  adjacentBucketTs,
  clearHubBucketMomentsInFlight,
  requestHubBucketMoments,
} from '../src/lib/prefetchHubBucketMoments'
import type { PublicHubMomentsResponse } from '../src/lib/publicHub'

const fetchHistoricalHubMoments = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

vi.mock('../src/lib/publicHub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicHub')>()
  return {
    ...actual,
    fetchHistoricalHubMoments: (...args: unknown[]) => fetchHistoricalHubMoments(...args),
  }
})

function momentsResponse(bucketT: number): PublicHubMomentsResponse {
  return {
    bucketT,
    bucketStart: '2026-07-06T11:00:00.000Z',
    bucketEnd: '2026-07-06T12:00:00.000Z',
    hubGeneratedAt: '2026-07-06T12:00:00.000Z',
    source: 'corpus_historical',
    status: 'ready',
    activityWindowMinutes: 24 * 60,
    moments: [
      {
        login: 'xqc',
        displayName: 'xQc',
        streamId: 's1',
        offsetSeconds: 60,
        at: bucketT + 60_000,
        score: 80,
        label: 'Chat spike',
        kind: 'chat',
        source: 'corpus_historical',
        chatPerMin: 100,
        emotesPerMin: 10,
        viewers: 40_000,
        confidence: 100,
      },
    ],
  }
}

describe('prefetchHubBucketMoments', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearBucketMomentsCache()
    clearHubBucketMomentsInFlight()
    fetchHistoricalHubMoments.mockReset()
    fetchHistoricalHubMoments.mockImplementation(async (bucketT: number) => momentsResponse(bucketT))
  })

  afterEach(() => {
    clearHubBucketMomentsInFlight()
  })

  it('dedupes concurrent requests for the same bucket key', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchHistoricalHubMoments.mockImplementationOnce(async (bucketT: number) => {
      await gate
      return momentsResponse(bucketT)
    })

    const opts = {
      bucketT: 1_719_000_000_000,
      activityWindow: '24h' as const,
      activityWindowMinutes: 24 * 60,
    }
    const first = requestHubBucketMoments(opts)
    const second = requestHubBucketMoments(opts)

    expect(fetchHistoricalHubMoments).toHaveBeenCalledTimes(1)
    release()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('adjacentBucketTs steps by one activity bucket width', () => {
    const bucketT = 1_719_000_000_000
    const windowMinutes = 24 * 60
    const bucketMs = activityBucketMs(windowMinutes)
    expect(adjacentBucketTs(bucketT, windowMinutes, -1)).toBe(bucketT - bucketMs)
    expect(adjacentBucketTs(bucketT, windowMinutes, 1)).toBe(bucketT + bucketMs)
  })

  it('prefetches adjacent buckets when includeAdjacent is true', async () => {
    await requestHubBucketMoments({
      bucketT: 1_719_000_000_000,
      activityWindow: '24h',
      activityWindowMinutes: 24 * 60,
      includeAdjacent: true,
    })

    expect(fetchHistoricalHubMoments).toHaveBeenCalledTimes(3)
  })

  it('skips network fetch for adjacent buckets already in cache', async () => {
    const bucketT = 1_719_000_000_000
    const neighbor = adjacentBucketTs(bucketT, 24 * 60, -1)
    writeBucketMomentsCache(neighbor, '24h', [])

    await requestHubBucketMoments({
      bucketT,
      activityWindow: '24h',
      activityWindowMinutes: 24 * 60,
      includeAdjacent: true,
    })

    expect(fetchHistoricalHubMoments).toHaveBeenCalledTimes(2)
    const calledBuckets = fetchHistoricalHubMoments.mock.calls.map((call) => call[0])
    expect(calledBuckets).not.toContain(neighbor)
  })
})
