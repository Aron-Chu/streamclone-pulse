import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchPublicHub = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return { ...actual, fetchPublicHub: (signal?: AbortSignal) => fetchPublicHub(signal) }
})

import { usePublicHubData } from '../src/hooks/usePublicHubData'

function hub(poolSize: number) {
  return {
    data: { poolSize, generatedAt: new Date().toISOString() },
    loadSource: 'full' as const,
    hubEndpointOk: true,
    status: 200,
  }
}

describe('usePublicHubData', () => {
  beforeEach(() => {
    fetchPublicHub.mockReset()
  })

  it('loads, then exposes normalized data with liveEmpty false when channels exist', async () => {
    fetchPublicHub.mockResolvedValue(hub(3))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.data?.poolSize).toBe(3)
    // normalizePublicHub fills defaults for omitted aggregate sections.
    expect(result.current.data?.corpus.streamsTracked).toBe(0)
    expect(result.current.liveEmpty).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.loadSource).toBe('full')
    expect(result.current.hubEndpointOk).toBe(true)
    expect(result.current.lastUpdated).not.toBeNull()
  })

  it('marks liveEmpty when the pool is empty', async () => {
    fetchPublicHub.mockResolvedValue(hub(0))
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
  })
})
