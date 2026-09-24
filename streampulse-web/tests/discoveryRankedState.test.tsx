import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as transport from '../src/lib/discoveryCatalogue'
import { useRankedDiscovery } from '../src/hooks/useDiscoveryCatalogue'

const scope = { from: '2026-09-13', to: '2026-09-14', category: '', categoryMissing: false, creator: '' }
const data = { state: 'ready', from: scope.from, to: scope.to, creator: '', category: null, categoryMissing: false,
  asOf: '2026-09-13T12:00:00Z', rankingVersion: 'fixture', facets: [], nextCursor: 'one',
  eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 3, rankedDetections: 2, excludedDetections: 1 },
  items: [{ key: 'one', detectionId: 'one', rank: 1, score: 2, at: 1, rankingVersion: 'fixture', scoreExplanation: 'Measured score', categoryMissing: false,
    login: 'creator', streamId: 'stream1', offsetSeconds: 60, label: 'Reaction', provenance: 'hub' }], coverage: { state: 'partial', scope: 'time_and_creator_only', indexedStreams: 1, measuredMinutes: 1 },
  freshness: 'ready', projectionUpdatedAt: null, dataThrough: null } as transport.RankedDiscovery
afterEach(() => vi.restoreAllMocks())
it('retains rows on continuation failure and replaces atomically on explicit reload', async () => {
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockResolvedValueOnce(data).mockRejectedValueOnce({ code: 'discovery_cursor_changed' })
  const { result } = renderHook(() => useRankedDiscovery(true, scope))
  await waitFor(() => expect(result.current.data).toEqual(data))
  act(() => { result.current.loadMore(); result.current.loadMore() })
  await waitFor(() => expect(result.current.error).toContain('snapshot'))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(result.current.data?.items).toEqual(data.items)
  expect(result.current.canLoad).toBe(false)
  let resolve!: (v: transport.RankedDiscovery) => void
  fetch.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.loading).toBe(true))
  expect(result.current.data).toEqual(data)
  const fresh = { ...data, asOf: '2026-09-13T13:00:00Z', items: [], nextCursor: null,
    eligibility: { ...data.eligibility, totalDetections: 1, rankedDetections: 0 } }
  await act(async () => resolve(fresh))
  expect(result.current.data).toEqual(fresh)
})
it('aborts obsolete scope and ignores late responses even when transport ignores abort', async () => {
  let resolve!: (v: transport.RankedDiscovery) => void
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValueOnce({ ...data, items: [], nextCursor: null })
  const { result, rerender, unmount } = renderHook(({ creator }) => useRankedDiscovery(true, { ...scope, creator }), { initialProps: { creator: '' } })
  rerender({ creator: 'other' })
  await waitFor(() => expect(result.current.data?.items).toEqual([]))
  expect(fetch.mock.calls[0][1].aborted).toBe(true)
  await act(async () => resolve(data))
  expect(result.current.data?.items).toEqual([])
  unmount()
})
