import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySyncReply, historySyncView, nextBatch, parseSyncReply, syncKey, type AccountHistorySync } from '../src/background/historySync.ts'
import { handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import type { LibraryMoment } from '../src/ui/library/model.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-03T12:00:00Z')
const f = vi.hoisted(() => ({ accountId: 'one' as string | null, data: new Map<string, PersonalData>(), history: vi.fn() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ supporterAccount: { run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: async () => ({ items: [] }), createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn(), accountHistoryRequest: f.history }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))

const SCOPE = 'https://api.streampulse.stream|account:one'
const moment = (offsetSeconds: number, jumpedAt: number, extra: Partial<LibraryMoment> = {}): LibraryMoment => ({
  id: `xqc:123456:${offsetSeconds}`, channel: 'xqc', title: `at ${offsetSeconds}`, vodId: '1234567890', streamId: '123456', offsetSeconds,
  availability: 'available', note: '', jumpedAt, historyExpiresAt: jumpedAt + 30 * DAY, ...extra })
const wire = (m: LibraryMoment, days = 30) => ({ key: syncKey(m), login: m.channel, streamId: m.streamId, vodId: m.vodId ?? undefined,
  offsetSeconds: Math.floor(m.offsetSeconds!), title: m.title, jumpedAt: new Date(m.jumpedAt!).toISOString(), expiresAt: new Date(m.jumpedAt! + days * DAY).toISOString() })
const on = (extra: Partial<AccountHistorySync> = {}): AccountHistorySync => ({ enabled: true, available: true, revision: 1, pending: [], ...extra })
const reply = (entries: object[], extra: object = {}) => parseSyncReply({ settings: { syncEnabled: true, retentionDays: 30 }, entries, cursor: 'h1.9', reset: false, ...extra })!

describe('sync replies', () => {
  it('parses a reply, skipping rows that do not match their key or are malformed', () => {
    const good = wire(moment(10, NOW - DAY))
    const parsed = parseSyncReply({ settings: { syncEnabled: true, retentionDays: 7 }, cursor: 'h1.1', reset: true, clearedAt: '2026-10-01T00:00:00Z',
      entries: [good, { ...good, key: 'xqc:999:10' }, { ...good, login: 'Bad Login' }, { ...good, offsetSeconds: 1.5 }, { ...good, expiresAt: good.jumpedAt }] })
    expect(parsed?.entries.map(e => e.id)).toEqual(['xqc:123456:10'])
    expect(parsed?.entries[0]).toMatchObject({ channel: 'xqc', vodId: '1234567890', availability: 'available', note: '' })
    expect(parsed?.clearedAt).toBe(Date.parse('2026-10-01T00:00:00Z'))
    expect(parseSyncReply({ settings: { syncEnabled: true, retentionDays: 14 }, entries: [], cursor: '', reset: false })).toBeNull()
    expect(parseSyncReply({ settings: { syncEnabled: true, retentionDays: 7 }, entries: [], cursor: 'x', reset: false, clearedAt: 'soon' })).toBeNull()
  })

  it('merges by whole second, keeping the latest jump and this device’s note', () => {
    const mine = moment(10.6, NOW - 2 * DAY, { id: 'xqc:123456:10.6', note: 'mine' })
    const older = moment(20, NOW - DAY)
    const data: PersonalData = { ...emptyPersonalData(), epoch: 5, history: [mine, older], accountSync: on() }
    const theirs = moment(10, NOW - 60_000, { title: 'watched elsewhere' })
    const next = applySyncReply(data, { epoch: 5, revision: 1 }, new Map(), reply([wire(theirs), wire(moment(20, NOW - 3 * DAY))]), NOW)
    const merged = next.history.find(m => m.id === 'xqc:123456:10.6')!
    expect(merged).toMatchObject({ note: 'mine', title: 'watched elsewhere', jumpedAt: NOW - 60_000 })
    expect(next.history.find(m => m.id === older.id)?.jumpedAt).toBe(NOW - DAY)
    expect(next.history).toHaveLength(2)
    expect(next.accountSync).toMatchObject({ cursor: 'h1.9', syncedAt: NOW, failed: false })
  })

  it('applies the account retention and last clear to everything held here', () => {
    const data: PersonalData = { ...emptyPersonalData(), epoch: 5, history: [moment(1, NOW - 10 * DAY), moment(2, NOW - 3 * DAY), moment(3, NOW - DAY)],
      accountSync: on({ pending: ['xqc:123456:2', 'xqc:123456:3'] }) }
    const next = applySyncReply(data, { epoch: 5, revision: 1 }, new Map(), reply([], {
      settings: { syncEnabled: true, retentionDays: 7 }, clearedAt: new Date(NOW - 2 * DAY).toISOString() }), NOW)
    expect(next.history.map(m => m.offsetSeconds)).toEqual([3])
    expect(next.history[0].historyExpiresAt).toBe(NOW - DAY + 7 * DAY)
    expect(next.preferences.retentionDays).toBe(7)
    expect(next.accountSync?.pending).toEqual(['xqc:123456:3'])
    // Captures already under way when the clear happened elsewhere are void.
    expect(next.epoch).toBeGreaterThan(5)
  })

  it('after a full reply, queues what the account lacks or holds older; sent jumps leave the queue unless jumped again', () => {
    const a = moment(1, NOW - 3000), b = moment(2, NOW - 2000), c = moment(3, NOW - 1000)
    const data: PersonalData = { ...emptyPersonalData(), history: [a, b, c], accountSync: on({ pending: ['xqc:123456:1', 'xqc:123456:3'] }) }
    const sent = new Map([['xqc:123456:1', a.jumpedAt!], ['xqc:123456:3', c.jumpedAt! - 500]])
    const next = applySyncReply(data, { epoch: 0, revision: 1 }, sent, reply([wire(a), wire({ ...b, jumpedAt: b.jumpedAt! - 1 })], { reset: true }), NOW)
    expect(next.accountSync?.pending.sort()).toEqual(['xqc:123456:2', 'xqc:123456:3'])
  })

  it('ignores a reply when sync was switched, history cleared or retention changed since it was sent', () => {
    const data: PersonalData = { ...emptyPersonalData(), epoch: 6, history: [], accountSync: on({ revision: 2 }) }
    const r = reply([wire(moment(1, NOW - 1000))])
    expect(applySyncReply(data, { epoch: 6, revision: 1 }, new Map(), r, NOW)).toBe(data)
    expect(applySyncReply(data, { epoch: 5, revision: 2 }, new Map(), r, NOW)).toBe(data)
  })

  it('sends the oldest queued jumps within the server’s batch and size limits, at whole seconds', () => {
    const history = Array.from({ length: 80 }, (_, i) => moment(i + 0.5, NOW - (80 - i) * 1000, { id: `xqc:123456:${i + 0.5}` }))
    const data: PersonalData = { ...emptyPersonalData(), history, accountSync: on({ pending: history.map(syncKey) }) }
    const batch = nextBatch(data)
    expect(batch).toHaveLength(50)
    expect(batch[0].input).toEqual({ login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 0, title: 'at 0.5', jumpedAt: new Date(NOW - 80_000).toISOString() })
    const wide = history.map(m => ({ ...m, title: '漢'.repeat(160) }))
    const heavy = nextBatch({ ...data, history: wide })
    expect(heavy.length).toBeLessThan(50)
    expect(new TextEncoder().encode(JSON.stringify({ entries: heavy.map(b => b.input), cursor: 'h1.1234567890123456' })).length).toBeLessThan(16 * 1024)
  })

  it('describes the switch for the page', () => {
    const data = { ...emptyPersonalData(), accountSync: on({ syncedAt: NOW, pending: ['a'] }) }
    expect(historySyncView(false, data)).toEqual({ state: 'signed_out' })
    expect(historySyncView(true, emptyPersonalData())).toEqual({ state: 'off' })
    expect(historySyncView(true, { ...data, accountSync: on({ enabled: false, available: false }) })).toEqual({ state: 'unavailable' })
    expect(historySyncView(true, data)).toEqual({ state: 'on', syncedAt: NOW, pending: 1, failed: false })
  })
})

/** A small stand-in for /v1/account/history/*: one account, keyed rows, newest jump wins. */
function fakeServer() {
  const s = { settings: { syncEnabled: false, retentionDays: 30 }, rows: new Map<string, Record<string, unknown>>(), clearedAt: undefined as string | undefined,
    available: true, off: false, calls: [] as string[] }
  f.history.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    s.calls.push(path.replace('/v1/account/history/', ''))
    if (!s.available) return { status: 404, body: { error: 'not_found' } }
    if (path.endsWith('/settings')) { Object.assign(s.settings, body); if (body.syncEnabled === false) s.rows.clear(); return { status: 200, body: { ...s.settings } } }
    if (path.endsWith('/clear')) { s.rows.clear(); s.clearedAt = new Date().toISOString(); return { status: 204, body: null } }
    if (!s.settings.syncEnabled) return { status: 409, body: { error: 'history_sync_off', settings: s.settings } }
    for (const e of body.entries as Array<Record<string, string | number>>) {
      const key = `${e.login}:${e.streamId || e.vodId}:${e.offsetSeconds}`
      const old = s.rows.get(key)
      if (!old || String(old.jumpedAt) < String(e.jumpedAt)) s.rows.set(key, { ...e, key,
        expiresAt: new Date(Date.parse(String(e.jumpedAt)) + s.settings.retentionDays * DAY).toISOString() })
    }
    return { status: 200, body: { settings: s.settings, entries: [...s.rows.values()], cursor: `h1.${s.calls.length}`, reset: !body.cursor, ...(s.clearedAt ? { clearedAt: s.clearedAt } : {}) } }
  })
  return s
}
type Snapshot = { historySync: { state: string; pending?: number; syncedAt?: number | null }; moments: LibraryMoment[]; preferences: { captureHistory: boolean; retentionDays: number }; scope: string }
const load = async () => ((await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})) as { snapshot: Snapshot }).snapshot
const mutate = async (command: object) => ((await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: SCOPE, command } as never, {})) as { snapshot: Snapshot }).snapshot
const capture = (offsetSeconds: number, epoch: number) => handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'record', epoch, watchedSeconds: 10,
  reference: { id: 'x', channel: 'xqc', title: 'live', vodId: '1234567890', streamId: '123456', offsetSeconds, availability: 'available' } },
  { tab: { url: 'https://www.twitch.tv/videos/1234567890' } as chrome.tabs.Tab })

describe('My Moments with account history sync', () => {
  beforeEach(() => { f.accountId = 'one'; f.data.clear(); f.history.mockReset(); vi.stubGlobal('chrome', {}) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('stays on the device while signed out and never calls the account', async () => {
    f.accountId = null
    expect((await load()).historySync).toEqual({ state: 'signed_out' })
    expect(f.history).not.toHaveBeenCalled()
  })

  it('hides the switch when the server does not offer sync', async () => {
    fakeServer().available = false
    expect((await load()).historySync).toEqual({ state: 'unavailable' })
  })

  it('turns on with this browser’s retention, sends its history, and keeps recording into the queue', async () => {
    const server = fakeServer()
    f.data.set(SCOPE, { ...emptyPersonalData(), preferences: { captureHistory: false, retentionDays: 90 }, history: [moment(5, Date.now() - DAY)] })
    expect((await load()).historySync).toEqual({ state: 'off' })
    const after = await mutate({ kind: 'history-sync', enabled: true })
    expect(server.settings).toEqual({ syncEnabled: true, retentionDays: 90 })
    expect(after.preferences).toEqual({ captureHistory: true, retentionDays: 90 })
    expect(after.historySync).toMatchObject({ state: 'on', pending: 0 })
    expect([...server.rows.keys()]).toEqual(['xqc:123456:5'])

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const status = await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {}) as { epoch: number }
    await capture(77.4, status.epoch)
    expect(f.data.get(SCOPE)?.accountSync?.pending).toEqual(['xqc:123456:77'])
    await vi.runAllTimersAsync()
    expect(server.rows.has('xqc:123456:77')).toBe(true)
    expect(f.data.get(SCOPE)?.accountSync?.pending).toEqual([])
  })

  it('joins an account that already syncs, adopting its retention and pulling its history', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 7 }
    server.rows.set('xqc:123456:9', wire(moment(9, Date.now() - DAY), 7))
    const snapshot = await load()
    expect(snapshot.historySync.state).toBe('on')
    expect(snapshot.preferences.retentionDays).toBe(7)
    expect(snapshot.moments.map(m => m.id)).toEqual(['xqc:123456:9'])
  })

  it('a browser joining an account that syncs records its own jumps, learned at the first Pulse jump', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 30 }
    server.rows.set('xqc:123456:9', wire(moment(9, Date.now() - DAY), 30))
    // A fresh profile: nothing stored, My Moments never opened.
    const status = await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {}) as { enabled: boolean; epoch: number }
    expect(status.enabled).toBe(true)
    expect(f.data.get(SCOPE)?.preferences).toEqual({ captureHistory: true, retentionDays: 30 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await capture(42.5, status.epoch)
    await vi.runAllTimersAsync()
    expect(server.rows.has('xqc:123456:42')).toBe(true)
    expect(f.data.get(SCOPE)?.history.map(m => syncKey(m)).sort()).toEqual(['xqc:123456:42', 'xqc:123456:9'])
  })

  it('a reinstalled browser opening My Moments gets the account history back and records again', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 7 }
    server.rows.set('xqc:123456:9', wire(moment(9, Date.now() - DAY), 7))
    const snapshot = await load()
    expect(snapshot.preferences).toEqual({ captureHistory: true, retentionDays: 7 })
    expect(snapshot.historySync.state).toBe('on')
    const status = await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {}) as { enabled: boolean }
    expect(status.enabled).toBe(true)
  })

  it('keeps remembering off on a browser that turned it off while the account syncs', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 30 }
    await load()
    const off = await mutate({ kind: 'preferences', value: { captureHistory: false, retentionDays: 30 } })
    expect(off.preferences.captureHistory).toBe(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.now() + 10 * 60_000)
    expect((await load()).preferences.captureHistory).toBe(false)
    const status = await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {}) as { enabled: boolean }
    expect(status.enabled).toBe(false)
  })

  it('asks the account at a Pulse jump at most every five minutes while sync is off, and never while signed out', async () => {
    const server = fakeServer()
    for (let i = 0; i < 3; i++) await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {})
    expect(server.calls).toEqual(['settings'])
    f.accountId = null
    await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {})
    expect(server.calls).toEqual(['settings'])
  })

  it('stops asking at Pulse jumps once the server answers that it does not offer sync', async () => {
    const server = fakeServer()
    server.available = false
    vi.useFakeTimers({ toFake: ['Date'] })
    await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {})
    vi.setSystemTime(Date.now() + 60 * 60_000)
    await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, {})
    expect(server.calls).toEqual(['settings'])
  })

  it('clears the account first, and changes nothing here when that fails', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 30 }
    f.data.set(SCOPE, { ...emptyPersonalData(), history: [moment(5, Date.now() - DAY)], accountSync: on({ checkedAt: Date.now() }) })
    f.history.mockRejectedValueOnce(new Error('network'))
    await expect(mutate({ kind: 'clear-history' })).rejects.toThrow('Nothing was changed')
    expect(f.data.get(SCOPE)?.history).toHaveLength(1)
    const cleared = await mutate({ kind: 'clear-history' })
    expect(cleared.moments).toEqual([])
    expect(server.calls).toContain('clear')
  })

  it('keeps this device’s history when the account turns sync off, here or elsewhere', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 30 }
    f.data.set(SCOPE, { ...emptyPersonalData(), history: [moment(5, Date.now() - DAY)], accountSync: on({ cursor: 'h1.1', checkedAt: Date.now() }) })
    server.settings.syncEnabled = false
    const elsewhere = await load()
    expect(elsewhere.historySync).toEqual({ state: 'off' })
    expect(elsewhere.moments).toHaveLength(1)

    server.settings.syncEnabled = true
    await mutate({ kind: 'history-sync', enabled: true })
    const off = await mutate({ kind: 'history-sync', enabled: false })
    expect(server.settings.syncEnabled).toBe(false)
    expect(server.rows.size).toBe(0)
    expect(off.moments).toHaveLength(1)
    expect(off.historySync).toEqual({ state: 'off' })
  })

  it('changes the account’s retention before this device’s', async () => {
    const server = fakeServer()
    server.settings = { syncEnabled: true, retentionDays: 30 }
    f.data.set(SCOPE, { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 }, accountSync: on({ checkedAt: Date.now() }) })
    const next = await mutate({ kind: 'preferences', value: { captureHistory: true, retentionDays: 7 } })
    expect(server.settings.retentionDays).toBe(7)
    expect(next.preferences.retentionDays).toBe(7)
  })
})
