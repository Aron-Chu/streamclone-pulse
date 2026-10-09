import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, momentIdentity, prunePersonalData, recordWatched, type PersonalData } from '../src/background/myMomentsStore.ts'
import type { LibraryMoment } from '../src/ui/library/model.ts'

/**
 * A moment is one channel, stream (or VOD) and whole second everywhere:
 * bookmarks, the account's history keys and this device's history. A jump
 * recorded at 125.6 s and a bookmark at 125 s are the same row.
 */
const f = vi.hoisted(() => ({ pages: vi.fn(), data: new Map<string, PersonalData>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { run: async () => ({ state: 'linked', accountId: 'one' }) } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn(),
  accountHistoryRequest: async () => ({ status: 404, body: { error: 'not_found' } }) }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const { prunePersonalData: prune } = await original<typeof import('../src/background/myMomentsStore.ts')>()
  const value = prune(f.data.get(scope) ?? emptyPersonalData(), Date.now())
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))
const SCOPE = 'https://api.streampulse.stream|account:one'
const NOW = Date.now()
const watched = (offsetSeconds: number, jumpedAt: number, id = `xqc:123456:${offsetSeconds}`): LibraryMoment => ({ id, channel: 'xqc', title: 'Comeback', vodId: '1234567890', streamId: '123456',
  offsetSeconds, availability: 'available', note: '', jumpedAt, historyExpiresAt: jumpedAt + 86_400_000 })
beforeEach(() => { f.data.clear(); f.pages.mockReset(); vi.stubGlobal('chrome', {}) })
afterEach(() => vi.unstubAllGlobals())

describe('moment identity at a whole second', () => {
  it('floors the offset, like bookmarks and sync keys', () => {
    expect(momentIdentity({ channel: 'xqc', vodId: null, streamId: '123456', offsetSeconds: 125.6 })).toBe('xqc:123456:125')
    expect(momentIdentity({ channel: 'xqc', vodId: null, streamId: '123456', offsetSeconds: 125 })).toBe('xqc:123456:125')
    expect(momentIdentity({ channel: 'xqc', vodId: '1234567890', offsetSeconds: null })).toBe('xqc:1234567890:null')
  })

  it('a new jump at 125.6 s replaces the one at 125 s instead of adding a second row', () => {
    let data: PersonalData = { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 } }
    const reference = (offsetSeconds: number) => ({ ...watched(offsetSeconds, 0), id: momentIdentity({ channel: 'xqc', vodId: '1234567890', streamId: '123456', offsetSeconds }) })
    data = recordWatched(data, reference(125), 0, NOW - 1000)
    data = recordWatched(data, reference(125.6), 0, NOW)
    expect(data.history.map(m => [m.id, m.jumpedAt])).toEqual([['xqc:123456:125', NOW]])
  })

  it('re-keys history stored with a fractional second, merging into the newest jump and keeping its note', () => {
    const stored: PersonalData = { ...emptyPersonalData(),
      history: [watched(125, NOW - 5000), watched(125.6, NOW - 1000, 'xqc:123456:125.6'), watched(300.2, NOW - 3000, 'xqc:123456:300.2')],
      notes: { 'xqc:123456:125.6': 'the clutch', 'xqc:123456:300.2': 'later' } }
    const data = prunePersonalData(stored, NOW)
    expect(data.history.map(m => [m.id, m.jumpedAt])).toEqual([['xqc:123456:300', NOW - 3000], ['xqc:123456:125', NOW - 1000]])
    expect(data.notes).toEqual({ 'xqc:123456:125': 'the clutch', 'xqc:123456:300': 'later' })
    // Already whole-second records are returned unchanged.
    const clean = { ...emptyPersonalData(), history: [watched(125, NOW - 5000)] }
    expect(prunePersonalData(clean, NOW).history).toEqual(clean.history)
  })

  it('shows a jump at 125.6 s and a bookmark at 125 s as one moment', async () => {
    f.data.set(SCOPE, { ...emptyPersonalData(), history: [watched(125.6, NOW - 1000, 'xqc:123456:125.6')] })
    f.pages.mockResolvedValue({ items: [{ id: 'bk', login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 125, label: 'Saved', notes: '', createdAt: new Date(NOW - 9000).toISOString() }] })
    const { snapshot } = await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {}) as { snapshot: { moments: LibraryMoment[] } }
    expect(snapshot.moments).toHaveLength(1)
    expect(snapshot.moments[0]).toMatchObject({ id: 'bk', jumpedAt: NOW - 1000 })
  })
})
