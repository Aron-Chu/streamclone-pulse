import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBucketMomentsCache, writeBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import { loadHubIntervalMoments, resetHubIntervalMomentsForTests } from '../src/lib/hubIntervalMoments'
import { HUB_WARM_MAX, noteHubBarRest, onHubBarRest, warmHubBuckets } from '../src/lib/hubLockWarmup'
import type { PublicHubMomentsResponse } from '../src/lib/publicHub'

const requestHubBucketMoments = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prefetchHubBucketMoments', () => ({ requestHubBucketMoments }))

const MIN = 60_000
const B = 6 * MIN
const T0 = Math.floor(Date.UTC(2026, 10, 1, 19, 0) / B) * B

function response(bucketT: number): PublicHubMomentsResponse {
  return {
    bucketT, bucketStart: '', bucketEnd: '', hubGeneratedAt: '', source: 'corpus_historical',
    status: 'empty', activityWindowMinutes: 1440, moments: [],
  }
}

/** Answers when the test says so, and records the most calls in flight at once. */
function deferred() {
  const pending: Array<{ bucketT: number; resolve: () => void; reject: (e: unknown) => void }> = []
  let inFlight = 0
  let peak = 0
  requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    return new Promise<PublicHubMomentsResponse>((resolve, reject) => {
      pending.push({
        bucketT,
        resolve: () => { inFlight -= 1; resolve(response(bucketT)) },
        reject: (e) => { inFlight -= 1; reject(e) },
      })
    })
  })
  return { pending, peak: () => peak }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  requestHubBucketMoments.mockReset()
  resetHubIntervalMomentsForTests()
  clearBucketMomentsCache()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('warmHubBuckets', () => {
  it('reads one bucket at a time, oldest of the list first', async () => {
    const t = deferred()
    const run = warmHubBuckets([T0, T0 + B, T0 + 2 * B], '24h', 6, new AbortController().signal)
    for (let i = 0; i < 3; i += 1) {
      await flush()
      expect(t.pending).toHaveLength(i + 1)
      t.pending[i]!.resolve()
    }
    await expect(run).resolves.toBe(3)
    expect(t.pending.map((p) => p.bucketT)).toEqual([T0, T0 + B, T0 + 2 * B])
    expect(t.peak()).toBe(1)
  })

  it('stops at the first failure, so a 429 sends nothing more', async () => {
    const t = deferred()
    const run = warmHubBuckets([T0, T0 + B, T0 + 2 * B], '24h', 6, new AbortController().signal)
    await flush()
    t.pending[0]!.reject({ kind: 'rate_limited', retryAfterMs: 30_000 })
    await expect(run).resolves.toBe(1)
    expect(t.pending).toHaveLength(1)
  })

  it('skips buckets the cache has and reads at most 8', async () => {
    requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) => Promise.resolve(response(bucketT)))
    writeBucketMomentsCache(T0, '24h', [], response(T0))
    const list = Array.from({ length: 12 }, (_, i) => T0 + i * B)
    await expect(warmHubBuckets(list, '24h', 6, new AbortController().signal)).resolves.toBe(HUB_WARM_MAX - 1)
    expect(requestHubBucketMoments.mock.calls.map(([o]) => o.bucketT)).not.toContain(T0)
  })

  it('waits while a click’s read is in flight', async () => {
    const t = deferred()
    const click = loadHubIntervalMoments({ t: T0 + 5 * B, activityWindow: '24h', bucketMinutes: 6 })
    await flush()
    const run = warmHubBuckets([T0], '24h', 6, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(t.pending).toHaveLength(1)
    t.pending[0]!.resolve()
    await click
    await vi.advanceTimersByTimeAsync(400)
    expect(t.pending.map((p) => p.bucketT)).toEqual([T0 + 5 * B, T0])
    t.pending[1]!.resolve()
    await expect(run).resolves.toBe(1)
  })

  it('stops when aborted', async () => {
    const t = deferred()
    const abort = new AbortController()
    const run = warmHubBuckets([T0, T0 + B], '24h', 6, abort.signal)
    await flush()
    abort.abort()
    t.pending[0]!.resolve()
    await expect(run).resolves.toBe(1)
    expect(t.pending).toHaveLength(1)
  })
})

describe('bar rest', () => {
  it('reaches listeners until they unsubscribe', () => {
    const heard = vi.fn()
    const off = onHubBarRest(heard)
    noteHubBarRest({ t: T0, endT: T0 + B })
    off()
    noteHubBarRest({ t: T0 + B, endT: T0 + 2 * B })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledWith({ t: T0, endT: T0 + B })
  })
})
