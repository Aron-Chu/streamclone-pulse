import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplayLookups } from '../src/background/bookmarkReplay.ts'
import { bindReplayLookups, handleDeviceBookmarks, handleMyMoments, keepSaveDelta } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import type { PulseBookmark } from '../src/shared/messages.ts'
import { parseMyMoments, validMomentReference, type DeviceBookmark } from '../src/shared/myMoments.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { replayUrl, type LibraryMoment, type MomentReference } from '../src/ui/library/model.ts'

/**
 * A saved moment's offset counts from go-live; Twitch's `?t=` counts from the
 * archive start. When the panel knows the archive started late (the payload's
 * `vodOriginDeltaSeconds`), the save keeps that delta and its replay link takes
 * it off, as the panel's own VOD jumps do. Device saves keep it on their row;
 * account saves keep it on this device beside the hosted id, since the hosted
 * bookmark cannot hold it. Saves without one keep today's link.
 */
const f = vi.hoisted(() => ({ accountId: null as string | null, pages: vi.fn(), save: vi.fn(), remove: vi.fn(), data: new Map<string, PersonalData>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { isInstallationIdentity: async () => false, run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: f.save, deletePulseBookmark: f.remove }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))
const root = 'https://api.streampulse.stream'
const localScope = `${root}|local`
const accountScope = `${root}|account:one`
const VOD = '2903344433'
beforeEach(() => {
  f.accountId = null; f.data.clear(); f.pages.mockReset(); f.save.mockReset(); f.remove.mockReset()
  bindReplayLookups({ pastVods: vi.fn<ReplayLookups['pastVods']>().mockResolvedValue([]), liveArchive: vi.fn<ReplayLookups['liveArchive']>().mockResolvedValue(null) })
  vi.stubGlobal('chrome', {})
})
afterEach(() => vi.unstubAllGlobals())

type Snapshot = { moments: LibraryMoment[]; deviceBookmarks: DeviceBookmark[] }
const load = async () => ((await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})) as { snapshot: Snapshot }).snapshot
const saved = (snapshot: Snapshot) => snapshot.moments.filter(m => m.savedAt !== undefined)
const mutate = (scope: string, command: object) => handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope, command } as never, {})
/** The panel's save, through the same parser the worker runs on every message. */
/** `vodId: null`: a stream-only save. */
async function panelSave(offsetSeconds: number, extra: Record<string, unknown> = {}, vodId: string | null = VOD) {
  const message = parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark: { login: 'zackrawrr', streamId: '123456', ...(vodId ? { vodId } : {}),
    offsetSeconds, label: 'Chat spike', source: 'extension' }, ...extra })
  if (message?.type !== 'SAVE_BOOKMARK') throw new Error('parser refused the save')
  return handleDeviceBookmarks(message, {}) as Promise<{ item: DeviceBookmark }>
}
const hosted = (id: string, offsetSeconds: number, vodId: string | null = VOD): PulseBookmark => ({ id, login: 'zackrawrr', streamId: '123456',
  ...(vodId ? { vodId } : {}), offsetSeconds, label: 'Chat spike', notes: '', source: 'extension', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })

describe('device saves keep the VOD origin delta', () => {
  it('a new save with the panel\'s delta links to the VOD second, not the stream second', async () => {
    const { item } = await panelSave(7375, { vodOriginDeltaSeconds: 95 })
    expect(item.vodOriginDeltaSeconds).toBe(95)
    const [moment] = saved(await load())
    expect(moment).toMatchObject({ id: item.id, offsetSeconds: 7375, vodOriginDeltaSeconds: 95, availability: 'available' })
    expect(replayUrl(moment!)).toBe(`https://www.twitch.tv/videos/${VOD}?t=7280s`)
    // The second it is saved at, and so its identity, stays on the stream's clock.
    expect(f.data.get(localScope)?.bookmarks[0]).toMatchObject({ offsetSeconds: 7375, vodId: VOD, vodOriginDeltaSeconds: 95 })
  })

  it('an old save without the field keeps today\'s link', async () => {
    const { item } = await panelSave(7375)
    expect('vodOriginDeltaSeconds' in item).toBe(false)
    const [moment] = saved(await load())
    expect('vodOriginDeltaSeconds' in moment!).toBe(false)
    expect(replayUrl(moment!)).toBe(`https://www.twitch.tv/videos/${VOD}?t=7375s`)
  })

  it('never keeps a zero delta, and never keeps one without a VOD id', async () => {
    expect((await panelSave(100, { vodOriginDeltaSeconds: 0 })).item).not.toHaveProperty('vodOriginDeltaSeconds')
    // A stream-only save with a delta is refused by the parser: the delta names a VOD.
    await expect(panelSave(200, { vodOriginDeltaSeconds: 95 }, null)).rejects.toThrow('parser refused')
    expect(f.data.get(localScope)?.bookmarks).toHaveLength(1)
  })

  it('saving the same second again keeps the first row as it was', async () => {
    const { item } = await panelSave(7375, { vodOriginDeltaSeconds: 95 })
    expect((await panelSave(7375, { vodOriginDeltaSeconds: 30 })).item).toEqual(item)
    expect(f.data.get(localScope)?.bookmarks).toEqual([item])
  })

  it('a delta that runs past the archive start lands on its first second', async () => {
    const { item } = await panelSave(40, { vodOriginDeltaSeconds: 95 })
    expect(replayUrl(saved(await load()).find(m => m.id === item.id)!)).toBe(`https://www.twitch.tv/videos/${VOD}?t=0s`)
  })

  it('My Moments\' own save keeps the delta its reference carries', async () => {
    const reference: MomentReference = { id: 'x', channel: 'zackrawrr', title: 'Chat spike', vodId: VOD, streamId: '123456', offsetSeconds: 600,
      vodOriginDeltaSeconds: -12, availability: 'available' }
    await mutate(localScope, { kind: 'save', reference })
    const [moment] = saved(await load())
    expect(moment).toMatchObject({ offsetSeconds: 600, vodOriginDeltaSeconds: -12 })
    expect(replayUrl(moment!)).toBe(`https://www.twitch.tv/videos/${VOD}?t=612s`)
  })

  it('"Add to account" moves the delta beside the hosted id, and posts none of it', async () => {
    const { item } = await panelSave(7375, { vodOriginDeltaSeconds: 95 })
    f.accountId = 'one'
    f.pages.mockResolvedValueOnce({ items: [] })
    f.save.mockResolvedValue(hosted('acct-9', 7375))
    await mutate(accountScope, { kind: 'import-device-saves', id: item.id })
    expect(f.save).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(f.save.mock.calls[0]![0])).not.toContain('vodOriginDelta')
    expect(f.data.get(accountScope)?.replayDeltas).toEqual({ 'acct-9': { vodId: VOD, seconds: 95 } })
    expect(f.data.get(localScope)?.bookmarks).toEqual([])
  })
})

describe('account saves keep the delta on this device', () => {
  beforeEach(() => { f.accountId = 'one' })

  it('a panel save in the account keeps it beside its id; the hosted bookmark is posted without it', async () => {
    const message = parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark: { login: 'zackrawrr', streamId: '123456', vodId: VOD,
      offsetSeconds: 7375, label: 'Chat spike', source: 'extension' }, vodOriginDeltaSeconds: 95 })
    // The worker posts `message.bookmark` as the request body.
    expect(message).toMatchObject({ type: 'SAVE_BOOKMARK', vodOriginDeltaSeconds: 95 })
    expect(JSON.stringify((message as { bookmark: unknown }).bookmark)).not.toContain('vodOriginDelta')
    // Signed in, the device path stands aside for the hosted one.
    expect(await handleDeviceBookmarks(message as never, {})).toBeNull()
    await keepSaveDelta(hosted('acct-1', 7375), VOD, 95, {})
    expect(f.data.get(accountScope)?.replayDeltas).toEqual({ 'acct-1': { vodId: VOD, seconds: 95 } })
    f.pages.mockResolvedValue({ items: [hosted('acct-1', 7375), hosted('acct-2', 900)] })
    const moments = saved(await load())
    expect(replayUrl(moments.find(m => m.id === 'acct-1')!)).toBe(`https://www.twitch.tv/videos/${VOD}?t=7280s`)
    // A save made elsewhere (another browser, the website) has none: today's link.
    const other = moments.find(m => m.id === 'acct-2')!
    expect('vodOriginDeltaSeconds' in other).toBe(false)
    expect(replayUrl(other)).toBe(`https://www.twitch.tv/videos/${VOD}?t=900s`)
  })

  it('a kept delta for another VOD than the save names is ignored', async () => {
    await keepSaveDelta(hosted('acct-1', 7375), VOD, 95, {})
    f.pages.mockResolvedValue({ items: [hosted('acct-1', 7375, '2900000001')] })
    expect(replayUrl(saved(await load())[0]!)).toBe('https://www.twitch.tv/videos/2900000001?t=7375s')
  })

  it('keeps nothing in private browsing, for stream-only saves, for a zero delta, or for another VOD', async () => {
    await keepSaveDelta(hosted('acct-1', 100), VOD, 95, { tab: { incognito: true } as chrome.tabs.Tab })
    await keepSaveDelta(hosted('acct-2', 200, null), undefined, 95, {})
    await keepSaveDelta(hosted('acct-3', 300), VOD, 0, {})
    await keepSaveDelta(hosted('acct-4', 400), VOD, undefined, {})
    // The account answered with another VOD than the delta was sent for.
    await keepSaveDelta(hosted('acct-5', 500, '2900000001'), VOD, 95, {})
    expect(f.data.get(accountScope)?.replayDeltas).toBeUndefined()
  })

  it('keeps nothing signed out: the device row holds it there', async () => {
    f.accountId = null
    await keepSaveDelta(hosted('acct-1', 100), VOD, 95, {})
    expect(f.data.get(accountScope)).toBeUndefined()
    expect(f.data.get(localScope)?.replayDeltas).toBeUndefined()
  })

  it('My Moments\' own save keeps it for the new hosted id, and Remove drops it', async () => {
    f.pages.mockResolvedValue({ items: [] })
    f.save.mockResolvedValue(hosted('acct-5', 600))
    await mutate(accountScope, { kind: 'save', reference: { id: 'x', channel: 'zackrawrr', title: 'Chat spike', vodId: VOD, streamId: '123456',
      offsetSeconds: 600, vodOriginDeltaSeconds: 45, availability: 'available' } })
    expect(JSON.stringify(f.save.mock.calls[0]![0])).not.toContain('vodOriginDelta')
    expect(f.data.get(accountScope)?.replayDeltas).toEqual({ 'acct-5': { vodId: VOD, seconds: 45 } })
    f.pages.mockResolvedValue({ items: [hosted('acct-5', 600)] })
    expect(replayUrl(saved(await load())[0]!)).toBe(`https://www.twitch.tv/videos/${VOD}?t=555s`)
    await mutate(accountScope, { kind: 'unsave', id: 'acct-5' })
    expect(f.remove).toHaveBeenCalledWith('acct-5', undefined, 'one')
    expect(f.data.get(accountScope)?.replayDeltas).toEqual({})
  })
})

describe('the delta at the message boundary', () => {
  const reference = { id: 'x', channel: 'zackrawrr', title: 'Chat spike', vodId: VOD, streamId: '123456', offsetSeconds: 600, availability: 'available' }
  it('a reference may carry a usable delta only beside a VOD id', () => {
    expect(validMomentReference({ ...reference, vodOriginDeltaSeconds: 95 })).toBe(true)
    expect(validMomentReference({ ...reference, vodOriginDeltaSeconds: -95 })).toBe(true)
    expect(validMomentReference({ ...reference, vodId: null, vodOriginDeltaSeconds: 95 })).toBe(false)
    for (const bad of [0, 1.5, Number.NaN, 6 * 3600 + 1, '95', null]) expect(validMomentReference({ ...reference, vodOriginDeltaSeconds: bad })).toBe(false)
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command: { kind: 'save', reference: { ...reference, vodOriginDeltaSeconds: 95 } } })).not.toBeNull()
  })

  it('SAVE_BOOKMARK keeps a usable delta at the top level and refuses a bad one', () => {
    const bookmark = { login: 'zackrawrr', vodId: VOD, offsetSeconds: 10, source: 'extension' }
    expect(parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark, vodOriginDeltaSeconds: 95, restoreOf: 'acct-1' }))
      .toMatchObject({ vodOriginDeltaSeconds: 95, restoreOf: 'acct-1' })
    expect(parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark })).not.toHaveProperty('vodOriginDeltaSeconds')
    // Zero is the identity mapping: accepted, not kept.
    expect(parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark, vodOriginDeltaSeconds: 0 })).not.toHaveProperty('vodOriginDeltaSeconds')
    for (const bad of [1.5, '95', 99999, Number.POSITIVE_INFINITY]) expect(parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark, vodOriginDeltaSeconds: bad })).toBeNull()
    expect(parseBackgroundRequest({ type: 'SAVE_BOOKMARK', bookmark: { ...bookmark, vodId: undefined, streamId: '123456' }, vodOriginDeltaSeconds: 95 })).toBeNull()
  })
})
