import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleDeviceBookmarks, handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import { parseMyMoments } from '../src/shared/myMoments.ts'

/**
 * "Add to account": saves made without an account join the signed-in account
 * only when asked. Each leaves this device only after the account confirms it,
 * a save the account already has is not posted again, and notes never leave
 * the device.
 */
const f = vi.hoisted(() => ({ accountId: null as string | null, pages: vi.fn(), save: vi.fn(), remove: vi.fn(), data: new Map<string, PersonalData>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: f.save, deletePulseBookmark: f.remove }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))
const root = 'https://api.streampulse.stream'
const accountScope = `${root}|account:one`
const localScope = `${root}|local`
beforeEach(() => {
  f.accountId = null; f.data.clear(); f.pages.mockReset(); f.save.mockReset(); f.remove.mockReset()
  vi.stubGlobal('chrome', {})
})
afterEach(() => vi.unstubAllGlobals())

const saveOnDevice = (offsetSeconds: number, label: string) => handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark: {
  login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds, label, source: 'extension' } }, {}) as Promise<{ item: { id: string } }>
const load = () => handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {}) as Promise<{ snapshot: { scope: string; deviceBookmarks: { id: string }[]; moments: { id: string; note: string; savedAt?: number }[] } }>
const add = (id?: string) => handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'import-device-saves', ...(id ? { id } : {}) } }, {}) as Promise<{ snapshot: { deviceBookmarks: { id: string }[] } }>
const hosted = (id: string, offsetSeconds: number) => ({ id, login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds, label: 'In account', notes: '', createdAt: new Date().toISOString() })

/** Two saves made signed out (one with a device note), then sign in. */
async function twoDeviceSaves() {
  const first = (await saveOnDevice(120, 'First')).item.id
  const second = (await saveOnDevice(240.7, 'Second')).item.id
  f.data.set(localScope, { ...f.data.get(localScope)!, notes: { [second]: 'my device note' } })
  f.accountId = 'one'
  return { first, second }
}

describe('Add saves made on this device to the account', () => {
  it('is offered as a validated command, one save or all', () => {
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'import-device-saves' } })).not.toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'import-device-saves', id: 'local:x' } })).not.toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'import-device-saves', id: '' } })).toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'import-device-saves', notes: 'x' } })).toBeNull()
  })

  it('adds all: posts only what the account lacks, keeps notes on the device, then removes the local copies', async () => {
    const { second } = await twoDeviceSaves()
    // The account already has the first save's second (120 s).
    f.pages.mockResolvedValue({ items: [hosted('acct-120', 120)] })
    f.save.mockImplementation(async (input: { offsetSeconds: number }) => hosted('acct-new', input.offsetSeconds))
    expect((await load()).snapshot.deviceBookmarks).toHaveLength(2)
    const result = await add()
    expect(f.save).toHaveBeenCalledTimes(1)
    expect(f.save).toHaveBeenCalledWith({ login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 240, label: 'Second', source: 'extension' }, undefined, 'one')
    expect(JSON.stringify(f.save.mock.calls)).not.toContain('my device note')
    expect(result.snapshot.deviceBookmarks).toEqual([])
    expect(f.data.get(localScope)!.bookmarks).toEqual([])
    expect(f.data.get(localScope)!.notes[second]).toBeUndefined()
    // The note follows the save into the account's local notes, still on this device.
    expect(f.data.get(accountScope)!.notes['acct-new']).toBe('my device note')
  })

  it('adds one save by id and leaves the others', async () => {
    const { first, second } = await twoDeviceSaves()
    f.pages.mockResolvedValue({ items: [] })
    f.save.mockImplementation(async (input: { offsetSeconds: number }) => hosted(`acct-${input.offsetSeconds}`, input.offsetSeconds))
    const result = await add(first)
    expect(f.save).toHaveBeenCalledTimes(1)
    expect(result.snapshot.deviceBookmarks.map(b => b.id)).toEqual([second])
  })

  it('keeps every save the account did not confirm', async () => {
    await twoDeviceSaves()
    f.pages.mockResolvedValue({ items: [] })
    f.save.mockResolvedValueOnce(hosted('acct-a', 120)).mockRejectedValueOnce(new Error('bookmark 503'))
    await expect(add()).rejects.toThrow('Added 1 of 2 to your account. The rest stay on this device')
    expect(f.data.get(localScope)!.bookmarks.map(b => b.label)).toEqual(['Second'])
  })

  it('posts nothing and keeps everything when the account bookmarks cannot be read', async () => {
    await twoDeviceSaves()
    f.pages.mockRejectedValue(new Error('bookmarks 503'))
    await expect(add()).rejects.toThrow('Could not reach StreamPulse. Your saves stay on this device.')
    expect(f.save).not.toHaveBeenCalled()
    expect(f.data.get(localScope)!.bookmarks).toHaveLength(2)
  })

  it('needs a signed-in account', async () => {
    await saveOnDevice(120, 'First')
    const signedOut = handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command: { kind: 'import-device-saves' } }, {})
    await expect(signedOut).rejects.toThrow('Sign in to add saves to your account.')
    expect(f.save).not.toHaveBeenCalled()
  })
})
