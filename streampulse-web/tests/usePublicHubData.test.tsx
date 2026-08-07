import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import * as publicHubCache from '../src/lib/publicHubCache'
import {
  clearPublicHubCacheForTests,
  publicHubCacheKey,
  readPublicHubCache,
  writePublicHubCache,
} from '../src/lib/publicHubCache'
import { normalizePublicHub, type PublicHub, type PublicHubActivityWindow } from '../src/lib/publicHub'

const fetchPublicHubBase = vi.fn()
const fetchPublicHubStatsFallback = vi.fn()
const fetchPublicHub = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return {
    ...actual,
    fetchPublicHubBase: (
      signal?: AbortSignal,
      activityWindow?: import('../src/lib/publicHub').PublicHubActivityWindow,
    ) => fetchPublicHubBase(signal, activityWindow),
    fetchPublicHubStatsFallback: (signal?: AbortSignal) => fetchPublicHubStatsFallback(signal),
    fetchPublicHub: (
      signal?: AbortSignal,
      activityWindow?: import('../src/lib/publicHub').PublicHubActivityWindow,
    ) => fetchPublicHub(signal, activityWindow),
  }
})

import { usePublicHubData } from '../src/hooks/usePublicHubData'

function sampleHub(poolSize: number): PublicHub {
  return normalizePublicHub({
    poolSize,
    generatedAt: '2026-06-30T12:00:00.000Z',
    activity: {
      points: [{ t: 1_700_000_000, chat: 40, emotes: 12, seventv: 5, viewers: 1000 }],
      windowMinutes: 7 * 24 * 60,
      channelCount: 3,
    },
    corpusPipeline: {
      topN: 500,
      state: 'healthy',
      generatedAt: '2026-06-30T12:00:00.000Z',
      collectorActive: 10,
      collectorMax: 50,
      roster: {
        live: 0,
        collectorTracking: 0,
        expectedCollectorRows: 0,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        collecting: 0,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
      },
    },
  })
}

function hubResult(poolSize: number) {
  const data = sampleHub(poolSize)
  return {
    data,
    loadSource: 'full' as const,
    hubEndpointOk: true,
    status: 200,
  }
}

function hubDown() {
  return {
    data: normalizePublicHub(null),
    loadSource: 'full' as const,
    hubEndpointOk: false,
    status: 0,
  }
}

function statsFallbackResult(poolSize: number) {
  return {
    data: sampleHub(poolSize),
    loadSource: 'stats-fallback' as const,
    hubEndpointOk: false,
    status: 200,
  }
}

describe('usePublicHubData', () => {
  beforeEach(() => {
    clearPublicHubCacheForTests()
    fetchPublicHub.mockReset()
    fetchPublicHubBase.mockReset()
    fetchPublicHubStatsFallback.mockReset()
    fetchPublicHubBase.mockResolvedValue(hubDown())
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('Public hub unavailable'))
  })

  it('loads, then exposes normalized data with liveEmpty false when channels exist', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(3))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.data?.poolSize).toBe(3)
    expect(result.current.data?.corpus.streamsTracked).toBe(0)
    expect(result.current.liveEmpty).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.loadSource).toBe('full')
    expect(result.current.hubEndpointOk).toBe(true)
    expect(result.current.lastUpdated).not.toBeNull()
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(fetchPublicHub).not.toHaveBeenCalled()
  })

  it('restarts the aborted first load under Strict Mode without waiting for retry', async () => {
    fetchPublicHubBase.mockImplementation((signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'))
        if (signal?.aborted) {
          abort()
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
        window.setTimeout(() => {
          signal?.removeEventListener('abort', abort)
          resolve(hubResult(3))
        }, 20)
      }),
    )

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }), { wrapper })

    await waitFor(() => expect(result.current.data?.poolSize).toBe(3), { timeout: 1_000 })
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
  })

  it('marks liveEmpty when the pool is empty', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(0))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.liveEmpty).toBe(true)
  })

  it('surfaces an error message when the fetch rejects', async () => {
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('hub offline'))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('hub offline')
    expect(result.current.data).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => usePublicHubData({ enabled: false, pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).not.toHaveBeenCalled()
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(fetchPublicHub).not.toHaveBeenCalled()
  })

  it('initializes from cache immediately and does not stay in loading state', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(99))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(false)
    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.loadSource).toBe('cache')
    expect(result.current.cachedAt).not.toBeNull()
    await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalled())
  })

  it('fetches fresh data after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(42))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.loadSource).toBe('cache')
    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(fetchPublicHubBase).toHaveBeenCalled()
    expect(result.current.loadSource).toBe('full')
    expect(result.current.refreshing).toBe(false)
  })

  it('shows refreshing while background fetch runs after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(hubResult(42)), 40)
        }),
    )

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loadSource).toBe('cache')
    expect(result.current.refreshing).toBe(true)
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(result.current.data?.poolSize).toBe(42)
  })

  it('manual refresh aborts an in-flight fetch and applies the latest result', async () => {
    let resolveFirst: ((value: ReturnType<typeof hubResult>) => void) | undefined
    fetchPublicHubBase
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(hubResult(99))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(1))

    result.current.refresh()
    resolveFirst?.(hubResult(1))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(99))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
  })

  it('writes successful fresh hub data to cache', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(17))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(17))

    const cached = readPublicHubCache(getBackendUrl(), '24h')
    expect(cached?.data.poolSize).toBe(17)
    expect(typeof cached?.cachedAt).toBe('number')
  })

  it('ignores corrupted cache and cold-starts loading', async () => {
    localStorage.setItem(publicHubCacheKey(getBackendUrl(), '24h'), '{not-json')
    fetchPublicHubBase.mockResolvedValue(hubResult(5))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data?.poolSize).toBe(5))
  })

  it('cache key changes by activityWindow', async () => {
    writePublicHubCache(getBackendUrl(), '7d', sampleHub(7))
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(24))
    fetchPublicHubBase.mockResolvedValue(hubResult(100))

    const { result, rerender } = renderHook(
      ({ activityWindow }: { activityWindow: PublicHubActivityWindow }) =>
        usePublicHubData({ pollMs: 0, activityWindow }),
      { initialProps: { activityWindow: '7d' } },
    )

    expect(result.current.data?.poolSize).toBe(7)

    act(() => {
      rerender({ activityWindow: '24h' })
    })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(100))
    expect(result.current.loading).toBe(false)
    expect(result.current.loadSource).toBe('full')
  })

  it('reads public-hub cache once on mount across unrelated rerenders', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(42))
    const spy = vi.spyOn(publicHubCache, 'readPublicHubCacheForCurrentBackend')

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => usePublicHubData({ pollMs: 0, activityWindow: '24h' }),
      { initialProps: { tick: 0 } },
    )

    expect(result.current.data?.poolSize).toBe(8)
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ tick: 1 })
      rerender({ tick: 2 })
    })
    expect(spy).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('reads public-hub cache once per real activity-window transition', async () => {
    writePublicHubCache(getBackendUrl(), '7d', sampleHub(7))
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(24))
    fetchPublicHubBase.mockResolvedValue(hubResult(100))
    const spy = vi.spyOn(publicHubCache, 'readPublicHubCacheForCurrentBackend')

    const { result, rerender } = renderHook(
      ({ activityWindow }: { activityWindow: PublicHubActivityWindow }) =>
        usePublicHubData({ pollMs: 0, activityWindow }),
      { initialProps: { activityWindow: '7d' as PublicHubActivityWindow } },
    )

    expect(result.current.data?.poolSize).toBe(7)
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ activityWindow: '24h' })
    })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(24))
    expect(spy).toHaveBeenCalledTimes(2)

    act(() => {
      rerender({ activityWindow: '24h' })
    })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('uses stats fallback without a second full-hub request when base is unhealthy', async () => {
    fetchPublicHubStatsFallback.mockResolvedValue(statsFallbackResult(2))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.poolSize).toBe(2)
    expect(result.current.loadSource).toBe('stats-fallback')
    expect(result.current.hubEndpointOk).toBe(false)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(fetchPublicHub).not.toHaveBeenCalled()
  })

  it('does not call stats fallback after a successful base hub fetch', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(9))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.data?.poolSize).toBe(9))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it('clears hubEndpointOk when a refresh fails after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubDown())
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('hub offline'))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loadSource).toBe('cache')
    expect(result.current.hubEndpointOk).toBe(true)

    await waitFor(() => expect(result.current.error).toBe('hub offline'))
    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.hubEndpointOk).toBe(false)
  })

  describe('visibility controls (P4-L05)', () => {
    let visibilityState = 'visible'

    beforeEach(() => {
      visibilityState = 'visible'
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibilityState,
      })
    })

    afterEach(() => {
      vi.useRealTimers()
      visibilityState = 'visible'
    })

    it('skips interval fetch while the tab is hidden', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      fetchPublicHubBase.mockResolvedValue(hubResult(3))

      const { result } = renderHook(() => usePublicHubData({ pollMs: 10_000 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(3))
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      visibilityState = 'hidden'
      fetchPublicHubBase.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(fetchPublicHubBase).not.toHaveBeenCalled()
    })

    it('catch-up fetches when the tab becomes visible after the poll window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      fetchPublicHubBase.mockResolvedValue(hubResult(3))

      const { result } = renderHook(() => usePublicHubData({ pollMs: 10_000 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(3))
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      visibilityState = 'hidden'
      fetchPublicHubBase.mockClear()

      // Expire catch-up gate: sinceLastFetch < min(pollMs/2, 15s) → 5s for pollMs=10s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000)
      })
      expect(fetchPublicHubBase).not.toHaveBeenCalled()

      visibilityState = 'visible'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(1))
    })

    it('does not catch-up when becoming visible inside the debounce window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      fetchPublicHubBase.mockResolvedValue(hubResult(3))

      const { result } = renderHook(() => usePublicHubData({ pollMs: 10_000 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(3))

      visibilityState = 'hidden'
      fetchPublicHubBase.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })

      visibilityState = 'visible'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(fetchPublicHubBase).not.toHaveBeenCalled()
    })
  })
})
