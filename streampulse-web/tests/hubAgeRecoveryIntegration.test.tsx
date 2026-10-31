import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublicHubData } from '../src/hooks/usePublicHubData'
import { resetPrimedPublicHubForTests } from '../src/lib/hubEarlyFetch'
import { fetchPublicHubBase } from '../src/lib/publicHub'
import { clearPublicHubCacheForTests, flushPublicHubCacheWritesForTests, readPublicHubCacheForCurrentBackend } from '../src/lib/publicHubCache'

const T0 = new Date(2026, 9, 28, 10, 55).getTime()

function hubBody(windowMinutes = 30, poolSize = 10) {
  return {
    generatedAt: new Date(T0 - 60_000).toISOString(),
    poolSize,
    corpus: { streamsTracked: 0, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
    coverage: { databaseOk: true, state: 'operational' },
    activity: { points: [], windowMinutes, channelCount: 0 },
    liveChannels: [], moments: [], topEmotes: [], topMovers: [],
    corpusPipeline: { state: 'healthy', generatedAt: new Date(T0).toISOString(), roster: { live: 0, collectorTracking: 0 } },
  }
}

function response(headers: Record<string, string>, windowMinutes = 30, poolSize = 10) {
  return new Response(JSON.stringify(hubBody(windowMinutes, poolSize)), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  localStorage.clear()
  clearPublicHubCacheForTests()
  resetPrimedPublicHubForTests()
})

afterEach(() => {
  cleanup()
  clearPublicHubCacheForTests()
  resetPrimedPublicHubForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('hub age through the real response and slow recovery paths', () => {
  it.each([
    [{ 'x-hub-copy-age-seconds': '900', 'cache-control': 'no-store' }, T0 - 900_000],
    [{ 'x-hub-copy-age-seconds': '900', age: '5', 'cache-control': 'no-store' }, T0 - 905_000],
    [{ 'x-hub-copy-age-seconds': '900', 'cache-control': 'public, max-age=30' }, null],
    [{ 'x-hub-copy-age-seconds': 'bad', 'cache-control': 'no-store' }, null],
    [{}, null],
  ])('derives the response age from headers visible to the browser (%s)', async (headers, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(response(headers))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchPublicHubBase(undefined, '30m')
    expect(result.hubEndpointOk).toBe(true)
    expect(result.dataAsOf).toBe(expected)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('shows the late 30m stand-in with its own age before replacing it with the late 24h response', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const windowName = new URL(String(input)).searchParams.get('activityWindow')
      if (windowName === '24h') {
        return new Promise<Response>(resolve => setTimeout(() => resolve(response({ 'x-hub-copy-age-seconds': '120', 'cache-control': 'no-store' }, 1440, 24)), 30_000))
      }
      if (windowName === '30m') {
        // The side read starts after one second and lands after the 20-second deadline.
        return new Promise<Response>(resolve => setTimeout(() => resolve(response({ 'x-hub-copy-age-seconds': '30', 'cache-control': 'no-store' }, 30, 30)), 21_000))
      }
      throw new Error('Unexpected mocked request')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(22_000) })
    expect(result.current.hubReadLate).toBe(true)
    expect(result.current.data?.poolSize).toBe(30)
    expect(result.current.dataAsOf).toBe(T0 + 22_000 - 30_000)
    flushPublicHubCacheWritesForTests()
    expect(readPublicHubCacheForCurrentBackend('24h')?.dataAsOf).toBe(T0 + 22_000 - 30_000)

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(result.current.data?.poolSize).toBe(24)
    expect(result.current.dataAsOf).toBe(T0 + 30_000 - 120_000)
    expect(result.current.hubReadLate).toBe(false)
    flushPublicHubCacheWritesForTests()
    expect(readPublicHubCacheForCurrentBackend('24h')?.dataAsOf).toBe(T0 + 30_000 - 120_000)
    const hubReads = fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/v1/public/hub')
    expect(hubReads.map(([input]) => new URL(String(input)).searchParams.get('activityWindow'))).toEqual(['24h', '30m'])
  })
})
