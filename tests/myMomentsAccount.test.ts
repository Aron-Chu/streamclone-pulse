import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
const f = vi.hoisted(() => ({ accountId: 'one' as string | null, pages: vi.fn(), save: vi.fn(), remove: vi.fn(), data: new Map<string, PersonalData>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ supporterAccount: { run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: f.save, deletePulseBookmark: f.remove }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))
beforeEach(() => {
  f.accountId = 'one'; f.data.clear(); f.pages.mockReset(); f.save.mockReset(); f.remove.mockReset()
  vi.stubGlobal('chrome', {})
})
afterEach(() => vi.unstubAllGlobals())
const load = () => handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {}) as Promise<{ snapshot: { scope: string; moments: { note: string }[]; bookmarksState: string } }>
const item = { id: 'bk', login: 'xqc', vodId: '123', offsetSeconds: 1, label: 'saved', notes: '', createdAt: new Date().toISOString() }
it('scopes server requests and local notes to account identity, retaining notes after reconnect', async () => {
  f.pages.mockResolvedValue({ items: [item] })
  const one = await load()
  expect(f.pages).toHaveBeenLastCalledWith({ limit: 100, cursor: undefined }, undefined, 'one')
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: one.snapshot.scope, command: { kind: 'edit', id: 'bk', note: 'private note' } }, {})
  f.accountId = 'two'
  expect((await load()).snapshot.moments[0].note).toBe('')
  await expect(handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: one.snapshot.scope, command: { kind: 'unsave', id: 'bk' } }, {})).rejects.toThrow('connection changed')
  expect(f.remove).not.toHaveBeenCalled()
  f.accountId = null
  expect((await load()).snapshot.bookmarksState).toBe('not_linked')
  f.accountId = 'one'
  expect((await load()).snapshot.moments[0].note).toBe('private note')
})
it('discards a paginated response when the linked account changes during the request', async () => {
  f.pages.mockImplementation(async () => { f.accountId = 'two'; return { items: [item], nextCursor: 'next' } })
  await expect(load()).rejects.toThrow('connection changed')
  expect(f.pages).toHaveBeenCalledTimes(1)
})
it('keeps local history and notes available during a backend outage without claiming server success', async () => {
  f.pages.mockRejectedValue(new Error('bookmarks 503'))
  const scope = 'https://api.streampulse.stream|account:one'
  f.data.set(scope, { ...emptyPersonalData(), notes: { local: 'offline note' }, history: [{ id: 'local', channel: 'xqc', title: 'local', vodId: '123', offsetSeconds: 1, availability: 'unresolved', note: '', jumpedAt: Date.now() }] })
  const result = await load()
  expect(result.snapshot.bookmarksState).toBe('error')
  expect(result.snapshot.moments).toMatchObject([{ note: 'offline note' }])
})
