import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchRecent = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return {
    ...actual,
    fetchPublicHubRecentMoments: (signal?: AbortSignal, limit?: number) => fetchRecent(signal, limit),
  }
})

import { usePublicHubRecentMoments } from '../src/hooks/usePublicHubRecentMoments'
import {
  readPublicHubRecentMomentsCache,
  writePublicHubRecentMomentsCache,
} from '../src/lib/publicHubRecentMomentsCache'

function response(id = 'pm-1') {
  return {
    data: {
      hubGeneratedAt: '2026-09-06T12:00:00Z',
      source: 'public_hub_live_pulse_moments',
      status: 'ready',
      limit: 10,
      hasMore: false,
      moments: [{ publicMomentId: id, login: 'xqc', streamId: 's1', offsetSeconds: 120, score: 80, label: 'Emote spike' }],
    },
    loadSource: 'bounded' as const,
    cache: 'HIT' as const,
    status: 200,
  }
}

describe('usePublicHubRecentMoments', () => {
  beforeEach(() => {
    fetchRecent.mockReset()
    window.localStorage.clear()
  })

  afterEach(() => vi.restoreAllMocks())

  it('loads the bounded feed and passes the requested row cap', async () => {
    fetchRecent.mockResolvedValueOnce(response())
    const { result } = renderHook(() => usePublicHubRecentMoments({ pollMs: 0, limit: 7 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.moments[0]?.publicMomentId).toBe('pm-1')
    expect(result.current.loadSource).toBe('bounded')
    expect(fetchRecent).toHaveBeenCalledTimes(1)
    expect(fetchRecent.mock.calls[0]?.[1]).toBe(7)
  })

  it('keeps the last measured rows visible when an explicit refresh fails', async () => {
    fetchRecent.mockResolvedValueOnce(response())
    const { result } = renderHook(() => usePublicHubRecentMoments({ pollMs: 0 }))
    await waitFor(() => expect(result.current.data?.moments).toHaveLength(1))
    fetchRecent.mockRejectedValueOnce({ kind: 'server', status: 503, message: 'temporarily unavailable' })
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.error).toBe('Recent moments are temporarily unavailable.'))
    expect(result.current.data?.moments[0]?.publicMomentId).toBe('pm-1')
    expect(result.current.refreshing).toBe(false)
  })

  it('does not fetch while disabled', async () => {
    const { result } = renderHook(() => usePublicHubRecentMoments({ enabled: false, pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchRecent).not.toHaveBeenCalled()
  })

  it('hydrates bounded public rows but never persists a handoff reference', async () => {
    const cached = response().data
    writePublicHubRecentMomentsCache({
      ...cached,
      moments: [{ ...cached.moments[0], handoffRef: 'cr_transient' }],
    })
    expect(readPublicHubRecentMomentsCache()?.data.moments[0]?.handoffRef).toBeUndefined()
    fetchRecent.mockResolvedValueOnce(response('pm-fresh'))
    const { result } = renderHook(() => usePublicHubRecentMoments({ pollMs: 0 }))
    expect(result.current.loading).toBe(false)
    expect(result.current.loadSource).toBe('cache')
    expect(result.current.data?.moments[0]?.publicMomentId).toBe('pm-1')
    await waitFor(() => expect(result.current.data?.moments[0]?.publicMomentId).toBe('pm-fresh'))
  })

  it('honors Retry-After when a manual refresh is attempted immediately', async () => {
    fetchRecent.mockRejectedValueOnce({
      kind: 'rate_limited', status: 429, message: 'slow down', retryAfterMs: 8_000,
    })
    const { result } = renderHook(() => usePublicHubRecentMoments({ pollMs: 1_000 }))
    await waitFor(() => expect(result.current.error).toContain('server wait period'))
    act(() => result.current.refresh())
    expect(fetchRecent).toHaveBeenCalledTimes(1)
  })

  it('aborts the in-flight bounded request when the workspace unmounts', async () => {
    let requestSignal: AbortSignal | undefined
    fetchRecent.mockImplementationOnce((signal?: AbortSignal) => new Promise((_resolve, reject) => {
      requestSignal = signal
      signal?.addEventListener('abort', () => reject({ kind: 'aborted', status: 0, message: 'cancelled' }), { once: true })
    }))
    const { unmount } = renderHook(() => usePublicHubRecentMoments({ pollMs: 0 }))
    await waitFor(() => expect(fetchRecent).toHaveBeenCalledOnce())
    unmount()
    expect(requestSignal?.aborted).toBe(true)
  })

  it('does not let visibility changes bypass failure backoff', async () => {
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    fetchRecent.mockRejectedValueOnce({ kind: 'server', status: 503, message: 'unavailable' })
    const { result } = renderHook(() => usePublicHubRecentMoments({ pollMs: 45_000 }))
    await waitFor(() => expect(result.current.error).toBe('Recent moments are temporarily unavailable.'))
    now += 20_000
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchRecent).toHaveBeenCalledTimes(1)
  })
})
