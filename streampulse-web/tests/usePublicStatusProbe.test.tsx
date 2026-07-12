import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublicStatusProbe } from '../src/hooks/usePublicStatusProbe'

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('usePublicStatusProbe', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads /v1/public/status once and maps operational to ready', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'operational', degraded: false }))
    const { result } = renderHook(() => usePublicStatusProbe({ pollMs: 0 }))

    expect(result.current.tone).toBe('checking')
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tone).toBe('ready')
    expect(result.current.degraded).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/public/status')
  })

  it('maps degraded honesty from status payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'operational', degraded: true }))
    const { result } = renderHook(() => usePublicStatusProbe({ pollMs: 0 }))
    await waitFor(() => expect(result.current.tone).toBe('degraded'))
    expect(result.current.degraded).toBe(true)
  })

  it('maps unreachable / HTTP failure to offline', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503))
    const { result } = renderHook(() => usePublicStatusProbe({ pollMs: 0 }))
    await waitFor(() => expect(result.current.tone).toBe('offline'))
    expect(result.current.error).toMatch(/HTTP 503/)
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => usePublicStatusProbe({ enabled: false, pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts in-flight request on unmount', async () => {
    let rejectFetch: ((reason?: unknown) => void) | undefined
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    const { unmount } = renderHook(() => usePublicStatusProbe({ pollMs: 0 }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    unmount()
    expect(rejectFetch).toBeTypeOf('function')
  })
})
