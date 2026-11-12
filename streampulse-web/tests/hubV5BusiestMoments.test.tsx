// Top moments today's busiest-minute fill (board 2A, 11-02): the chart's cached
// hub/moments answers, listed without a read of their own, and again each time
// the locks cache one.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUCKET_MOMENTS_CACHE_READY_MS,
  clearBucketMomentsCache,
  clearBucketMomentsMemoryForTests,
  onBucketMomentsWrite,
  readBucketMomentsResponses,
  writeBucketMomentsCache,
} from '../src/lib/bucketMomentsCache'
import type { HubLivePulseMoment, PublicHubMomentsResponse } from '../src/lib/publicHub'
import { useHubV5BusiestMoments } from '../src/ui/components/hub/v5/useHubV5BusiestMoments'

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

const T = Date.UTC(2026, 10, 2, 6, 0)
const moment = (login: string, chatPerMin: number): HubLivePulseMoment => ({
  login, displayName: login, streamId: `s-${login}`, offsetSeconds: 600, at: T, score: 100, label: 'Corpus peak', chatPerMin,
}) as HubLivePulseMoment
const response = (bucketT: number, moments: HubLivePulseMoment[]): PublicHubMomentsResponse => ({
  bucketT, bucketStart: '', bucketEnd: '', hubGeneratedAt: '', source: 'corpus_historical', status: 'ready', activityWindowMinutes: 1440, moments,
})
const write = (bucketT: number, moments: HubLivePulseMoment[], window: '24h' | '7d' = '24h') =>
  writeBucketMomentsCache(bucketT, window, [], response(bucketT, moments))

beforeEach(() => {
  sessionStorage.clear()
  clearBucketMomentsCache()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T + 60_000)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('readBucketMomentsResponses', () => {
  it('lists the window’s fresh answers from memory and this tab’s storage, oldest bucket first', () => {
    write(T, [moment('b', 20)])
    write(T - 60 * 60_000, [moment('a', 10)])
    write(T, [moment('other', 99)], '7d')
    expect(readBucketMomentsResponses('24h').map((r) => r.moments[0]!.login)).toEqual(['a', 'b'])
    // after a reload the answers are only in sessionStorage
    clearBucketMomentsMemoryForTests()
    expect(readBucketMomentsResponses('24h').map((r) => r.moments[0]!.login)).toEqual(['a', 'b'])
    vi.setSystemTime(T + 60_000 + BUCKET_MOMENTS_CACHE_READY_MS + 1)
    expect(readBucketMomentsResponses('24h')).toEqual([])
  })

  it('tells listeners about each write until they unsubscribe', () => {
    const heard = vi.fn()
    const off = onBucketMomentsWrite(heard)
    write(T, [moment('a', 10)])
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    write(T, [moment('b', 10)])
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('useHubV5BusiestMoments', () => {
  it('lists the cached moments at once and each time the locks cache another answer; none without a window', () => {
    write(T, [moment('a', 10)])
    const { result, rerender } = renderHook(({ win }: { win: '24h' | undefined }) => useHubV5BusiestMoments(win), { initialProps: { win: '24h' as '24h' | undefined } })
    expect(result.current.map((m) => m.login)).toEqual(['a'])
    const before = result.current
    act(() => write(T, [moment('a', 10)]))
    // the same moments keep the same list
    expect(result.current).toBe(before)
    act(() => write(T + 60 * 60_000, [moment('b', 50), moment('c', 30)]))
    expect(result.current.map((m) => m.login)).toEqual(['a', 'b', 'c'])
    rerender({ win: undefined })
    expect(result.current).toEqual([])
  })
})
