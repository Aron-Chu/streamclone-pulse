import { afterEach, expect, it, vi } from 'vitest'
import { loadCategoryArtwork, categoryArtworkKey, useCategoryArtwork } from '../src/lib/categoryArtwork'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { apiClient } from '../src/lib/momentsApiClient'

vi.mock('../src/lib/momentsApiClient', () => ({ apiClient: vi.fn(), getBackendUrl: () => 'https://fixture.invalid' }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })
it('deduplicates ID requests, validates matching identity, and never persists catalogue metadata', async () => {
  const before = localStorage.length
  vi.mocked(apiClient).mockResolvedValue({ status: 200, data: { items: [
    { index: 0, status: 'resolved', categoryId: '987', name: 'Renamed', matchedBy: 'id', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/987_IGDB-210x280.jpg' },
    { index: 1, status: 'resolved', categoryId: '123', name: 'Not exact', matchedBy: 'name', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/123-210x280.jpg' },
  ] } })
  const input = [{ categoryId: '987', name: 'Old' }, { categoryId: '987', name: 'Old' }, { name: 'Exact only' }]
  const result = await loadCategoryArtwork(input, new AbortController().signal)
  expect(apiClient).toHaveBeenCalledTimes(1)
  expect(result.get(categoryArtworkKey(input[0]))?.status).toBe('resolved')
  expect(result.get(categoryArtworkKey(input[2]))?.status).toBe('unavailable')
  expect(localStorage.length).toBe(before)
})
it('handles an undeployed endpoint without retries', async () => {
  vi.mocked(apiClient).mockRejectedValue({ status: 404 })
  const result = await loadCategoryArtwork([{ name: 'Undeployed' }], new AbortController().signal)
  expect(result.get('name:Undeployed')?.status).toBe('unavailable')
  await loadCategoryArtwork([{ name: 'Undeployed' }], new AbortController().signal)
  expect(apiClient).toHaveBeenCalledTimes(1)
})

it.each([404, 503])('does not create a %i retry loop across cooldown expiry or rerenders', async status => {
  vi.useFakeTimers()
  vi.mocked(apiClient).mockRejectedValue({ status })
  const hook = renderHook(() => useCategoryArtwork([{ name: `StableFailure${status}` }]))
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(hook.result.current.get(`name:StableFailure${status}`)?.status).toBe('unavailable')
  hook.rerender()
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(apiClient).toHaveBeenCalledTimes(1)
})

it('attempts every distinct eligible category in byte-bounded batches with no per-row requests', async () => {
  vi.useFakeTimers()
  vi.mocked(apiClient).mockImplementation(async (_path, options) => {
    const items = (options!.body as { items: { name: string }[] }).items
    expect(items.length).toBeLessThanOrEqual(50)
    expect(new TextEncoder().encode(JSON.stringify(options!.body)).length).toBeLessThanOrEqual(16 * 1024)
    return { status: 200, data: { items: items.map((_, index) => ({ index, status: 'not_found' })) } }
  })
  const items = Array.from({ length: 101 }, (_, i) => ({ name: `Batch${i}` + '"'.repeat(180) }))
  const pending = loadCategoryArtwork([...items, ...items], new AbortController().signal)
  await vi.runAllTimersAsync()
  expect((await pending).size).toBe(101)
  expect(apiClient).toHaveBeenCalledTimes(3)
})

it('does not let an obsolete response hydrate a replacement scope', async () => {
  let release!: (value: any) => void
  vi.mocked(apiClient).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockResolvedValue({ status: 200, data: { items: [{ index: 0, status: 'not_found' }] } })
  const hook = renderHook(({ name }) => useCategoryArtwork([{ name }]), { initialProps: { name: 'StaleA' } })
  hook.rerender({ name: 'CurrentB' })
  await waitFor(() => expect(hook.result.current.get('name:CurrentB')?.status).toBe('not_found'))
  await act(async () => { release({ status: 200, data: { items: [{ index: 0, status: 'not_found' }] } }) })
  expect(hook.result.current.has('name:StaleA')).toBe(false)
  expect(hook.result.current.get('name:CurrentB')?.status).toBe('not_found')
  await loadCategoryArtwork([{ name: 'StaleA' }], new AbortController().signal)
  expect(apiClient).toHaveBeenCalledTimes(3) // Cancelled response was not cached.
})

it('rejects ID mismatches and malformed input without resolving via a name', async () => {
  vi.mocked(apiClient).mockResolvedValue({ status: 200, data: { items: [{ index: 0, status: 'resolved', categoryId: '2', name: 'Same', matchedBy: 'name', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/2-210x280.jpg' }] } })
  const result = await loadCategoryArtwork([{ categoryId: '10001', name: 'Same' }, { categoryId: 'invalid', name: 'Same' }, { name: 'bad\nname' }], new AbortController().signal)
  expect(result.size).toBe(1)
  expect(result.get('id:10001')?.status).toBe('unavailable')
  expect(apiClient).toHaveBeenCalledTimes(1)
})
