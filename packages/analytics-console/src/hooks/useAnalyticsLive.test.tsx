import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalyticsLive } from './useAnalyticsLive.ts'

const api = vi.hoisted(() => ({ getAnalyticsLive: vi.fn() }))

vi.mock('../api.ts', () => api)

describe('useAnalyticsLive request cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.getAnalyticsLive.mockResolvedValue({ state: 'live' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not issue a second live request before the 30 second default boundary', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const view = renderHook(() => useAnalyticsLive('xqc'), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(api.getAnalyticsLive).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(29_999) })
    expect(api.getAnalyticsLive).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(api.getAnalyticsLive).toHaveBeenCalledTimes(2)

    view.unmount()
    client.clear()
  })
})
