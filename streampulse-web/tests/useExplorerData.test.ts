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
