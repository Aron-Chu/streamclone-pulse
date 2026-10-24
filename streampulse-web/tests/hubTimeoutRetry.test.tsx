import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import type { ActivitySummary } from '../src/lib/hubActivitySummary'
import { normalizePublicHub } from '../src/lib/publicHub'
import { clearPublicHubCacheForTests, readPublicHubCacheForCurrentBackend, writePublicHubCache } from '../src/lib/publicHubCache'
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

  it('gives the 24h body the long deadline and keeps 8 s for the 30m recovery read', async () => {
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[0]?.[1]).toBe('24h')
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBeUndefined()
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
    expect(fetchPublicHubBase.mock.calls[0]?.[3]).toBeUndefined()
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

// A busy API has taken 24–40 s to build the 24h body. A first visit (nothing
// cached) shows the 30m view meanwhile; only the 24h result settles the load.
describe('cold 24h load on a busy API', () => {
  type HubReply = { data: ReturnType<typeof cachedHub>; loadSource: 'full'; hubEndpointOk: true; status: number }
  const ok = (data: ReturnType<typeof cachedHub>): HubReply => ({ data, loadSource: 'full', hubEndpointOk: true, status: 200 })

  function recentHub() {
    const hub = cachedHub()
    hub.poolSize = 7
    hub.activity = { ...hub.activity, windowMinutes: 30 }
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
    expect(fetchPublicHubBase.mock.calls[1]?.[3]).toBe(8_000)
    expect(result.current.loading).toBe(false)
    expect(result.current.activityRefreshing).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.data?.poolSize).toBe(7)
    expect(result.current.data?.activity).toMatchObject({ windowMinutes: 1440, servedWindowMinutes: 30, source: 'live_pool_fallback' })
    expect(readPublicHubCacheForCurrentBackend('24h')).toBeNull()

    await act(async () => { slow.resolve(ok(cachedHub())) })
    expect(result.current.data?.poolSize).toBe(4)
    expect(result.current.data?.activity.source).toBeUndefined()
    expect(result.current.activityRefreshing).toBe(false)
    expect(result.current.pollSequence).toBe(2)
    expect(readPublicHubCacheForCurrentBackend('24h')?.data.poolSize).toBe(4)
  })

  it('reads only the 24h window when it answers within the head start', async () => {
    fetchPublicHubBase.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(ok(cachedHub())), 1_000)))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS * 2)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(result.current.data?.poolSize).toBe(4)
  })

  it('keeps a cached snapshot on screen instead of reading the 30m view', async () => {
    writePublicHubCache(getBackendUrl(), '24h', cachedHub())
    fetchPublicHubBase.mockImplementationOnce(() => deferred().promise)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS * 2)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(result.current.loadSource).toBe('cache')
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

  it('ends on the 30m fallback, as before, when the 24h read times out', async () => {
    const slow = deferred()
    fetchPublicHubBase
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValueOnce(ok(recentHub()))
      .mockResolvedValueOnce(ok(recentHub()))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await advance(HUB_RECENT_VIEW_HEAD_START_MS)
    await act(async () => { slow.reject(timeout) })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
    expect(fetchPublicHubBase.mock.calls[2]?.[1]).toBe('30m')
    expect(result.current.error).toBeNull()
    expect(result.current.activityRefreshing).toBe(false)
    expect(result.current.data?.activity).toMatchObject({ servedWindowMinutes: 30, source: 'live_pool_fallback' })
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
})
