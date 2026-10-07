import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as explorer from '../src/lib/explorer'
import { useExplorerData, type UseExplorerDataOptions } from '../src/hooks/useExplorerData'

function envelope(ids: string[], nextCursor?: string): explorer.ExplorerEnvelope {
  return { status: 'ready', generatedAt: '2026-10-05T12:00:00Z', dataThrough: '2026-10-05T11:59:00Z',
    summary: { broadcastCount: ids.length, momentCount: ids.length, categoryCount: 1 },
    broadcasts: ids.map(id => ({ id })), nextCursor } as unknown as explorer.ExplorerEnvelope
}

afterEach(() => vi.restoreAllMocks())

it('drops a Load more page that lands after the filters change', async () => {
  let releaseOldPage!: (value: explorer.ExplorerEnvelope) => void
  const fetch = vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
    // The transport ignores abort, so the late page still resolves.
    if (options?.cursor) return new Promise(resolve => { releaseOldPage = resolve })
    return options?.sort === 'recent' ? envelope(['recent-1', 'recent-2'], 'recent-cursor') : envelope(['strong-1', 'strong-2'], 'strong-cursor')
  })
  const initialProps: UseExplorerDataOptions = { window: '24h', signal: 'all', state: 'all', sort: 'strongest', q: 'load-more-race', pollMs: 0 }
  const { result, rerender } = renderHook(props => useExplorerData(props), { initialProps })
  await waitFor(() => expect(result.current.data?.broadcasts.map(item => item.id)).toEqual(['strong-1', 'strong-2']))

  act(() => { void result.current.loadMore() })
  expect(result.current.loadingMore).toBe(true)
  const continuation = fetch.mock.calls.find(([options]) => options?.cursor)?.[0]
  expect(continuation?.cursor).toBe('strong-cursor')

  rerender({ ...initialProps, sort: 'recent' })
  await waitFor(() => expect(result.current.data?.broadcasts.map(item => item.id)).toEqual(['recent-1', 'recent-2']))
  expect(continuation?.abortSignal?.aborted).toBe(true)
  expect(result.current.loadingMore).toBe(false)

  await act(async () => { releaseOldPage(envelope(['strong-1-p2', 'strong-2-p2'])) })
  expect(result.current.data?.broadcasts.map(item => item.id)).toEqual(['recent-1', 'recent-2'])
  expect(result.current.data?.nextCursor).toBe('recent-cursor')
  expect(result.current.loadingMore).toBe(false)
  expect(result.current.error).toBeNull()
})

function unavailableBody(reason: string) {
  return { schemaVersion: 1, status: 'unavailable', generatedAt: '2026-10-07T12:00:00Z', dataThrough: '2026-10-07T12:00:00Z', window: '7d',
    query: { window: '7d', signal: 'all', state: 'all', sort: 'strongest' }, summary: { broadcastCount: 0, momentCount: 0, categoryCount: 0 },
    facets: { signals: [], categories: [], states: [] }, broadcasts: [], moments: [], reason }
}

/** The 503 the backend sends while a 24h/7d window is prepared, as apiClient reports it. */
function preparing(reason: string, retryAfterMs = 30_000) {
  return { kind: 'server', message: 'HTTP 503', status: 503, body: unavailableBody(reason), retryAfterMs }
}

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

it('waits out Retry-After before the next poll and ignores a retry pressed during it', async () => {
  vi.useFakeTimers()
  try {
    const fetch = vi.spyOn(explorer, 'fetchExplorer').mockRejectedValue(preparing('snapshot_warming', 30_000))
    const { result } = renderHook(() => useExplorerData({ window: '7d', signal: 'all', state: 'all', sort: 'strongest', q: 'retry-after-list', pollMs: 5_000 }))
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.unavailable).toBe(true)
    expect(result.current.error).toBe('snapshot_warming')
    expect(result.current.retryBlocked).toBe(true)
    expect(result.current.retryScheduled).toBe(true)
    act(() => result.current.refresh())
    await flush(29_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockResolvedValue(envelope(['warm-1']))
    await flush(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.data?.broadcasts.map(item => item.id)).toEqual(['warm-1'])
    expect(result.current.retryBlocked).toBe(false)
    // Healthy again: the regular cadence resumes.
    await flush(5_000)
    expect(fetch).toHaveBeenCalledTimes(3)
  } finally {
    vi.useRealTimers()
  }
})

it('retries a warming detail read once, at Retry-After, and then waits for the reader', async () => {
  vi.useFakeTimers()
  try {
    const fetch = vi.spyOn(explorer, 'fetchExplorer').mockRejectedValue(preparing('snapshot_warming', 60_000))
    const { result } = renderHook(() => useExplorerData({ window: '7d', signal: 'all', state: 'all', sort: 'strongest', q: 'warming-detail', broadcastId: 'pulse-xqc-1' }))
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.retryScheduled).toBe(true)
    await flush(59_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await flush(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    // Still warming: no third automatic read, and Try again returns once Retry-After ends.
    expect(result.current.retryScheduled).toBe(false)
    expect(result.current.retryBlocked).toBe(true)
    await flush(120_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.retryBlocked).toBe(false)
    act(() => result.current.refresh())
    await flush()
    expect(fetch).toHaveBeenCalledTimes(3)
  } finally {
    vi.useRealTimers()
  }
})

it('does not retry a detail read on its own for a reason other than warming', async () => {
  vi.useFakeTimers()
  try {
    const fetch = vi.spyOn(explorer, 'fetchExplorer').mockRejectedValue(preparing('build_busy', 5_000))
    const { result } = renderHook(() => useExplorerData({ window: '7d', signal: 'all', state: 'all', sort: 'strongest', q: 'busy-detail', broadcastId: 'pulse-xqc-1' }))
    await flush()
    expect(result.current.error).toBe('build_busy')
    expect(result.current.retryScheduled).toBe(false)
    expect(result.current.retryBlocked).toBe(true)
    await flush(60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.retryBlocked).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

const ids = (envelope: explorer.ExplorerEnvelope | null) => envelope?.broadcasts.map(item => item.id)

it('keeps the rows Load more added, and the cursor past them, when the list polls', async () => {
  vi.useFakeTimers()
  try {
    let polled = false
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
      if (options?.cursor === 'page-2') return envelope(['c', 'd'], 'page-3')
      return polled ? envelope(['new', 'a'], 'page-2-fresh') : envelope(['a', 'b'], 'page-2')
    })
    const { result } = renderHook(() => useExplorerData({ window: 'live', signal: 'all', state: 'all', sort: 'strongest', q: 'poll-keeps-pages', pollMs: 5_000 }))
    await flush()
    expect(ids(result.current.data)).toEqual(['a', 'b'])
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c', 'd'])

    polled = true
    await flush(5_000)
    // The fresh first page leads; the reader's deeper rows and their cursor stay.
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c', 'd'])
    expect(result.current.data?.nextCursor).toBe('page-3')
    // Polls after that keep them too.
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c', 'd'])
  } finally {
    vi.useRealTimers()
  }
})

it('replaces a loaded-more list when a poll returns the whole list on one page', async () => {
  vi.useFakeTimers()
  try {
    let polled = false
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
      if (options?.cursor === 'page-2') return envelope(['c'])
      return polled ? envelope(['a']) : envelope(['a', 'b'], 'page-2')
    })
    const { result } = renderHook(() => useExplorerData({ window: 'live', signal: 'all', state: 'all', sort: 'strongest', q: 'poll-whole-list', pollMs: 5_000 }))
    await flush()
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c'])
    polled = true
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['a'])
    expect(result.current.data?.nextCursor).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

it('joins a Load more page that lands after a fresher poll to that poll, not to the list it started from', async () => {
  vi.useFakeTimers()
  try {
    let polled = false
    let releasePage!: (value: explorer.ExplorerEnvelope) => void
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
      if (options?.cursor) return new Promise(resolve => { releasePage = resolve })
      if (!polled) return envelope(['a', 'b'], 'page-2')
      return { ...envelope(['new', 'a', 'b'], 'page-2-fresh'), generatedAt: '2026-10-05T12:05:00Z' }
    })
    const { result } = renderHook(() => useExplorerData({ window: 'live', signal: 'all', state: 'all', sort: 'strongest', q: 'late-load-more', pollMs: 5_000 }))
    await flush()
    act(() => { void result.current.loadMore() })
    expect(result.current.loadingMore).toBe(true)

    polled = true
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b'])
    expect(result.current.data?.summary.broadcastCount).toBe(3)

    await act(async () => { releasePage({ ...envelope(['b', 'c'], 'page-3'), generatedAt: '2026-10-05T12:00:30Z' }) })
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c'])
    expect(result.current.data?.nextCursor).toBe('page-3')
    // The poll's summary and freshness stay; the older page does not overwrite them.
    expect(result.current.data?.summary.broadcastCount).toBe(3)
    expect(result.current.data?.generatedAt).toBe('2026-10-05T12:05:00Z')
    expect(result.current.loadingMore).toBe(false)

    // And the next poll keeps the joined rows.
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c'])
  } finally {
    vi.useRealTimers()
  }
})
