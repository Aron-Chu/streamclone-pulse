import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import {
  clearPublicHubCacheForTests,
  publicHubCacheKey,
  readPublicHubCache,
  writePublicHubCache,
} from '../src/lib/publicHubCache'
import { normalizePublicHub, type PublicHub, type PublicHubActivityWindow } from '../src/lib/publicHub'

const fetchPublicHubBase = vi.fn()
const fetchPublicHub = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return {
    ...actual,
    fetchPublicHubBase: (signal?: AbortSignal, activityWindow?: import('../src/lib/publicHub').PublicHubActivityWindow) =>
      fetchPublicHubBase(signal, activityWindow),
    fetchPublicHub: (signal?: AbortSignal, activityWindow?: import('../src/lib/publicHub').PublicHubActivityWindow) =>
      fetchPublicHub(signal, activityWindow),
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

describe('usePublicHubData', () => {
  beforeEach(() => {
    clearPublicHubCacheForTests()
    fetchPublicHub.mockReset()
    fetchPublicHubBase.mockReset()
    fetchPublicHubBase.mockResolvedValue({
      data: normalizePublicHub(null),
      loadSource: 'full',
      hubEndpointOk: false,
      status: 0,
    })
  })

  it('loads, then exposes normalized data with liveEmpty false when channels exist', async () => {
    fetchPublicHub.mockResolvedValue(hubResult(3))
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
  })

  it('marks liveEmpty when the pool is empty', async () => {
    fetchPublicHub.mockResolvedValue(hubResult(0))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.liveEmpty).toBe(true)
  })

  it('surfaces an error message when the fetch rejects', async () => {
    fetchPublicHub.mockRejectedValue(new Error('hub offline'))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('hub offline')
    expect(result.current.data).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => usePublicHubData({ enabled: false, pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHub).not.toHaveBeenCalled()
    expect(fetchPublicHubBase).not.toHaveBeenCalled()
  })

  it('initializes from cache immediately and does not stay in loading state', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(99))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(false)
    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.loadSource).toBe('cache')
    expect(result.current.cachedAt).not.toBeNull()
  })

  it('fetches fresh data after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(42))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.data?.poolSize).toBe(8)
    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(fetchPublicHubBase).toHaveBeenCalled()
    expect(result.current.loadSource).toBe('full')
    expect(result.current.refreshing).toBe(false)
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

    rerender({ activityWindow: '24h' })
    expect(result.current.loading).toBe(false)
    expect(result.current.data?.poolSize).toBe(24)
    expect(result.current.loadSource).toBe('cache')
  })
})
