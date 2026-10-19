import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HUB_INTERVAL_MAX_BUCKETS,
  HUB_INTERVAL_MAX_IN_FLIGHT,
  HUB_INTERVAL_MOMENT_LIMIT,
  HUB_INTERVAL_TEXT,
  hubIntervalBucketTs,
  hubIntervalInFlightForTests,
  loadHubIntervalMoments,
  planHubInterval,
  prefetchHubIntervalMoments,
  readHubIntervalMoments,
  resetHubIntervalMomentsForTests,
  type HubIntervalMomentsState,
} from '../src/lib/hubIntervalMoments'
import { clearBucketMomentsCache, writeBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import { getHubBucketSelectionSnapshot, resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'
import type { HubLivePulseMoment, PublicHubMomentsResponse } from '../src/lib/publicHub'

const requestHubBucketMoments = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prefetchHubBucketMoments', () => ({ requestHubBucketMoments }))

const MIN = 60_000
const B = 6 * MIN
const T0 = Math.floor(Date.UTC(2026, 9, 11, 19, 0) / B) * B

function moment(i: number, bucketT: number): HubLivePulseMoment {
  return {
    offsetSeconds: i, score: 1, label: 'Chat spike', login: `c${bucketT}_${i}`, displayName: `C${i}`,
    at: bucketT + i * 1_000, chatPerMin: 100 + i, emotesPerMin: 10,
  }
}

function response(bucketT: number, count: number, extra: Partial<PublicHubMomentsResponse> = {}): PublicHubMomentsResponse {
  return {
    bucketT, bucketStart: '', bucketEnd: '', hubGeneratedAt: '', source: 'corpus_historical',
    status: count ? 'ready' : 'empty', activityWindowMinutes: 1440,
    moments: Array.from({ length: count }, (_, i) => moment(i, bucketT)),
    ...extra,
  }
}

interface Pending { bucketT: number; resolve: (value: PublicHubMomentsResponse) => void; reject: (error: unknown) => void }

/** A controllable transport: records concurrency, answers when the test says so. */
function deferredTransport() {
  const pending: Pending[] = []
  let inFlight = 0
  let peak = 0
  requestHubBucketMoments.mockImplementation(({ bucketT }: { bucketT: number }) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    return new Promise<PublicHubMomentsResponse>((resolve, reject) => {
      pending.push({
        bucketT,
        resolve: (value) => { inFlight -= 1; resolve(value) },
        reject: (error) => { inFlight -= 1; reject(error) },
      })
    })
  })
  return {
    pending,
    get inFlight() { return inFlight },
    get peak() { return peak },
    /** Answer the oldest pending call, then let the limiter start the next. */
    async answer(count: number | ((bucketT: number) => PublicHubMomentsResponse)) {
      const next = pending.shift()!
      next.resolve(typeof count === 'function' ? count(next.bucketT) : response(next.bucketT, count))
      await flush()
    },
  }
}

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

beforeEach(() => {
  clearBucketMomentsCache()
  resetHubIntervalMomentsForTests()
  resetHubBucketSelectionForTests()
  requestHubBucketMoments.mockReset()
})

afterEach(() => {
  resetHubIntervalMomentsForTests()
})

describe('hub interval moments: plan', () => {
  it('lists the server buckets inside a bar', () => {
    expect(hubIntervalBucketTs({ t: T0 + 2 * MIN, bucketMinutes: 6 })).toEqual([T0])
    expect(hubIntervalBucketTs({ t: T0, endT: T0 + 12 * MIN, bucketMinutes: 6 })).toEqual([T0, T0 + B])
    expect(planHubInterval({ t: T0, endT: T0 + 30 * MIN, activityWindow: '24h', bucketMinutes: 6 }))
      .toEqual({ kind: 'buckets', bucketTs: [0, 1, 2, 3, 4].map(i => T0 + i * B) })
  })

  it('asks to zoom in for bars wider than 5 buckets and for the long windows', () => {
    expect(HUB_INTERVAL_MAX_BUCKETS).toBe(5)
    expect(planHubInterval({ t: T0, endT: T0 + 36 * MIN, activityWindow: '24h', bucketMinutes: 6 }))
      .toMatchObject({ kind: 'zoom-in', reason: 'wide-bar' })
    for (const activityWindow of ['1m', '3m', '6m', '1y', 'all'] as const) {
      expect(planHubInterval({ t: T0, activityWindow, bucketMinutes: 6 })).toMatchObject({ kind: 'zoom-in', reason: 'long-window' })
    }
    // A year-wide bar never builds a huge array before the check.
    expect(hubIntervalBucketTs({ t: 0, endT: 365 * 24 * 60 * MIN, bucketMinutes: 1 })).toHaveLength(6)
    expect(HUB_INTERVAL_TEXT.zoomIn).toBe('Zoom in to list moments')
  })

  it('answers zoom-in without a call', async () => {
    await expect(loadHubIntervalMoments({ t: T0, endT: T0 + 60 * MIN, activityWindow: '24h', bucketMinutes: 6 }))
      .resolves.toEqual({ status: 'zoom-in' })
    await expect(loadHubIntervalMoments({ t: T0, activityWindow: '1y', bucketMinutes: 1440 })).resolves.toEqual({ status: 'zoom-in' })
    expect(readHubIntervalMoments({ t: T0, activityWindow: '3m', bucketMinutes: 540 })).toEqual({ status: 'zoom-in' })
    expect(requestHubBucketMoments).not.toHaveBeenCalled()
  })
})

describe('hub interval moments: loading', () => {
  it('makes at most 5 calls with at most 2 in flight, and reports progress', async () => {
    const transport = deferredTransport()
    const progress: HubIntervalMomentsState[] = []
    const done = loadHubIntervalMoments(
      { t: T0, endT: T0 + 30 * MIN, activityWindow: '24h', bucketMinutes: 6 },
      { onProgress: state => progress.push(state) },
    )
    await flush()
    expect(transport.inFlight).toBe(HUB_INTERVAL_MAX_IN_FLIGHT)
    expect(hubIntervalInFlightForTests()).toMatchObject({ active: 2, queued: 3 })
    await transport.answer(2)
    await transport.answer(0)
    await transport.answer(HUB_INTERVAL_MOMENT_LIMIT)
    await transport.answer(1)
    await transport.answer(0)
    const state = await done
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(5)
    expect(transport.peak).toBe(2)
    expect(hubIntervalInFlightForTests().peak).toBe(2)
    expect(requestHubBucketMoments.mock.calls.every(([options]) => options.includeAdjacent === false)).toBe(true)
    expect(progress[0]).toEqual({ status: 'loading', bucketsRead: 0, bucketsTotal: 5 })
    expect(progress.at(-1)).toEqual({ status: 'loading', bucketsRead: 5, bucketsTotal: 5 })
    expect(state).toMatchObject({ status: 'ready', total: 13, atLimit: true, totalLabel: '13+', bucketsTotal: 5 })
  })

  it('shows "10+" when one bucket answers with the limit', async () => {
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => response(bucketT, 10))
    const state = await loadHubIntervalMoments({ t: T0, activityWindow: '24h', bucketMinutes: 6 })
    expect(state).toMatchObject({ status: 'ready', total: 10, atLimit: true, totalLabel: '10+' })
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => response(bucketT, 9))
    clearBucketMomentsCache()
    const below = await loadHubIntervalMoments({ t: T0 + B, activityWindow: '24h', bucketMinutes: 6 })
    expect(below).toMatchObject({ status: 'ready', total: 9, atLimit: false, totalLabel: '9' })
  })

  it('says empty, unavailable or error honestly', async () => {
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => response(bucketT, 0))
    await expect(loadHubIntervalMoments({ t: T0, endT: T0 + 12 * MIN, activityWindow: '24h', bucketMinutes: 6 }))
      .resolves.toEqual({ status: 'empty', bucketsTotal: 2 })

    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) =>
      response(bucketT, 0, { status: 'unavailable', reason: 'corpus_unavailable' }))
    await expect(loadHubIntervalMoments({ t: T0, activityWindow: '24h', bucketMinutes: 6 }))
      .resolves.toEqual({ status: 'unavailable', reason: 'corpus_unavailable', bucketsTotal: 1 })

    // A bucket that could not list leaves the total a minimum.
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => (bucketT === T0
      ? response(bucketT, 3)
      : response(bucketT, 0, { status: 'unavailable' })))
    await expect(loadHubIntervalMoments({ t: T0, endT: T0 + 12 * MIN, activityWindow: '24h', bucketMinutes: 6 }))
      .resolves.toMatchObject({ status: 'ready', total: 3, totalLabel: '3+' })

    const limited = { kind: 'rate_limited', message: 'slow down', retryAfterMs: 4_000 }
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => {
      if (bucketT === T0) throw limited
      return response(bucketT, 2)
    })
    await expect(loadHubIntervalMoments({ t: T0, endT: T0 + 12 * MIN, activityWindow: '24h', bucketMinutes: 6 }))
      .resolves.toEqual({ status: 'error', error: limited, retryAfterMs: 4_000, bucketsRead: 1, bucketsTotal: 2 })
    expect(HUB_INTERVAL_TEXT).toMatchObject({
      loading: 'Loading moments…',
      error: "Moments didn't load · Retry",
      empty: 'No moments in this bucket',
    })
  })

  it('reads cached buckets without a call, and renders them on the first frame', async () => {
    writeBucketMomentsCache(T0, '24h', [], response(T0, 4))
    writeBucketMomentsCache(T0 + B, '24h', [], response(T0 + B, 0))
    const request = { t: T0, endT: T0 + 12 * MIN, activityWindow: '24h' as const, bucketMinutes: 6 }
    expect(readHubIntervalMoments(request)).toMatchObject({ status: 'ready', total: 4, totalLabel: '4' })
    await expect(loadHubIntervalMoments(request)).resolves.toMatchObject({ status: 'ready', total: 4 })
    expect(requestHubBucketMoments).not.toHaveBeenCalled()

    expect(readHubIntervalMoments({ ...request, endT: T0 + 18 * MIN })).toBeNull()
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => response(bucketT, 1))
    await expect(loadHubIntervalMoments({ ...request, endT: T0 + 18 * MIN })).resolves.toMatchObject({ status: 'ready', total: 5 })
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
  })

  it('drops queued calls on abort and rejects with an AbortError', async () => {
    const transport = deferredTransport()
    const controller = new AbortController()
    const progress: HubIntervalMomentsState[] = []
    const done = loadHubIntervalMoments(
      { t: T0, endT: T0 + 30 * MIN, activityWindow: '24h', bucketMinutes: 6 },
      { signal: controller.signal, onProgress: state => progress.push(state) },
    )
    await flush()
    controller.abort()
    await transport.answer(1)
    await transport.answer(1)
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    // Only the two calls that had started ever ran; nothing was reported after the abort.
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(2)
    expect(progress).toEqual([{ status: 'loading', bucketsRead: 0, bucketsTotal: 5 }])
    expect(hubIntervalInFlightForTests()).toMatchObject({ active: 0, queued: 0 })
  })

  it('shares the 2-call limit across bars on the page', async () => {
    const transport = deferredTransport()
    const a = loadHubIntervalMoments({ t: T0, endT: T0 + 18 * MIN, activityWindow: '24h', bucketMinutes: 6 })
    const b = loadHubIntervalMoments({ t: T0 + 60 * MIN, endT: T0 + 78 * MIN, activityWindow: '24h', bucketMinutes: 6 })
    await flush()
    expect(transport.inFlight).toBe(2)
    for (let i = 0; i < 6; i += 1) await transport.answer(1)
    await Promise.all([a, b])
    expect(transport.peak).toBe(2)
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(6)
  })
})

describe('hub interval moments: hover prefetch', () => {
  it('warms buckets through the same limiter and never opens UI', async () => {
    const transport = deferredTransport()
    const before = getHubBucketSelectionSnapshot()
    expect(prefetchHubIntervalMoments({ t: T0, endT: T0 + 18 * MIN, activityWindow: '24h', bucketMinutes: 6 })).toBe(3)
    await flush()
    expect(transport.inFlight).toBe(2)
    expect(getHubBucketSelectionSnapshot()).toBe(before)
    expect(getHubBucketSelectionSnapshot()).toMatchObject({ selection: null, intervalOpen: false })
    // Errors are swallowed.
    transport.pending.shift()!.reject(new Error('offline'))
    await flush()
    await transport.answer(1)
    await transport.answer(1)
    expect(transport.peak).toBe(2)
    expect(prefetchHubIntervalMoments({ t: T0, activityWindow: '1y', bucketMinutes: 1440 })).toBe(0)
    expect(prefetchHubIntervalMoments({ t: T0, endT: T0 + 60 * MIN, activityWindow: '24h', bucketMinutes: 6 })).toBe(0)
  })

  it('skips buckets already in the session cache', () => {
    writeBucketMomentsCache(T0, '24h', [], response(T0, 2))
    requestHubBucketMoments.mockImplementation(async ({ bucketT }: { bucketT: number }) => response(bucketT, 0))
    expect(prefetchHubIntervalMoments({ t: T0, endT: T0 + 12 * MIN, activityWindow: '24h', bucketMinutes: 6 })).toBe(1)
  })
})
