import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, importHistory, importSaves, momentIdentity, type PersonalData } from '../src/background/myMomentsStore.ts'
import { BACKUP_MAX_HISTORY, BACKUP_MAX_SAVES, parseMomentsBackup, validBackupMoment, type BackupMoment } from '../src/shared/myMomentsBackup.ts'
import { parseMyMoments } from '../src/shared/myMoments.ts'

/**
 * H4 Backup: Import reads the file Export makes and only adds. It never
 * deletes or overwrites what this browser keeps, and checks every row twice
 * (the page, then the worker).
 */
const f = vi.hoisted(() => ({ accountId: null as string | null, pages: vi.fn(), data: new Map<string, PersonalData>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { isInstallationIdentity: async () => false, run: async () => f.accountId ? { state: 'linked', accountId: f.accountId } : { state: 'signed_out' } } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn() }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))
const root = 'https://api.streampulse.stream'
const localScope = `${root}|local`
beforeEach(() => { f.accountId = null; f.data.clear(); f.pages.mockReset(); vi.stubGlobal('chrome', {}) })
afterEach(() => vi.unstubAllGlobals())

const now = Date.now()
const DAY = 86_400_000
const save = (offsetSeconds: number, extra: Partial<BackupMoment> = {}): BackupMoment =>
  ({ channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds, note: '', at: now - DAY, ...extra })
const file = (moments: unknown[], extra: object = {}) => JSON.stringify({ version: 1, exportedAt: new Date(now).toISOString(), moments, ...extra })

describe('reading an export file', () => {
  it('rejects anything that is not a version 1 My Moments export', () => {
    for (const raw of ['', 'not json', 'null', '[]', '"text"', JSON.stringify({ version: 2, moments: [] }), JSON.stringify({ version: 1 }), JSON.stringify({ version: 1, moments: {} })])
      expect(parseMomentsBackup(raw, now)).toBeNull()
  })
  it('reads saves and watched moments, and leaves out rows that do not check out', () => {
    const backup = parseMomentsBackup(file([
      { id: 'x', channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds: 754.9, note: 'keep', availability: 'available', savedAt: now - DAY, jumpedAt: now - 2 * DAY, extra: 'ignored' },
      { channel: 'lunaroom', title: '', streamId: '321274489178', vodId: null, offsetSeconds: 30, jumpedAt: now - DAY },
      { channel: 'Bad Login', vodId: '1234567890', offsetSeconds: 1, savedAt: now },
      { channel: 'xqc', vodId: 'abc', offsetSeconds: 1, savedAt: now },
      { channel: 'xqc', vodId: '1234567890', offsetSeconds: -1, savedAt: now },
      { channel: 'xqc', vodId: '1234567890', offsetSeconds: 1, savedAt: now + 7 * DAY },
      { channel: 'xqc', vodId: '1234567890', offsetSeconds: 1, savedAt: Date.UTC(2019, 0, 1) },
      null, 'row',
    ], { deviceBookmarks: [{ id: 'local:a', login: 'pixelharbor', vodId: '1234567899', offsetSeconds: 60, label: 'From device', notes: 'n', createdAt: new Date(now - DAY).toISOString() }] }), now)!
    expect(backup.saves).toEqual([
      { channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds: 754, note: 'keep', at: now - DAY },
      { channel: 'pixelharbor', title: 'From device', vodId: '1234567899', offsetSeconds: 60, note: 'n', at: now - DAY },
    ])
    // A watched moment carries no note; one without a title gets the fallback.
    expect(backup.history).toEqual([
      { channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds: 754, note: '', at: now - 2 * DAY },
      { channel: 'lunaroom', title: 'Saved moment', vodId: null, streamId: '321274489178', offsetSeconds: 30, note: '', at: now - DAY },
    ])
  })
  it('caps a file at what one import may add', () => {
    const rows = Array.from({ length: BACKUP_MAX_SAVES + 10 }, (_, i) => ({ channel: 'xqc', title: 't', vodId: '1234567890', offsetSeconds: i, savedAt: now - DAY }))
    const backup = parseMomentsBackup(file(rows), now)!
    expect(backup.saves).toHaveLength(BACKUP_MAX_SAVES)
    expect(backup.history.length).toBeLessThanOrEqual(BACKUP_MAX_HISTORY)
  })
  it('lets the worker accept only moments the reader could have made', () => {
    expect(validBackupMoment(save(1), now)).toBe(true)
    expect(validBackupMoment({ ...save(1), extra: 1 }, now)).toBe(false)
    expect(validBackupMoment({ ...save(1), offsetSeconds: 1.5 }, now)).toBe(false)
    expect(validBackupMoment({ ...save(1), title: 'x'.repeat(161) }, now)).toBe(false)
    expect(validBackupMoment({ ...save(1), vodId: null }, now)).toBe(false)
    const command = (saves: unknown[], history: unknown[] = []) => parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command: { kind: 'import-backup', saves, history } })
    expect(command([save(1)], [save(2)])).not.toBeNull()
    expect(command([{ ...save(1), note: 5 }])).toBeNull()
    expect(command(Array.from({ length: BACKUP_MAX_SAVES + 1 }, (_, i) => save(i)))).toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command: { kind: 'import-backup', saves: [] } })).toBeNull()
  })
})

describe('adding a backup to this browser', () => {
  it('adds new saves oldest first with their notes, and skips ones already kept', () => {
    const kept = importSaves(emptyPersonalData(), [save(10, { title: 'Kept', note: 'mine' })])
    const next = importSaves(kept, [save(10.4, { title: 'Again', note: 'theirs', at: now }), save(20, { title: 'Saved moment', at: now - 2 * DAY, note: 'new note' }), save(30, { at: now - 3 * DAY })])
    expect(next.bookmarks.map(b => [b.offsetSeconds, b.label, b.createdAt])).toEqual([
      [10, 'Kept', new Date(now - DAY).toISOString()],
      [30, 'Clutch', new Date(now - 3 * DAY).toISOString()],
      [20, '', new Date(now - 2 * DAY).toISOString()],
    ])
    // Nothing kept changes: the first save keeps its own note.
    expect(Object.values(next.notes).sort()).toEqual(['mine', 'new note'])
    expect(importSaves(next, [save(10), save(20), save(30)])).toBe(next)
    // `have` (an account's own saves) is skipped too.
    expect(importSaves(emptyPersonalData(), [save(40)], new Set([momentIdentity(save(40))])).bookmarks).toEqual([])
  })
  it('adds watched moments within retention while History is on, and keeps visits it lists', () => {
    const off = emptyPersonalData()
    expect(importHistory(off, [save(1)], now)).toBe(off)
    const on: PersonalData = { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 } }
    const once = importHistory(on, [save(1, { at: now - DAY }), save(2, { at: now - 31 * DAY }), save(3, { at: now + DAY })], now)
    expect(once.history.map(m => [m.offsetSeconds, m.jumpedAt, m.historyExpiresAt, m.availability])).toEqual([[1, now - DAY, now + 29 * DAY, 'available']])
    expect(importHistory(once, [save(1, { at: now - 2000 })], now)).toBe(once)
    // Watched more than 7 days ago: the replay may be gone.
    expect(importHistory(on, [save(4, { at: now - 9 * DAY })], now).history[0].availability).toBe('unavailable')
  })
  it('imports through the worker, and a second import of the same file adds nothing', async () => {
    f.data.set(localScope, { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 90 } })
    const mutate = (saves: BackupMoment[], history: BackupMoment[]) => handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command: { kind: 'import-backup', saves, history } }, {}) as
      Promise<{ snapshot?: { moments: { savedAt?: number; jumpedAt?: number; note: string }[] }; error?: string }>
    const first = await mutate([save(10, { note: 'kept note' })], [save(20, { at: now - DAY })])
    expect(first.error).toBeUndefined()
    expect(first.snapshot!.moments.filter(m => m.savedAt !== undefined).map(m => m.note)).toEqual(['kept note'])
    expect(first.snapshot!.moments.filter(m => m.jumpedAt !== undefined)).toHaveLength(1)
    const before = structuredClone(f.data.get(localScope))
    await mutate([save(10, { note: 'other note' })], [save(20, { at: now - 2 * DAY })])
    expect(f.data.get(localScope)).toEqual(before)
  })
})

describe('one History visit at a time (✕ and Undo)', () => {
  const reference = { id: 'xqc:1234567890:20', channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds: 20, availability: 'available' as const }
  const mutate = (command: object) => handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command }, {}) as Promise<{ snapshot?: { moments: { id: string; jumpedAt?: number }[] }; error?: string }>
  it('validates the commands', () => {
    const parse = (command: object) => parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: localScope, command })
    expect(parse({ kind: 'remove-visit', reference })).not.toBeNull()
    expect(parse({ kind: 'remove-visit', reference, jumpedAt: now })).toBeNull()
    expect(parse({ kind: 'restore-visit', reference, jumpedAt: now - DAY })).not.toBeNull()
    expect(parse({ kind: 'restore-visit', reference, jumpedAt: now + DAY })).toBeNull()
    expect(parse({ kind: 'restore-visit', reference, jumpedAt: now - 92 * DAY })).toBeNull()
    expect(parse({ kind: 'restore-visit', reference })).toBeNull()
  })
  it('removes one visit and puts it back at its time', async () => {
    const on: PersonalData = { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 } }
    f.data.set(localScope, importHistory(on, [save(20, { at: now - DAY }), save(30, { at: now - 2 * DAY })], now))
    const removed = await mutate({ kind: 'remove-visit', reference })
    expect(removed.snapshot!.moments.map(m => m.id)).toEqual(['xqc:1234567890:30'])
    const back = await mutate({ kind: 'restore-visit', reference, jumpedAt: now - DAY })
    expect(back.snapshot!.moments.find(m => m.id === reference.id)?.jumpedAt).toBe(now - DAY)
    expect(f.data.get(localScope)!.history.map(m => m.id)).toEqual(['xqc:1234567890:30', 'xqc:1234567890:20'])
  })
  it('refuses while History syncs to an account', async () => {
    f.data.set(localScope, { ...emptyPersonalData(), accountSync: { enabled: true, pending: [] } } as unknown as PersonalData)
    await expect(mutate({ kind: 'remove-visit', reference })).rejects.toThrow('Synced History can only be cleared as a whole.')
  })
})
