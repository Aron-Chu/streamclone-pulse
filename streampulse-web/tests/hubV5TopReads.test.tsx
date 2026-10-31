import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MomentsWindowQuery } from '../src/lib/momentsFeed'

const load = vi.fn()
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsWindow: (...args: unknown[]) => load(...args),
}))

import { useTopToday, type TopTodayInput } from '../src/ui/components/hub/v5/HubV5TopMoments'

const NOW = Date.UTC(2026, 9, 30, 12, 34, 56)
const answer = { items: [], generatedAt: NOW, stale: false, total: 0, verdicts: { ok: 0, warn: 0, bad: 0 }, categories: [], nextCursor: null }
const input = (attempt: number): TopTodayInput => ({ hub: null, savedAt: null, reading: true, attempt, nowMs: NOW })
const reads = () => load.mock.calls.map((c) => c[0] as MomentsWindowQuery)

beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  load.mockReset().mockResolvedValue(answer)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Top moments today reads', () => {
  it('reads nothing before the hub’s first read starts, then once: the day’s top moments that hold up', async () => {
    const { rerender } = renderHook((p: TopTodayInput) => useTopToday(p), { initialProps: input(0) })
    await act(async () => {})
    expect(load).not.toHaveBeenCalled()
    rerender(input(1))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    expect(reads()[0]).toEqual({ from: Math.floor((NOW - 24 * 3600_000) / 600_000) * 600_000, sort: 'top', verdict: 'ok', limit: 50, category: null })
    expect((load.mock.calls[0]![1] as AbortSignal).aborted).toBe(false)
  })

  it('reads once more for each hub read, and not for a re-render', async () => {
    const { rerender } = renderHook((p: TopTodayInput) => useTopToday(p), { initialProps: input(1) })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    rerender({ ...input(1), nowMs: NOW + 1000 })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    rerender(input(2))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    rerender(input(3))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
  })

  it('keeps reading while the hub fails: a failed hub read is still a read', async () => {
    // the hub never answered (no data, a read running each attempt)
    const { result, rerender } = renderHook((p: TopTodayInput) => useTopToday(p), { initialProps: input(1) })
    await waitFor(() => expect(result.current.shown?.source).toBe('feed'))
    for (const attempt of [2, 3, 4]) {
      rerender({ ...input(attempt), reading: attempt % 2 === 0 })
      await waitFor(() => expect(load).toHaveBeenCalledTimes(attempt))
    }
    expect(result.current.shown?.source).toBe('feed')
  })

  it('reads a picked game once, and comes back to all at once', async () => {
    load.mockImplementation((q: MomentsWindowQuery) => Promise.resolve({ ...answer, categories: q.category ? [] : [
      { id: '27471', name: 'Minecraft', moments: 4, liveChannels: 1 },
      { id: '509658', name: 'Just Chatting', moments: 2, liveChannels: 1 },
    ] }))
    const { result } = renderHook((p: TopTodayInput) => useTopToday(p), { initialProps: input(1) })
    await waitFor(() => expect(result.current.games.map((g) => [g.name, g.moments])).toEqual([['Minecraft', 4], ['Just Chatting', 2]]))
    act(() => result.current.pickGame(result.current.games[0]!))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(reads()[1]).toMatchObject({ category: '27471', verdict: 'ok', sort: 'top' })
    await waitFor(() => expect(result.current.busy).toBe(false))
    act(() => result.current.pickGame(null))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(result.current.shown?.key).toBe('')
  })

  it('reads nothing with the switch off', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    const { result, rerender } = renderHook((p: TopTodayInput) => useTopToday(p), { initialProps: input(1) })
    rerender(input(2))
    rerender({ ...input(3), reading: false })
    await act(async () => {})
    expect(load).not.toHaveBeenCalled()
    expect(result.current.shown?.source).toBe('none')
  })
})
