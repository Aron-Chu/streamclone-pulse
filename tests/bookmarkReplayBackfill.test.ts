import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findStreamReplays, type ReplayLookups } from '../src/background/bookmarkReplay.ts'
import { bindReplayLookups, handleDeviceBookmarks, handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import type { PastVodRow, PulseBookmark } from '../src/shared/messages.ts'
import { replayUrl, type LibraryMoment } from '../src/ui/library/model.ts'

/**
 * PAGE-1 follow-up: live saves made before the archive was known stay
 * stream-only ("Replay not linked"). When My Moments opens, the worker looks
 * the stream's archive up (stream history by exact stream id, then the
 * channel's open tab) and stores it: device saves in place, account saves as a
 * kept link. A miss changes nothing, and no row is ever added.
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
const localScope = `${root}|local`
const accountScope = `${root}|account:one`
const lookups = { pastVods: vi.fn<ReplayLookups['pastVods']>(), liveArchive: vi.fn<ReplayLookups['liveArchive']>() }
const row = (streamId: string, videoId?: string): PastVodRow => ({ streamId, ...(videoId ? { videoId } : {}), title: 'Stream', analyticsStatus: 'synced' })
beforeEach(() => {
  f.accountId = null; f.data.clear(); f.pages.mockReset(); f.save.mockReset(); f.remove.mockReset()
  lookups.pastVods.mockReset().mockResolvedValue([])
  lookups.liveArchive.mockReset().mockResolvedValue(null)
  bindReplayLookups(lookups)
  vi.stubGlobal('chrome', {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

type Snapshot = { moments: LibraryMoment[]; deviceBookmarks: PulseBookmark[] }
const load = async () => ((await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})) as { snapshot: Snapshot }).snapshot
const saveLive = (offsetSeconds: number, vodId?: string) => handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark: {
  login: 'zackrawrr', streamId: '123456', ...(vodId ? { vodId } : {}), offsetSeconds, label: 'Chat spike', source: 'extension' } }, {}) as Promise<{ item: PulseBookmark }>
const deviceRows = (scope = localScope) => f.data.get(scope)?.bookmarks ?? []
const saved = (snapshot: Snapshot) => snapshot.moments.filter(m => m.savedAt !== undefined)

describe('stream-only bookmarks get their replay when My Moments opens', () => {
  it('links an old stream-only device save to its stream\'s VOD, in place', async () => {
    const { item } = await saveLive(7375)
    expect(item.vodId).toBeUndefined()
    // The channel's newest VOD belongs to another stream and must not be used.
    lookups.pastVods.mockResolvedValue([row('999999', '2904000000'), row('123456', '2903344433')])
    const [moment] = saved(await load())
    expect(moment).toMatchObject({ id: item.id, vodId: '2903344433', streamId: '123456', availability: 'available' })
    expect(replayUrl(moment!)).toBe('https://www.twitch.tv/videos/2903344433?t=7375s')
    expect(deviceRows()).toEqual([{ ...item, vodId: '2903344433' }])
    expect(lookups.pastVods).toHaveBeenCalledWith('zackrawrr')
    expect(lookups.liveArchive).not.toHaveBeenCalled()
  })

  it('links a still-live stream through the channel\'s open tab when history does not list it yet', async () => {
    const { item } = await saveLive(6763)
    lookups.pastVods.mockResolvedValue([row('123456')])
    lookups.liveArchive.mockResolvedValue({ vodId: '2903669245', streamId: '123456', source: 'stream.archiveVideo', gqlErrors: [] })
    const [moment] = saved(await load())
    expect(lookups.liveArchive).toHaveBeenCalledWith('zackrawrr', '123456')
    expect(moment).toMatchObject({ id: item.id, vodId: '2903669245', availability: 'available' })
  })

  it('leaves the row unchanged when no VOD of that stream is found', async () => {
    const { item } = await saveLive(7375)
    const before = structuredClone(deviceRows())
    // History lists the stream without an archive, and only another stream's VOD.
    lookups.pastVods.mockResolvedValue([row('999999', '2904000000'), row('123456')])
    // An open tab answering for another live stream is not this stream's archive.
    lookups.liveArchive.mockResolvedValue({ vodId: '2904000000', streamId: '999999', source: 'stream.archiveVideo', gqlErrors: [] })
    const [moment] = saved(await load())
    expect(moment).toMatchObject({ id: item.id, vodId: null, availability: 'unresolved' })
    expect(replayUrl(moment!)).toBeNull()
    expect(deviceRows()).toEqual(before)
  })

  it('still opens, unchanged, when the lookups fail', async () => {
    await saveLive(7375)
    const before = structuredClone(deviceRows())
    lookups.pastVods.mockRejectedValue(new Error('stream_history 503'))
    lookups.liveArchive.mockRejectedValue(new Error('no_twitch_tab'))
    expect(saved(await load())[0]).toMatchObject({ vodId: null, availability: 'unresolved' })
    expect(deviceRows()).toEqual(before)
  })

  it('never adds a row: repeated opens and a later save of the same moment keep one', async () => {
    const { item } = await saveLive(7375)
    lookups.pastVods.mockResolvedValue([row('123456', '2903344433')])
    await load()
    await load()
    expect(deviceRows()).toHaveLength(1)
    // Linked rows are not looked up again.
    expect(lookups.pastVods).toHaveBeenCalledTimes(1)
    // The same second saved again (now with the VOD id) is the same bookmark.
    expect((await saveLive(7375, '2903344433')).item.id).toBe(item.id)
    expect(deviceRows()).toEqual([{ ...item, vodId: '2903344433' }])
    // A VOD page's preflight, which asks by VOD id, now finds it instead of saving a second row.
    const page = await handleDeviceBookmarks({ type: 'LIST_BOOKMARKS', login: 'zackrawrr', vodId: '2903344433', limit: 100 }, {}) as { items: PulseBookmark[] }
    expect(page.items.map(b => b.id)).toEqual([item.id])
    expect(saved(await load())).toHaveLength(1)
  })

  it('keeps a link for an account save, posts nothing, and drops the link with the save', async () => {
    f.accountId = 'one'
    const hosted: PulseBookmark = { id: 'acct-1', login: 'zackrawrr', streamId: '123456', offsetSeconds: 7375, label: 'Chat spike', notes: '',
      source: 'extension', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    f.pages.mockResolvedValue({ items: [hosted] })
    lookups.pastVods.mockResolvedValue([row('123456', '2903344433')])
    const snapshot = await load()
    expect(saved(snapshot)).toHaveLength(1)
    expect(saved(snapshot)[0]).toMatchObject({ id: 'acct-1', vodId: '2903344433', availability: 'available' })
    expect(f.data.get(accountScope)?.replayLinks).toEqual({ 'acct-1': '2903344433' })
    expect(f.save).not.toHaveBeenCalled()
    // The next open reads the kept link without another lookup.
    expect(saved(await load())[0]).toMatchObject({ vodId: '2903344433' })
    expect(lookups.pastVods).toHaveBeenCalledTimes(1)
    f.pages.mockResolvedValueOnce({ items: [hosted] }).mockResolvedValue({ items: [] })
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'unsave', id: 'acct-1' } }, {})
    expect(f.remove).toHaveBeenCalledWith('acct-1', undefined, 'one')
    expect(f.data.get(accountScope)?.replayLinks).toEqual({})
  })

  it('links saves made on this device before signing in, where they are listed', async () => {
    const { item } = await saveLive(7375)
    f.accountId = 'one'
    f.pages.mockResolvedValue({ items: [] })
    lookups.pastVods.mockResolvedValue([row('123456', '2903344433')])
    const snapshot = await load()
    expect(snapshot.deviceBookmarks).toEqual([{ ...item, vodId: '2903344433' }])
    expect(f.data.get(accountScope)?.replayLinks).toBeUndefined()
  })

  it('does not hold My Moments for a slow lookup, and keeps its answer for the next open', async () => {
    vi.useFakeTimers()
    await saveLive(7375)
    let answer!: (rows: PastVodRow[]) => void
    lookups.pastVods.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const opening = load()
    await vi.advanceTimersByTimeAsync(4000)
    expect(saved(await opening)[0]).toMatchObject({ vodId: null })
    answer([row('123456', '2903344433')])
    await vi.advanceTimersByTimeAsync(0)
    expect(deviceRows()[0]?.vodId).toBe('2903344433')
  })
})

describe('findStreamReplays', () => {
  it('reads history once per channel and matches each stream exactly', async () => {
    lookups.pastVods.mockImplementation(async login => login === 'a' ? [row('1', '1000001'), row('2', '1000002')] : [row('9', '9000009')])
    const found = await findStreamReplays([{ login: 'a', streamId: '2' }, { login: 'a', streamId: '1' }, { login: 'a', streamId: '3' }, { login: 'b', streamId: '8' }], lookups)
    expect(Object.fromEntries(found)).toEqual({ 'a:2': '1000002', 'a:1': '1000001' })
    expect(lookups.pastVods).toHaveBeenCalledTimes(2)
    // Without an open tab the first miss ends the tab lookups for that channel.
    expect(lookups.liveArchive.mock.calls).toEqual([['a', '3'], ['b', '8']])
  })
})
