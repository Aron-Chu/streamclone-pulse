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

it('retries a warming detail read once after 30 s when the page cannot read Retry-After', async () => {
  vi.useFakeTimers()
  try {
    // Production today: the API's CORS layer does not expose Retry-After, so apiClient reports none.
    const fetch = vi.spyOn(explorer, 'fetchExplorer').mockRejectedValue({ ...preparing('snapshot_warming'), retryAfterMs: undefined })
    const { result } = renderHook(() => useExplorerData({ window: '7d', signal: 'all', state: 'all', sort: 'strongest', q: 'warming-detail-no-retry-after', broadcastId: 'pulse-xqc-1' }))
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('snapshot_warming')
    // An automatic check follows, and no pause is claimed that the page cannot honour.
    expect(result.current.retryScheduled).toBe(true)
    expect(result.current.retryBlocked).toBe(false)
    await flush(29_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await flush(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    // Still warming: no third automatic read; Try again stays available.
    expect(result.current.retryScheduled).toBe(false)
    expect(result.current.retryBlocked).toBe(false)
    await flush(120_000)
    expect(fetch).toHaveBeenCalledTimes(2)
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

/**
 * A list served the way streampulse-backend pages it: `limit` rows after the
 * cursor, which names the last row of the page before. A cursor whose row has
 * left the list is refused. Each answer is taken when the read is made.
 */
function pagedServer(initial: string[]) {
  let rows = initial
  let generatedAt = '2026-10-05T12:00:00Z'
  const reads: Array<{ cursor?: string; limit?: number }> = []
  const answer = (options?: explorer.FetchExplorerOptions): explorer.ExplorerEnvelope => {
    reads.push({ cursor: options?.cursor, limit: options?.limit })
    const start = options?.cursor ? rows.indexOf(options.cursor) + 1 : 0
    if (start === 0 && options?.cursor) throw { kind: 'server', message: 'invalid_cursor', status: 400 }
    const limit = options?.limit ?? 25
    const page = rows.slice(start, start + limit)
    const base = envelope(page, start + limit < rows.length ? page.at(-1) : undefined)
    return { ...base, generatedAt, summary: { ...base.summary, broadcastCount: rows.length } }
  }
  return {
    reads,
    answer,
    replace: (next: string[]) => { rows = next },
    stamp: (next: string) => { generatedAt = next },
  }
}

/** A list read held until the test lets it answer. */
function held() {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  return { gate, release }
}

const live = { window: 'live', signal: 'all', state: 'live', sort: 'strongest', limit: 2, pollMs: 5_000 } as const

it('drops a first-page broadcast that left the list when a list extended with Load more polls', async () => {
  vi.useFakeTimers()
  try {
    const server = pagedServer(['a', 'b', 'c', 'd', 'e', 'f'])
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => server.answer(options))
    const { result } = renderHook(() => useExplorerData({ ...live, q: 'poll-drops-ended' }))
    await flush()
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c', 'd'])

    // 'b' ends, so state=live no longer lists it.
    server.replace(['a', 'c', 'd', 'e', 'f'])
    await flush(5_000)
    // The poll reads as deep as the reader reached, so every row shown is current.
    expect(server.reads.at(-1)).toEqual({ cursor: undefined, limit: 4 })
    expect(ids(result.current.data)).toEqual(['a', 'c', 'd', 'e'])
    expect(result.current.data?.summary.broadcastCount).toBe(5)
    expect(result.current.data?.nextCursor).toBe('e')
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'c', 'd', 'e', 'f'])
    expect(result.current.data?.nextCursor).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

it('keeps every row reachable when a poll pushes the reader\'s rows down', async () => {
  vi.useFakeTimers()
  try {
    const server = pagedServer(['a', 'b', 'c', 'd', 'e'])
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => server.answer(options))
    const { result } = renderHook(() => useExplorerData({ ...live, q: 'poll-pushes-down' }))
    await flush()
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c', 'd'])

    server.replace(['new', 'a', 'b', 'c', 'd', 'e'])
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c'])
    // The cursor follows the last row read, so 'd', pushed past it, comes back next.
    expect(result.current.data?.nextCursor).toBe('c')
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c', 'd', 'e'])
  } finally {
    vi.useRealTimers()
  }
})

it('replaces a loaded-more list when a poll returns the whole list on one page', async () => {
  vi.useFakeTimers()
  try {
    const server = pagedServer(['a', 'b', 'c'])
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => server.answer(options))
    const { result } = renderHook(() => useExplorerData({ ...live, q: 'poll-whole-list' }))
    await flush()
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c'])
    server.replace(['a'])
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['a'])
    expect(result.current.data?.nextCursor).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

it('reads a list the reader has not extended one page deep', async () => {
  vi.useFakeTimers()
  try {
    const server = pagedServer(Array.from({ length: 40 }, (_, index) => `r${index}`))
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => server.answer(options))
    renderHook(() => useExplorerData({ ...live, limit: 25, q: 'poll-one-page' }))
    await flush()
    await flush(5_000)
    expect(server.reads).toEqual([{ cursor: undefined, limit: 25 }, { cursor: undefined, limit: 25 }])
  } finally {
    vi.useRealTimers()
  }
})

it('past what one read returns, keeps the deeper rows as loaded and the cursor past them', async () => {
  vi.useFakeTimers()
  try {
    const rows = Array.from({ length: 80 }, (_, index) => `r${index}`)
    const server = pagedServer(rows)
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => server.answer(options))
    const { result } = renderHook(() => useExplorerData({ ...live, limit: 25, q: 'poll-past-max-depth' }))
    await flush()
    await act(async () => { await result.current.loadMore() })
    await act(async () => { await result.current.loadMore() })
    expect(result.current.data?.broadcasts).toHaveLength(75)

    server.replace(rows.filter(id => id !== 'r3'))
    await flush(5_000)
    expect(server.reads.at(-1)).toEqual({ cursor: undefined, limit: explorer.EXPLORER_MAX_LIMIT })
    expect(ids(result.current.data)).toEqual(rows.slice(0, 75).filter(id => id !== 'r3'))
    expect(result.current.data?.nextCursor).toBe('r74')
  } finally {
    vi.useRealTimers()
  }
})

it('reads the next page again when a poll moves the cursor while a Load more is in flight', async () => {
  vi.useFakeTimers()
  try {
    const server = pagedServer(['a', 'b', 'c', 'd', 'e', 'f'])
    const hold = held()
    let holding = true
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
      const answer = server.answer(options)
      // The first continuation is held until the poll has landed.
      if (options?.cursor && holding) {
        holding = false
        await hold.gate
      }
      return answer
    })
    const { result } = renderHook(() => useExplorerData({ ...live, q: 'late-load-more' }))
    await flush()
    act(() => { void result.current.loadMore() })
    expect(result.current.loadingMore).toBe(true)

    server.replace(['new', 'a', 'b', 'c', 'd', 'e', 'f'])
    await flush(5_000)
    expect(ids(result.current.data)).toEqual(['new', 'a'])
    expect(result.current.data?.nextCursor).toBe('a')

    // The held page continued the old list after 'b'; joined as it is, it would
    // skip 'b', which the poll pushed down. The page after the poll's cursor is read instead.
    await act(async () => { hold.release() })
    await flush()
    expect(server.reads.filter(read => read.cursor).map(read => read.cursor)).toEqual(['b', 'a'])
    expect(ids(result.current.data)).toEqual(['new', 'a', 'b', 'c'])
    expect(result.current.data?.nextCursor).toBe('c')
    expect(result.current.data?.summary.broadcastCount).toBe(7)
    expect(result.current.loadingMore).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it('joins a Load more page to a poll that kept the cursor, keeping the poll\'s summary and freshness', async () => {
  vi.useFakeTimers()
  try {
    const rows = Array.from({ length: 100 }, (_, index) => `r${index}`)
    const server = pagedServer(rows)
    const hold = held()
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
      const answer = server.answer(options)
      if (options?.cursor === 'r74') await hold.gate
      return answer
    })
    const { result } = renderHook(() => useExplorerData({ ...live, limit: 25, q: 'late-load-more-same-cursor' }))
    await flush()
    await act(async () => { await result.current.loadMore() })
    await act(async () => { await result.current.loadMore() })
    server.stamp('2026-10-05T12:00:30Z')
    act(() => { void result.current.loadMore() })

    // Seventy-five rows are shown, more than one read returns, so the poll keeps the cursor past them.
    server.stamp('2026-10-05T12:05:00Z')
    server.replace(rows.filter(id => id !== 'r3'))
    await flush(5_000)
    expect(result.current.data?.nextCursor).toBe('r74')
    expect(result.current.data?.summary.broadcastCount).toBe(99)

    await act(async () => { hold.release() })
    await flush()
    expect(ids(result.current.data)).toEqual(rows.filter(id => id !== 'r3'))
    expect(result.current.data?.nextCursor).toBeUndefined()
    expect(result.current.data?.generatedAt).toBe('2026-10-05T12:05:00Z')
    expect(result.current.data?.summary.broadcastCount).toBe(99)
    expect(result.current.loadingMore).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it('keeps a Load more page that landed during a poll that then fails', async () => {
  vi.useFakeTimers()
  try {
    const server = pagedServer(['a', 'b', 'c', 'd', 'e'])
    let failPoll: ((reason: unknown) => void) | undefined
    let firstPages = 0
    vi.spyOn(explorer, 'fetchExplorer').mockImplementation(async options => {
      // The first poll (the second first-page read) is held, then fails.
      if (!options?.cursor && firstPages++ === 1) return new Promise((_, reject) => { failPoll = reject })
      return server.answer(options)
    })
    const { result } = renderHook(() => useExplorerData({ ...live, q: 'failed-poll-keeps-page' }))
    await flush()
    await flush(5_000)
    expect(failPoll).toBeDefined()
    await act(async () => { await result.current.loadMore() })
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c', 'd'])

    await act(async () => { failPoll!({ kind: 'timeout', message: 'Request timed out' }) })
    // Shown as out of date, with the rows and the cursor the reader has now.
    expect(result.current.data?.status).toBe('stale')
    expect(ids(result.current.data)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.data?.nextCursor).toBe('d')
    expect(result.current.error).toBe('Request timed out')
  } finally {
    vi.useRealTimers()
  }
})
