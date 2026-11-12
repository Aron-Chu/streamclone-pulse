import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import type { ActivitySummary } from '../src/lib/hubActivitySummary'
import { HUB_READ_HARD_CAP_MS } from '../src/lib/hubEarlyFetch'
import { normalizePublicHub, type PublicHubActivityWindow } from '../src/lib/publicHub'
import {
  clearPublicHubCacheForTests,
  flushPublicHubCacheWritesForTests,
  readPublicHubCacheForCurrentBackend,
  writePublicHubCache,
} from '../src/lib/publicHubCache'
import { HubDataHealthBanner } from '../src/ui/components/hub/HubDataHealthBanner'

// OP1-RES-002 / CX-RES-005: a hub read that hits its deadline is named as slow
// (never the raw deadline message) and the banner offers an immediate retry.

const fetchPublicHubBase = vi.fn()
const fetchPublicHubStatsFallback = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return {
    ...actual,
    fetchPublicHubBase: (...args: unknown[]) => fetchPublicHubBase(...args),
    fetchPublicHubStatsFallback: (...args: unknown[]) => fetchPublicHubStatsFallback(...args),
  }
})

import { HUB_RECENT_VIEW_HEAD_START_MS, HUB_TIMEOUT_MESSAGE, usePublicHubData } from '../src/hooks/usePublicHubData'

const timeout = { kind: 'timeout', message: 'Request deadline exceeded', status: 0 }
const rateLimited = { kind: 'rate_limited', message: 'Too many requests', status: 429, retryAfterMs: 120_000 }

const activity: ActivitySummary = {
  pointCount: 12,
  expectedBuckets: 12,
  missingBuckets: 0,
  coveragePct: 100,
  nonZeroCount: 8,
  gapCount: 0,
  bucketMinutes: 1,
  windowLabel: '30 minutes',
  footnote: '',
}

/** A previously successful 24h snapshot (same shape the hub hook tests cache). */
function cachedHub() {
  return normalizePublicHub({
    poolSize: 4,
    generatedAt: '2026-10-05T12:00:00.000Z',
    activity: {
      points: [{ t: 1_700_000_000, chat: 40, emotes: 12, seventv: 5, viewers: 1000 }],
      windowMinutes: 1440,
      channelCount: 4,
    },
    corpusPipeline: {
      topN: 500,
      state: 'healthy',
      generatedAt: '2026-10-05T12:00:00.000Z',
      collectorActive: 10,
      collectorMax: 50,
      roster: {
        live: 0, collectorTracking: 0, expectedCollectorRows: 0, liveCollectorDeficitRows: 0,
        metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0,
        warming: 0, collecting: 0, viewerOnly: 0, zeroChatAfterAge: 0,
      },
    },
  })
}

beforeEach(() => {
  clearPublicHubCacheForTests()
  fetchPublicHubBase.mockReset().mockRejectedValue(timeout)
  fetchPublicHubStatsFallback.mockReset().mockRejectedValue(new Error('Public hub unavailable'))
})

afterEach(() => cleanup())

describe('hub read timeout', () => {
  it('names a cold-load timeout instead of a generic outage', async () => {
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(HUB_TIMEOUT_MESSAGE)
    expect(result.current.data).toBeNull()
  })

  it('keeps the cached snapshot and names the slow refresh without the raw deadline text', async () => {
    writePublicHubCache(getBackendUrl(), '24h', cachedHub())
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.error).toBe(HUB_TIMEOUT_MESSAGE))
    expect(result.current.data?.poolSize).toBe(4)
    expect(result.current.error).not.toContain('deadline')
  })

  // The hook waits the long deadline itself; apiClient ends the read at the hard cap.
  it('gives the 24h read the hard cap and keeps 8 s for the 30m recovery read', async () => {
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[0]?.[1]).toBe('24h')
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('30m')
    expect(fetchPublicHubBase.mock.calls[1]?.[3]).toBe(8_000)
  })

  it('keeps 8 s for the 30m activity repair read after a successful 24h body', async () => {
    const primary = cachedHub()
    primary.activity = {
      ...primary.activity,
      windowMinutes: 1440,
      requestedWindowMinutes: 1440,
      servedWindowMinutes: 30,
      availableWindowMinutes: 30,
      bucketMinutes: 6,
      state: 'degraded',
      source: 'live_pool_fallback',
      reason: 'historical_projection_unavailable',
    }
    const ok = (data: ReturnType<typeof cachedHub>) => ({ data, loadSource: 'full' as const, hubEndpointOk: true, status: 200 })
    fetchPublicHubBase.mockResolvedValueOnce(ok(primary)).mockResolvedValueOnce(ok(cachedHub()))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.pollSequence).toBe(1))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('30m')
    expect(fetchPublicHubBase.mock.calls[1]?.[3]).toBe(8_000)
  })

  it('keeps a typed fallback error so its Retry-After is honoured', async () => {
    fetchPublicHubStatsFallback.mockRejectedValue(rateLimited)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Too many requests')
    expect(result.current.retryBlocked).toBe(true)
  })

  it('reports a Retry-After window and makes no request until it ends', async () => {
    fetchPublicHubBase.mockRejectedValue(rateLimited)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.retryBlocked).toBe(true))
    const calls = fetchPublicHubBase.mock.calls.length
    act(() => result.current.refresh())
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(calls)
  })

  it('keeps the generic outage copy when the hub failed for another reason', async () => {
    fetchPublicHubBase.mockRejectedValue({ kind: 'server', message: 'internal_error', status: 500 })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Public hub unavailable')
  })
})

// A busy API can take the whole 20 s deadline to build the 24h body. A first
// visit (nothing cached) shows the 30m view meanwhile; only the 24h result
// settles the load, and that 30m read is the load's one recovery read.
describe('cold 24h load on a busy API', () => {
  type HubReply = { data: ReturnType<typeof cachedHub>; loadSource: 'full'; hubEndpointOk: true; status: number }
  const ok = (data: ReturnType<typeof cachedHub>): HubReply => ({ data, loadSource: 'full', hubEndpointOk: true, status: 200 })

  function recentHub() {
    const hub = cachedHub()
    hub.poolSize = 7
    hub.activity = { ...hub.activity, windowMinutes: 30 }
    return hub
  }

  /** A fresh 24h body, told apart from the saved copy by its pool size. */
  function freshHub() {
    const hub = cachedHub()
    hub.poolSize = 9
    return hub
  }

  /** The saved 24h snapshot, once the idle-time cache writes have run. */
  function saved24h() {
    flushPublicHubCacheWritesForTests()
    return readPublicHubCacheForCurrentBackend('24h')
  }

  function deferred() {
    let resolve!: (value: HubReply) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<HubReply>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchPublicHubBase.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the 30m view after the head start, then swaps in the 24h snapshot', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(ok(recentHub()))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS - 1)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBeNull()

    await advance(1)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('30m')
    // Runs to the hard cap too: whichever lands first fills the page.
    expect(fetchPublicHubBase.mock.calls[1]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    expect(result.current.loading).toBe(false)
    expect(result.current.activityRefreshing).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.data?.poolSize).toBe(7)
    expect(result.current.data?.activity).toMatchObject({ windowMinutes: 1440, servedWindowMinutes: 30, source: 'live_pool_fallback' })
    expect(saved24h()).toBeNull()

    await act(async () => { slow.resolve(ok(cachedHub())) })
    expect(result.current.data?.poolSize).toBe(4)
    expect(result.current.data?.activity.source).toBeUndefined()
    expect(result.current.activityRefreshing).toBe(false)
    expect(result.current.pollSequence).toBe(2)
    expect(saved24h()?.data.poolSize).toBe(4)
  })

  it('reads only the 24h window when it answers within the head start', async () => {
    fetchPublicHubBase.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(ok(cachedHub())), HUB_RECENT_VIEW_HEAD_START_MS - 100)))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS * 3)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(result.current.data?.poolSize).toBe(4)
  })

  // A saved copy can be hours old: the fresh 30m view replaces it after the
  // head start while the 24h read keeps going.
  it('swaps a saved copy for the 30m view after the head start, then the 24h snapshot', async () => {
    writePublicHubCache(getBackendUrl(), '24h', cachedHub())
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(ok(recentHub()))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    expect(result.current).toMatchObject({ loadSource: 'cache', hubReadPending: true })
    expect(result.current.cachedAt).not.toBeNull()

    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('30m')
    expect(fetchPublicHubBase.mock.calls[1]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    expect(result.current).toMatchObject({ loadSource: 'full', cachedAt: null, error: null, hubReadPending: false, activityRefreshing: true })
    expect(result.current.data?.poolSize).toBe(7)
    expect(result.current.data?.activity).toMatchObject({ windowMinutes: 1440, servedWindowMinutes: 30, source: 'live_pool_fallback' })
    expect((fetchPublicHubBase.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(false)

    await act(async () => { slow.resolve(ok(freshHub())) })
    expect(result.current.data?.poolSize).toBe(9)
    expect(result.current.activityRefreshing).toBe(false)
    expect(saved24h()?.data.poolSize).toBe(9)
  })

  it('reads no 30m view over a saved copy when the 24h read answers within the head start', async () => {
    writePublicHubCache(getBackendUrl(), '24h', cachedHub())
    fetchPublicHubBase.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(ok(freshHub())), HUB_RECENT_VIEW_HEAD_START_MS - 100)))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS * 3)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ loadSource: 'full', cachedAt: null, hubReadPending: false })
    expect(result.current.data?.poolSize).toBe(9)
  })

  it('reads no 30m view on a later load once a 24h snapshot is on screen', async () => {
    fetchPublicHubBase.mockResolvedValueOnce(ok(cachedHub())).mockImplementationOnce(() => deferred().promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(0)
    expect(result.current.data?.poolSize).toBe(4)
    act(() => result.current.refresh())
    await advance(HUB_RECENT_VIEW_HEAD_START_MS * 3)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(result.current.data?.poolSize).toBe(4)
    // A hub answer is on screen, so the running refresh is not pending.
    expect(result.current.hubReadPending).toBe(false)
  })

  it('drops a 30m view that lands after the 24h snapshot', async () => {
    const slow = deferred()
    const recent = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => recent.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    const recentSignal = fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal
    await act(async () => { slow.resolve(ok(cachedHub())) })
    expect(recentSignal.aborted).toBe(true)
    await act(async () => { recent.resolve(ok(recentHub())) })
    expect(result.current.data?.poolSize).toBe(4)
    expect(result.current.pollSequence).toBe(1)
  })

  it('keeps the 30m view it showed as the result when the 24h read times out, with no second 30m read', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(ok(recentHub()))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    expect(result.current.data?.poolSize).toBe(7)
    expect(saved24h()).toBeNull()

    await act(async () => { slow.reject(timeout) })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
    expect(result.current.activityRefreshing).toBe(false)
    expect(result.current.data?.activity).toMatchObject({ windowMinutes: 1440, servedWindowMinutes: 30, source: 'live_pool_fallback' })
    expect(saved24h()?.data.poolSize).toBe(7)
    // The saved 30-minute stand-in keeps the 10-minute life, not the 6 h one
    // a real 24h chart gets.
    vi.setSystemTime(Date.now() + 11 * 60_000)
    expect(saved24h()).toBeNull()
  })

  it('awaits the 30m view still under way when the 24h read times out', async () => {
    const slow = deferred()
    const recent = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => recent.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    const recentSignal = fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal
    await act(async () => { slow.reject(timeout) })
    expect(recentSignal.aborted).toBe(false)
    expect(result.current.loading).toBe(true)

    await act(async () => { recent.resolve(ok(recentHub())) })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data?.activity).toMatchObject({ servedWindowMinutes: 30, source: 'live_pool_fallback' })
    expect(result.current.pollSequence).toBe(1)
    expect(saved24h()?.data.poolSize).toBe(7)
  })

  it('goes to the stats fallback when the 30m view it started failed, reading 30m only once', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockRejectedValueOnce(timeout)
    fetchPublicHubStatsFallback.mockResolvedValue({ data: normalizePublicHub(null), loadSource: 'stats-fallback', hubEndpointOk: false, status: 200 })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    expect(result.current.data).toBeNull()

    await act(async () => { slow.reject(timeout) })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(result.current.loadSource).toBe('stats-fallback')
    expect(saved24h()).toBeNull()
  })

  it('stops the 30m view and shows nothing from it when the 24h read is rate limited', async () => {
    const slow = deferred()
    const recent = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => recent.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    const recentSignal = fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal
    await act(async () => { slow.reject(rateLimited) })
    expect(recentSignal.aborted).toBe(true)
    await act(async () => { recent.resolve(ok(recentHub())) })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Too many requests')
    expect(result.current.retryBlocked).toBe(true)
  })
})

// The live API can take 17 s to over 30 s to build the hub body. Past the
// deadline the page shows what stands in for it (the 30m view, totals or the
// saved copy) but the read keeps going to the hard cap, and its answer
// replaces the stand-in when it lands.
describe('hub read past its deadline', () => {
  type HubReply = { data: ReturnType<typeof cachedHub>; loadSource: 'full'; hubEndpointOk: true; status: number }
  const ok = (data: ReturnType<typeof cachedHub>): HubReply => ({ data, loadSource: 'full', hubEndpointOk: true, status: 200 })
  const totals = () => {
    const data = normalizePublicHub(null)
    data.poolSize = 2
    return { data, loadSource: 'stats-fallback' as const, hubEndpointOk: false, status: 200 }
  }
  const withPool = (poolSize: number) => {
    const hub = cachedHub()
    hub.poolSize = poolSize
    return hub
  }

  function deferred() {
    let resolve!: (value: HubReply) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<HubReply>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  function saved(window: PublicHubActivityWindow) {
    flushPublicHubCacheWritesForTests()
    return readPublicHubCacheForCurrentBackend(window)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchPublicHubBase.mockReset()
    fetchPublicHubStatsFallback.mockReset().mockResolvedValue(totals())
  })
  afterEach(() => vi.useRealTimers())

  it('shows totals at the 30m deadline, then the hub when it lands', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    expect(result.current).toMatchObject({ data: null, loading: true, hubReadPending: true })
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBe(HUB_READ_HARD_CAP_MS)

    await advance(8_000 - 1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ data: null, loading: true, hubReadPending: true })

    await advance(1)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ loading: false, loadSource: 'stats-fallback', hubEndpointOk: false, error: null, hubReadPending: true })
    expect(result.current.data?.poolSize).toBe(2)
    expect((fetchPublicHubBase.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(false)

    await advance(22_000)
    await act(async () => { slow.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ loading: false, loadSource: 'full', hubEndpointOk: true, error: null, hubReadPending: false })
    expect(result.current.data?.poolSize).toBe(9)
    expect(saved('30m')?.data.poolSize).toBe(9)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
  })

  it('shows totals at the 24h deadline when the 30m view failed, then the 24h hub', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise).mockRejectedValueOnce(timeout)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(20_000 - 1)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ data: null, hubReadPending: true })

    await advance(1)
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', loading: false, hubReadPending: true })

    await advance(15_000)
    await act(async () => { slow.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ loadSource: 'full', hubEndpointOk: true, hubReadPending: false })
    expect(result.current.data?.poolSize).toBe(9)
    expect(saved('24h')?.data.poolSize).toBe(9)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
  })

  it('keeps the saved copy with the slow-hub note at the deadline, then the hub when it lands', async () => {
    writePublicHubCache(getBackendUrl(), '30m', withPool(4))
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    expect(result.current).toMatchObject({ loadSource: 'cache', hubReadPending: true })

    await advance(8_000)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ loadSource: 'cache', error: HUB_TIMEOUT_MESSAGE, refreshing: false, hubReadPending: true })
    expect(result.current.data?.poolSize).toBe(4)

    await act(async () => { slow.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ loadSource: 'full', cachedAt: null, error: null, hubEndpointOk: true, hubReadPending: false })
    expect(result.current.data?.poolSize).toBe(9)
  })

  it('reads with the hard cap and keeps the stand-in when the read fails at it', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    await advance(8_000)
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', hubReadPending: true })

    // apiClient ends the read at the hard cap with its own timeout.
    await advance(HUB_READ_HARD_CAP_MS - 8_000)
    await act(async () => { slow.reject(timeout) })
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', loading: false, error: null, hubReadPending: false })
    expect(result.current.data?.poolSize).toBe(2)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
  })

  it('never lets a late answer for the old window replace the new one', async () => {
    const slow30 = deferred()
    const slow24 = deferred()
    fetchPublicHubBase
      .mockImplementationOnce(() => slow30.promise)
      .mockImplementationOnce(() => slow24.promise)
      .mockImplementation(() => new Promise(() => {}))
    const { result, rerender } = renderHook(
      ({ activityWindow }) => usePublicHubData({ pollMs: 0, activityWindow }),
      { initialProps: { activityWindow: '30m' as PublicHubActivityWindow } },
    )
    await advance(8_000)
    expect(result.current.loadSource).toBe('stats-fallback')

    rerender({ activityWindow: '24h' })
    await advance(0)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('24h')
    expect((fetchPublicHubBase.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(true)
    expect(result.current.hubReadPending).toBe(true)

    await act(async () => { slow30.resolve(ok(withPool(3))) })
    expect(result.current.data?.poolSize).toBe(2)
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', hubReadPending: true })
    expect(saved('30m')).toBeNull()

    await act(async () => { slow24.resolve(ok(withPool(9))) })
    expect(result.current.data?.poolSize).toBe(9)
    expect(result.current).toMatchObject({ loadSource: 'full', hubReadPending: false })
    expect(saved('24h')?.data.poolSize).toBe(9)
  })

  // A 30-minute body for the early view of a longer window.
  const recent30 = () => {
    const hub = withPool(7)
    hub.activity = { ...hub.activity, windowMinutes: 30 }
    return hub
  }

  // D4: the 30m view runs to the hard cap too; whichever lands first fills the page.
  it('fills a cold 24h load with whichever lands first, reading each window once', async () => {
    const slow24 = deferred()
    const slow30 = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow24.promise).mockImplementationOnce(() => slow30.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    await advance(20_000)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('30m')
    expect(fetchPublicHubBase.mock.calls[1]?.[3]).toBe(HUB_READ_HARD_CAP_MS)
    // The 30m view still under way is not waited on: totals stand in meanwhile.
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', hubReadPending: true })
    expect((fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal).aborted).toBe(false)

    await advance(10_000)
    await act(async () => { slow30.resolve(ok(recent30())) })
    expect(result.current).toMatchObject({ loadSource: 'full', hubReadPending: false, activityRefreshing: true })
    expect(result.current.data?.poolSize).toBe(7)
    // Past the deadline it stands in for the late read: saved like one.
    expect(saved('24h')?.data.poolSize).toBe(7)

    await advance(10_000)
    await act(async () => { slow24.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ loadSource: 'full', activityRefreshing: false })
    expect(result.current.data?.poolSize).toBe(9)
    expect(fetchPublicHubBase.mock.calls.map(call => call[1])).toEqual(['24h', '30m'])
  })

  it('takes the 30m view under way as the result when the 24h read fails past its deadline', async () => {
    const slow24 = deferred()
    const slow30 = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow24.promise).mockImplementationOnce(() => slow30.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(25_000)
    await act(async () => { slow24.reject(timeout) })
    // D1: the load has not settled while its 30m view still runs.
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', hubReadPending: true })
    await act(async () => { slow30.resolve(ok(recent30())) })
    expect(result.current).toMatchObject({ loadSource: 'full', hubReadPending: false, error: null })
    expect(result.current.data?.poolSize).toBe(7)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
  })

  // D1: a gap between the failed read and its stand-in would read as given up.
  it('stays pending until the stand-in for a failed read is on screen', async () => {
    const stats = deferred()
    fetchPublicHubBase.mockRejectedValueOnce({ kind: 'server', message: 'internal_error', status: 500 })
    fetchPublicHubStatsFallback.mockReset().mockImplementationOnce(() => stats.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    await advance(0)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ data: null, hubReadPending: true })
    await act(async () => { stats.resolve(totals() as unknown as HubReply) })
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', hubReadPending: false })
  })

  // D2: the chart of a 30m view keeps saying it is updating while the 24h read runs on.
  it('keeps the 30m view updating at the deadline', async () => {
    const slow24 = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow24.promise).mockResolvedValueOnce(ok(recent30()))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    expect(result.current.activityRefreshing).toBe(true)
    await advance(20_000)
    expect(result.current).toMatchObject({ loadSource: 'full', loading: false, refreshing: false, activityRefreshing: true })
    await act(async () => { slow24.resolve(ok(withPool(9))) })
    expect(result.current.activityRefreshing).toBe(false)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
  })

  // D3: starting over would only push the origin's answer back.
  it('waits on the read under way when Try again is pressed, never starting it over', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    await advance(8_000)
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', loading: false, refreshing: false })
    act(() => result.current.refresh())
    expect(result.current.refreshing).toBe(true)
    await advance(1_000)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect((fetchPublicHubBase.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(false)
    await act(async () => { slow.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ loadSource: 'full', refreshing: false })
    expect(result.current.data?.poolSize).toBe(9)
  })

  // D5: a Retry-After from the stand-in's read ends with the answer.
  it('lifts the Retry-After of a stand-in read when the hub answers', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise)
    fetchPublicHubStatsFallback.mockReset().mockRejectedValue(rateLimited)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    await advance(8_000)
    expect(result.current).toMatchObject({ error: 'Too many requests', retryBlocked: true })
    await act(async () => { slow.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ loadSource: 'full', error: null, retryBlocked: false })
  })

  it('stops the late read on unmount', async () => {
    fetchPublicHubBase.mockImplementationOnce(() => deferred().promise)
    const { result, unmount } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    await advance(8_000)
    expect(result.current.hubReadPending).toBe(true)
    const signal = fetchPublicHubBase.mock.calls[0]?.[0] as AbortSignal
    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('is not pending once the read failed before its deadline', async () => {
    fetchPublicHubBase.mockRejectedValueOnce({ kind: 'server', message: 'internal_error', status: 500 })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    await advance(0)
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', hubReadPending: false })
  })

  // A failed read waits on a 30m view under way only to that view's 8 s deadline, not its hard cap.
  it('shows the stand-in 8 s into the 30m view when the 24h read fails fast and the 30m view hangs', async () => {
    const slow30 = deferred()
    const badGateway = { kind: 'server', message: 'bad_gateway', status: 502 }
    fetchPublicHubBase
      .mockImplementationOnce(() => new Promise((_, no) => { window.setTimeout(() => no(badGateway), 3_000) }))
      .mockImplementationOnce(() => slow30.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(3_000)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(result.current).toMatchObject({ data: null, hubReadPending: true })

    await advance(HUB_RECENT_VIEW_HEAD_START_MS + 8_000 - 3_000 - 1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    await advance(1)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ loadSource: 'stats-fallback', loading: false, hubReadPending: false, hubReadRunning: false })
    expect((fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal).aborted).toBe(true)
  })

  // Nothing runs for a window picked during a Retry-After pause, so it never reads as loading.
  it('shows the rate limit, not loading, for a window picked during a Retry-After pause, and loads it when the pause ends', async () => {
    fetchPublicHubBase.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce(ok(withPool(9)))
    const { result, rerender } = renderHook(
      ({ w }: { w: PublicHubActivityWindow }) => usePublicHubData({ pollMs: 45_000, activityWindow: w }),
      { initialProps: { w: '30m' as PublicHubActivityWindow } },
    )
    await advance(0)
    expect(result.current).toMatchObject({ error: 'Too many requests', retryBlocked: true, hubReadPending: false })

    rerender({ w: '24h' })
    await advance(0)
    expect(result.current).toMatchObject({
      loading: false, refreshing: false, error: 'Too many requests', retryBlocked: true, hubReadPending: false, hubReadRunning: false,
    })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

    await advance(120_000)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('24h')
    expect(result.current).toMatchObject({ loadSource: 'full', error: null, hubReadPending: false })
    expect(result.current.data?.poolSize).toBe(9)
  })

  it('calls a read late only once it has missed its deadline, and stops when it settles', async () => {
    const slow = deferred()
    fetchPublicHubBase.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    expect(result.current).toMatchObject({ hubReadRunning: true, hubReadLate: false })
    await advance(8_000 - 1)
    expect(result.current.hubReadLate).toBe(false)
    await advance(1)
    expect(result.current).toMatchObject({ hubReadRunning: true, hubReadLate: true })
    await act(async () => { slow.resolve(ok(withPool(9))) })
    expect(result.current).toMatchObject({ hubReadRunning: false, hubReadLate: false })
  })

  it('is not pending for a disabled hook', () => {
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m', enabled: false }))
    expect(result.current.hubReadPending).toBe(false)
    expect(fetchPublicHubBase).not.toHaveBeenCalled()
  })
})

describe('HubDataHealthBanner retry', () => {
  it('offers Try again for a failed hub read', () => {
    const onRetry = vi.fn()
    render(<HubDataHealthBanner hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error={HUB_TIMEOUT_MESSAGE} onRetry={onRetry} />)
    expect(screen.getByText(HUB_TIMEOUT_MESSAGE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('names no snapshot when nothing ever loaded', () => {
    const { rerender } = render(<HubDataHealthBanner hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error={HUB_TIMEOUT_MESSAGE} onRetry={vi.fn()} />)
    expect(screen.getByText('Live data is unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/last loaded snapshot/)).toBeNull()
    rerender(<HubDataHealthBanner loadSource="cache" hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error={HUB_TIMEOUT_MESSAGE} onRetry={vi.fn()} />)
    expect(screen.getByText('Could not refresh hub data. Showing the last loaded snapshot if available.')).toBeTruthy()
  })

  it('offers Try again while only aggregate stats are shown', () => {
    render(<HubDataHealthBanner loadSource="stats-fallback" hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('keeps Try again in place but disabled while a request is in flight', () => {
    const { rerender } = render(<HubDataHealthBanner hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error="Public hub unavailable" loading onRetry={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<HubDataHealthBanner hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error="Public hub unavailable" retryDisabled onRetry={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<HubDataHealthBanner hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error="Public hub unavailable" onRetry={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('hides Try again while the hub is healthy', () => {
    render(<HubDataHealthBanner hubEndpointOk activitySummary={{ ...activity, gapCount: 2 }} liveRosterCount={3} onRetry={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  // U4: nothing has failed while the read runs on past its deadline.
  it('says only that live data is slow while the hub read runs on, with no Try again', () => {
    const { container, rerender } = render(<HubDataHealthBanner loadSource="stats-fallback" hubEndpointOk={false} activitySummary={{ ...activity, gapCount: 2 }} liveRosterCount={0} pending late onRetry={vi.fn()} />)
    expect(container.querySelector('.hx-health-banner')!.textContent).toBe('Live data is slow — still loading…')
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<HubDataHealthBanner loadSource="cache" hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error={HUB_TIMEOUT_MESSAGE} pending late onRetry={vi.fn()} />)
    expect(container.querySelector('.hx-health-banner')!.textContent).toBe('Live data is slow — still loading…')
    expect(screen.queryByText(HUB_TIMEOUT_MESSAGE)).toBeNull()
    // Before its deadline there is nothing to say.
    rerender(<HubDataHealthBanner hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} pending onRetry={vi.fn()} />)
    expect(container.querySelector('.hx-health-banner')).toBeNull()
    // A poll's read before its deadline keeps the stand-in's own text, not calling it slow yet.
    rerender(<HubDataHealthBanner loadSource="stats-fallback" hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} pending retryDisabled onRetry={vi.fn()} />)
    expect(screen.getByText('Hub temporarily unavailable — showing aggregate stats only.')).toBeTruthy()
    expect(screen.queryByText('Live data is slow — still loading…')).toBeNull()
    // Given up: the error and Try again.
    rerender(<HubDataHealthBanner loadSource="stats-fallback" hubEndpointOk={false} activitySummary={activity} liveRosterCount={0} error={HUB_TIMEOUT_MESSAGE} onRetry={vi.fn()} />)
    expect(screen.getByText(HUB_TIMEOUT_MESSAGE)).toBeTruthy()
    expect(screen.queryByText('Live data is slow — still loading…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
