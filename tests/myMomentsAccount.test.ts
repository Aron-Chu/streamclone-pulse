import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleDeviceBookmarks, handleMyMoments, removePanelBookmark, restoreRemovedNote } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import type { PulseBookmark } from '../src/shared/messages.ts'
import { MomentListItem } from '../src/ui/library/LibraryPrimitives.tsx'
import { replayUrl, type LibraryMoment } from '../src/ui/library/model.ts'
const f = vi.hoisted(() => ({ accountId: 'one' as string | null, pages: vi.fn(), save: vi.fn(), remove: vi.fn(), data: new Map<string, PersonalData>(), failWrite: false }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined, supporterAccount: { isInstallationIdentity: async () => false, run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: f.save, deletePulseBookmark: f.remove }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); if (f.failWrite) throw new Error('write failed'); f.data.set(scope, next); return next
} }))
beforeEach(() => {
  f.accountId = 'one'; f.failWrite = false; f.data.clear(); f.pages.mockReset(); f.save.mockReset(); f.remove.mockReset()
  vi.stubGlobal('chrome', {})
})
afterEach(() => vi.unstubAllGlobals())
const load = () => handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {}) as Promise<{ snapshot: { scope: string; moments: { note: string }[]; bookmarksState: string } }>
const item = { id: 'bk', login: 'xqc', vodId: '123', offsetSeconds: 1, label: 'saved', notes: '', createdAt: new Date().toISOString() }

function reviewStore() {
  const data: Record<string, unknown> = {}
  vi.stubGlobal('chrome', { storage: { local: {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (values: Record<string, unknown>) => Object.assign(data, values),
  } } })
  return data
}
const reviewSaveRequest = (offsetSeconds: number) => ({ type: 'SAVE_BOOKMARK' as const, bookmark: { login: 'xqc', streamId: '123456', offsetSeconds, source: 'extension' as const } })

it('offers a review only for the third new committed device save, ignoring duplicates and Undo restores', async () => {
  f.accountId = null
  const local = reviewStore()
  expect(await handleDeviceBookmarks(reviewSaveRequest(1), {})).not.toHaveProperty('reviewRequest')
  expect(await handleDeviceBookmarks(reviewSaveRequest(1), {})).not.toHaveProperty('reviewRequest')
  expect(local['pulseReviewRequest.v1']).toEqual({ bookmarks: 1, offered: false })
  await handleDeviceBookmarks({ ...reviewSaveRequest(2), restoreOf: 'removed' }, {})
  expect(local['pulseReviewRequest.v1']).toEqual({ bookmarks: 1, offered: false })
  await handleDeviceBookmarks(reviewSaveRequest(3), {})
  expect(await handleDeviceBookmarks(reviewSaveRequest(4), {})).toHaveProperty('reviewRequest', true)
  expect(await handleDeviceBookmarks(reviewSaveRequest(5), {})).not.toHaveProperty('reviewRequest')
  expect(local['pulseReviewRequest.v1']).toEqual({ bookmarks: 3, offered: true })
})

it('does not count a failed bookmark write or private/account saves', async () => {
  f.accountId = null
  const local = reviewStore()
  f.failWrite = true
  await expect(handleDeviceBookmarks(reviewSaveRequest(1), {})).rejects.toThrow('write failed')
  expect(local['pulseReviewRequest.v1']).toBeUndefined()
  f.failWrite = false
  expect(await handleDeviceBookmarks(reviewSaveRequest(2), { tab: { incognito: true } as chrome.tabs.Tab })).toBeNull()
  expect(local['pulseReviewRequest.v1']).toBeUndefined()
  f.accountId = 'linked'
  expect(await handleDeviceBookmarks(reviewSaveRequest(3), {})).toBeNull()
  expect(local['pulseReviewRequest.v1']).toBeUndefined()
})
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
const row = (moment: LibraryMoment) => renderToStaticMarkup(createElement(MomentListItem, { moment, personalWorkspace: true, recent: false, busy: false,
  onSave: () => undefined, onEdit: () => undefined, onRemove: () => undefined }))
it('links a VOD bookmark to its saved second, keeping the analytics link', async () => {
  // Bookmark offsets are stream offsets; with no stored origin delta the VOD
  // second is the same one the overlay's own VOD jump uses.
  f.pages.mockResolvedValue({ items: [{ ...item, vodId: '1234567890', streamId: '123456', offsetSeconds: 754 }] })
  const [moment] = (await load()).snapshot.moments as unknown as LibraryMoment[]
  expect(moment.availability).toBe('available')
  expect(replayUrl(moment)).toBe('https://www.twitch.tv/videos/1234567890?t=754s')
  const html = row(moment)
  expect(html).toContain('href="https://www.twitch.tv/videos/1234567890?t=754s"')
  expect(html).toContain('href="https://streampulse.stream/analytics/xqc/123456#t=754"')
  expect(html).not.toContain('Replay link unavailable')
})
it('leaves a stream-only bookmark unresolved and still offers analytics', async () => {
  f.pages.mockResolvedValue({ items: [{ ...item, vodId: undefined, streamId: '123456', offsetSeconds: 754 }] })
  const [moment] = (await load()).snapshot.moments as unknown as LibraryMoment[]
  expect(moment.availability).toBe('unresolved')
  expect(replayUrl(moment)).toBeNull()
  const html = row(moment)
  expect(html).not.toContain('/videos/')
  // No dashed "Replay link unavailable" slot: the row simply has no replay link.
  expect(html).not.toContain('Replay link unavailable')
  expect(html).toContain('href="https://streampulse.stream/analytics/xqc/123456#t=754"')
})
const deviceSave = (offsetSeconds: number, extra: object = {}) => handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark: {
  login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds, label: 'Chat spike', source: 'extension', ...extra } }, {}) as Promise<{ type: string; device?: true; item: { id: string } } | null>
const deviceList = (filter: object) => handleDeviceBookmarks({ type: 'LIST_BOOKMARKS', login: 'xqc', ...filter }, {}) as Promise<{ items: { id: string }[]; nextCursor?: string; device?: true }>
it('saves on this device without an account, once per moment, and never calls the hosted API', async () => {
  f.accountId = null
  const first = await deviceSave(120)
  expect(first).toMatchObject({ type: 'BOOKMARK', device: true, item: { login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 120, label: 'Chat spike' } })
  expect(first!.item.id).toMatch(/^local:/)
  // Same channel, stream and second: the existing save comes back.
  expect((await deviceSave(120.6, { vodId: undefined })).item.id).toBe(first!.item.id)
  expect(await deviceList({ streamId: '123456', limit: 100 })).toMatchObject({ device: true, items: [{ id: first!.item.id }] })
  expect((await deviceList({ streamId: '999999' })).items).toEqual([])
  await expect(deviceSave(120, { login: 'Not A Login' })).rejects.toThrow('invalid_bookmark')
  await expect(deviceSave(120, { streamId: undefined, vodId: undefined })).rejects.toThrow('invalid_bookmark')
  const { snapshot } = await load() as unknown as { snapshot: { scope: string; bookmarksState: string; moments: LibraryMoment[] } }
  expect(snapshot.bookmarksState).toBe('not_linked')
  expect(snapshot.moments).toMatchObject([{ id: first!.item.id, savedAt: expect.any(Number), availability: 'available' }])
  expect([f.pages, f.save, f.remove].every(mock => mock.mock.calls.length === 0)).toBe(true)
})
it('pages device saves newest first with the same cursor contract', async () => {
  f.accountId = null
  const older = await deviceSave(60)
  await new Promise(resolve => setTimeout(resolve, 2))
  const newer = await deviceSave(90)
  const page = await deviceList({ streamId: '123456', limit: 1 })
  expect(page).toMatchObject({ items: [{ id: newer!.item.id }], nextCursor: '1' })
  expect(await deviceList({ streamId: '123456', limit: 1, cursor: page.nextCursor })).toEqual({ type: 'BOOKMARKS', items: [expect.objectContaining({ id: older!.item.id })], device: true })
})
it('edits and removes device saves from the library without the network', async () => {
  f.accountId = null
  const scope = (await load()).snapshot.scope
  const reference = { id: 'watched', channel: 'xqc', title: 'Watched moment', vodId: null, streamId: '123456', offsetSeconds: 300, availability: 'unresolved' as const }
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'save', reference } }, {})
  const saved = (await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'save', reference } }, {}) as { snapshot: { moments: LibraryMoment[] } }).snapshot.moments
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ title: 'Watched moment', availability: 'unresolved', savedAt: expect.any(Number) })
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'edit', id: saved[0].id, note: 'device note' } }, {})
  expect((await load()).snapshot.moments[0].note).toBe('device note')
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'unsave', id: saved[0].id } }, {})
  expect((await load()).snapshot.moments).toEqual([])
  expect(f.data.get(scope)).toMatchObject({ bookmarks: [], notes: {} })
  expect([f.pages, f.save, f.remove].every(mock => mock.mock.calls.length === 0)).toBe(true)
})
it('keeps the hosted path for linked accounts and private windows', async () => {
  expect(await deviceSave(120)).toBeNull()
  f.accountId = null
  expect(await handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark: { login: 'xqc', streamId: '123456', offsetSeconds: 1, source: 'extension' } }, { tab: { incognito: true } as chrome.tabs.Tab })).toBeNull()
  expect(f.data.size).toBe(0)
})
it('keeps device saves out of the linked list but reports them for a later import', async () => {
  f.accountId = null
  const local = await deviceSave(120)
  const scope = (await load()).snapshot.scope
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'edit', id: local!.item.id, note: 'kept here' } }, {})
  f.accountId = 'one'
  f.pages.mockResolvedValue({ items: [item] })
  const { snapshot } = await load() as unknown as { snapshot: { moments: LibraryMoment[]; deviceBookmarks: { id: string; notes: string }[] } }
  expect(snapshot.moments.map(m => m.id)).toEqual(['bk'])
  expect(snapshot.deviceBookmarks).toMatchObject([{ id: local!.item.id, notes: 'kept here' }])
  expect(f.save).not.toHaveBeenCalled()
})
it('removes a pre-link device save while linked without touching the account', async () => {
  f.accountId = null
  const local = await deviceSave(120)
  const before = (await load()).snapshot.scope
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: before, command: { kind: 'edit', id: local!.item.id, note: 'kept here' } }, {})
  f.accountId = 'one'
  f.pages.mockResolvedValue({ items: [item] })
  const scope = (await load()).snapshot.scope
  const { snapshot } = await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'unsave', id: local!.item.id } }, {}) as { snapshot: { moments: LibraryMoment[]; deviceBookmarks: unknown[] } }
  expect(snapshot.deviceBookmarks).toEqual([])
  expect(snapshot.moments.map(m => m.id)).toEqual(['bk'])
  expect(f.data.get(before)).toMatchObject({ bookmarks: [], notes: {} })
  expect(f.remove).not.toHaveBeenCalled()
  // Editing stays limited to the account's own bookmarks.
  const again = await deviceSaveWhileSignedOut()
  await expect(handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'edit', id: again, note: 'no' } }, {})).rejects.toThrow('Bookmark unavailable')
  // A hosted bookmark is still removed on the account.
  await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command: { kind: 'unsave', id: 'bk' } }, {})
  expect(f.remove).toHaveBeenCalledWith('bk', undefined, 'one')
})
async function deviceSaveWhileSignedOut(): Promise<string> {
  const account = f.accountId
  f.accountId = null
  const saved = await deviceSave(240)
  f.accountId = account
  return saved!.item.id
}
it('reads the popup\'s recent moments from this device only, newest first', async () => {
  f.accountId = null
  const scope = (await load()).snapshot.scope
  const now = Date.now()
  const watched = (id: string, jumpedAt: number, expires = now + 86_400_000): LibraryMoment => ({ id, channel: 'xqc', title: `Moment ${id}`, vodId: '2806037629', offsetSeconds: 3600, availability: 'unresolved', jumpedAt, historyExpiresAt: expires, note: '' })
  f.data.set(scope, { ...emptyPersonalData(), history: [watched('old', now - 3_000), watched('expired', now - 1_000, now - 1), watched('new', now - 2_000), watched('newest', now - 500)] })
  await deviceSave(60)
  const { recent } = await handleMyMoments({ type: 'MY_MOMENTS', action: 'recent' }, {}) as { recent: { watched: Array<LibraryMoment & { jumpedAt: number }>; deviceSaves: number; latestSave: LibraryMoment | null } }
  expect(recent.watched.map(m => m.id)).toEqual(['newest', 'new'])
  // A numeric VOD id makes the replay link available.
  expect(recent.watched[0]).toMatchObject({ availability: 'available', jumpedAt: now - 500 })
  expect(recent.deviceSaves).toBe(1)
  expect(recent.latestSave).toMatchObject({ channel: 'xqc', offsetSeconds: 60 })
  expect([f.pages, f.save, f.remove].every(mock => mock.mock.calls.length === 0)).toBe(true)
})
it('counts device saves for the popup while an account is linked, without listing hosted bookmarks', async () => {
  f.accountId = null
  await deviceSave(60)
  f.accountId = 'one'
  const { recent } = await handleMyMoments({ type: 'MY_MOMENTS', action: 'recent' }, {}) as { recent: { watched: unknown[]; deviceSaves: number } }
  expect(recent).toMatchObject({ watched: [], deviceSaves: 1 })
  expect(f.pages).not.toHaveBeenCalled()
})
const panelRemove = (message: object = {}, sender: chrome.runtime.MessageSender = {}) =>
  removePanelBookmark({ type: 'REMOVE_BOOKMARK', id: 'bk', login: 'xqc', streamId: '123456', ...message }, sender)
it('removes a device save from the panel only for its own channel and stream', async () => {
  f.accountId = null
  const saved = await deviceSave(120)
  const id = saved!.item.id
  await expect(panelRemove({ id, login: 'shroud' })).rejects.toThrow('bookmark_not_found')
  await expect(panelRemove({ id, streamId: '999999' })).rejects.toThrow('bookmark_not_found')
  expect(await panelRemove({ id })).toEqual({ type: 'REMOVE_BOOKMARK', ok: true, device: true })
  expect((await deviceList({ streamId: '123456' })).items).toEqual([])
  await expect(panelRemove({ id })).rejects.toThrow('bookmark_not_found')
  expect([f.pages, f.save, f.remove].every(mock => mock.mock.calls.length === 0)).toBe(true)
})
it('removes an account save from the panel once it finds it on that stream, dropping its note', async () => {
  const scope = 'https://api.streampulse.stream|account:one'
  f.data.set(scope, { ...emptyPersonalData(), notes: { bk: 'gone with it', other: 'kept' } })
  f.pages.mockResolvedValueOnce({ items: [], nextCursor: 'next' }).mockResolvedValueOnce({ items: [{ ...item, streamId: '123456' }] })
  expect(await panelRemove()).toEqual({ type: 'REMOVE_BOOKMARK', ok: true })
  expect(f.pages).toHaveBeenNthCalledWith(1, { login: 'xqc', streamId: '123456', vodId: undefined, limit: 100 }, undefined, 'one')
  expect(f.pages).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'next' }), undefined, 'one')
  expect(f.remove).toHaveBeenCalledWith('bk', undefined, 'one')
  expect(f.data.get(scope)?.notes).toEqual({ other: 'kept' })
})
it('puts the note an account save kept on this device back on Undo, once, without uploading it', async () => {
  const scope = 'https://api.streampulse.stream|account:one'
  const removed = { ...item, streamId: '123456' } as PulseBookmark
  f.data.set(scope, { ...emptyPersonalData(), notes: { bk: 'my private note' } })
  f.pages.mockResolvedValue({ items: [removed] })
  await panelRemove()
  expect(f.data.get(scope)?.notes).toEqual({})
  // Undo's new save: same moment, new id.
  await restoreRemovedNote('bk', { ...removed, id: 'bk2' }, {})
  expect(f.data.get(scope)?.notes).toEqual({ bk2: 'my private note' })
  await restoreRemovedNote('bk', { ...removed, id: 'bk3' }, {})
  expect(f.data.get(scope)?.notes).toEqual({ bk2: 'my private note' })
  expect(f.save).not.toHaveBeenCalled()
})
it('keeps a removed note out of another moment, account, private window, or a late Undo', async () => {
  const scope = 'https://api.streampulse.stream|account:one'
  const removed = { ...item, streamId: '123456' } as PulseBookmark
  f.pages.mockResolvedValue({ items: [removed] })
  const removeWithNote = async () => {
    f.data.set(scope, { ...emptyPersonalData(), notes: { bk: 'my private note' } })
    await panelRemove()
  }
  await removeWithNote()
  await restoreRemovedNote('bk', { ...removed, id: 'other', offsetSeconds: 600 }, {})
  await removeWithNote()
  await restoreRemovedNote('bk', { ...removed, id: 'private' }, { tab: { incognito: true } as chrome.tabs.Tab })
  await removeWithNote()
  f.accountId = 'two'
  await restoreRemovedNote('bk', { ...removed, id: 'switched' }, {})
  f.accountId = 'one'
  await removeWithNote()
  const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121_000)
  await restoreRemovedNote('bk', { ...removed, id: 'late' }, {})
  later.mockRestore()
  expect(f.data.get(scope)?.notes).toEqual({})
  expect(f.data.get('https://api.streampulse.stream|account:two')?.notes ?? {}).toEqual({})
})
it('puts a device save\'s note back on Undo', async () => {
  f.accountId = null
  const scope = 'https://api.streampulse.stream|local'
  const first = (await deviceSave(120))!.item
  f.data.set(scope, { ...f.data.get(scope)!, notes: { [first.id]: 'device note' } })
  await panelRemove({ id: first.id })
  const again = (await deviceSave(120))!.item
  expect(again.id).not.toBe(first.id)
  await restoreRemovedNote(first.id, again as PulseBookmark, {})
  expect(f.data.get(scope)?.notes).toEqual({ [again.id]: 'device note' })
})
it('finds a VOD-only account save by its VOD', async () => {
  f.pages.mockResolvedValue({ items: [item] })
  expect(await panelRemove({ streamId: undefined, vodId: '123' })).toEqual({ type: 'REMOVE_BOOKMARK', ok: true })
  expect(f.pages).toHaveBeenCalledWith(expect.objectContaining({ login: 'xqc', vodId: '123' }), undefined, 'one')
})
it('never removes an account save of another channel or stream from the panel', async () => {
  f.pages.mockResolvedValue({ items: [{ ...item, login: 'shroud', streamId: '123456' }, { ...item, streamId: '999999' }] })
  await expect(panelRemove()).rejects.toThrow('bookmark_not_found')
  await expect(panelRemove({ streamId: undefined, vodId: '999' })).rejects.toThrow('bookmark_not_found')
  expect(f.remove).not.toHaveBeenCalled()
})
