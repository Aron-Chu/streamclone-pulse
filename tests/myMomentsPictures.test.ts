import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetAccountScope, handleDeviceBookmarks, handleMyMoments, handlePicture, removePanelBookmark, wantSavedPicture } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import { resetPictureWants } from '../src/background/momentPictures.ts'
import type { SavedPicture } from '../src/shared/momentPictureStore.ts'
import type { CreatePulseBookmarkInput } from '../src/shared/messages.ts'

/**
 * A save made on a Twitch tab keeps the frame that tab holds; the picture goes
 * with the save, with History, or when the account it belongs to signs out.
 */
const f = vi.hoisted(() => ({ accountId: null as string | null, pages: vi.fn(), save: vi.fn(), remove: vi.fn(), on: true,
  data: new Map<string, PersonalData>(), pictures: new Map<string, SavedPicture>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: f.save, deletePulseBookmark: f.remove }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
}, deletePersonal: async (scope: string) => { f.data.delete(scope) } }))
vi.mock('../src/shared/storage.ts', async original => ({ ...await original<object>(), getMomentPicturesEnabled: async () => f.on }))
vi.mock('../src/shared/momentPictureStore.ts', async original => {
  const real = await original<typeof import('../src/shared/momentPictureStore.ts')>()
  return { ...real, momentPictures: new real.MomentPictureStore({
    all: async () => [...f.pictures.values()],
    get: async key => f.pictures.get(key),
    put: async picture => { f.pictures.set(picture.key, picture) },
    remove: async keys => { for (const key of keys) f.pictures.delete(key) },
  }) }
})
const root = 'https://api.streampulse.stream'
const localScope = `${root}|local`
const accountScope = `${root}|account:one`
const JPEG = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4))}`
const tab = { tab: { id: 7, url: 'https://www.twitch.tv/xqc', incognito: false } as chrome.tabs.Tab, frameId: 0 }
const sendMessage = vi.fn(async (..._args: unknown[]) => undefined)
const bookmark: CreatePulseBookmarkInput = { login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 125, label: 'Clutch', source: 'extension' }
beforeEach(() => {
  f.accountId = null; f.on = true; f.data.clear(); f.pictures.clear(); f.pages.mockReset(); f.save.mockReset(); f.remove.mockReset()
  sendMessage.mockClear(); resetPictureWants()
  vi.stubGlobal('chrome', { tabs: { sendMessage } })
})
afterEach(() => vi.unstubAllGlobals())

/** The token the worker last asked tab 7 with. */
const lastToken = () => (sendMessage.mock.calls.at(-1)?.[1] as { wants: { token: string }[] }).wants.at(-1)!.token
async function saveWithPicture() {
  const saved = await handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark }, tab) as { item: { id: string } }
  await wantSavedPicture(bookmark, tab)
  expect(await handlePicture({ type: 'MOMENT_PICTURE', action: 'frame', token: lastToken(), image: JPEG, offset: 121 }, tab)).toEqual({ type: 'MOMENT_PICTURE', ok: true })
  return saved.item.id
}
const keys = () => [...f.pictures.keys()]

describe('pictures kept with saves', () => {
  it('keeps the frame of a save made on a Twitch tab, through a My Moments load', async () => {
    await saveWithPicture()
    expect(sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'MOMENT_PICTURE_WANTS' }), { frameId: 0 })
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})
    expect(keys()).toEqual([`${localScope}\nxqc:123456:125`])
  })

  it('asks for nothing while Moment pictures is off', async () => {
    f.on = false
    await handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark }, tab)
    await wantSavedPicture(bookmark, tab)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('removing the save on the panel removes its picture', async () => {
    const id = await saveWithPicture()
    await removePanelBookmark({ type: 'REMOVE_BOOKMARK', id, login: 'xqc', streamId: '123456' }, tab)
    expect(keys()).toEqual([])
  })

  it('a save removed elsewhere loses its picture at the next load', async () => {
    await saveWithPicture()
    f.data.set(localScope, { ...f.data.get(localScope)!, bookmarks: [] })
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})
    expect(keys()).toEqual([])
  })

  it('an account’s list that failed to load removes nothing; signing out removes its pictures', async () => {
    f.accountId = 'one'
    f.save.mockResolvedValue({ id: 'acct-1', ...bookmark, notes: '', createdAt: new Date().toISOString() })
    await wantSavedPicture(bookmark, tab)
    await handlePicture({ type: 'MOMENT_PICTURE', action: 'frame', token: lastToken(), image: JPEG, offset: 121 }, tab)
    expect(keys()).toEqual([`${accountScope}\nxqc:123456:125`])
    f.pages.mockRejectedValue(new Error('offline'))
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})
    expect(keys()).toHaveLength(1)
    await forgetAccountScope('one')
    expect(keys()).toEqual([])
  })

  it('a jump to a saved moment gives it the picture it lacks; an unsaved one keeps none', async () => {
    const reference = { id: 'm', channel: 'xqc', title: 'Clutch', vodId: '1234567890', streamId: '123456', offsetSeconds: 125, availability: 'unresolved' as const }
    await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status', reference }, tab)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect((await handlePicture({ type: 'MOMENT_PICTURE', action: 'frame', token: lastToken(), image: JPEG, offset: 121 }, tab)).ok).toBe(false)
    await handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark }, tab)
    sendMessage.mockClear()
    await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status', reference }, tab)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect((await handlePicture({ type: 'MOMENT_PICTURE', action: 'frame', token: lastToken(), image: JPEG, offset: 121 }, tab)).ok).toBe(true)
  })

  it('a save added to the account takes its picture along', async () => {
    await saveWithPicture()
    f.accountId = 'one'
    const account: unknown[] = []
    f.pages.mockImplementation(async () => ({ items: account }))
    f.save.mockImplementation(async (input: CreatePulseBookmarkInput) => {
      const item = { id: 'acct-1', ...input, notes: '', createdAt: new Date().toISOString() }
      account.push(item)
      return item
    })
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'import-device-saves' } }, {})
    expect(keys()).toEqual([`${accountScope}\nxqc:123456:125`])
  })
})
