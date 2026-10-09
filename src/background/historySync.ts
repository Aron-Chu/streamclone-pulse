import { accountHistoryRequest } from './api.ts'
import { personalTransaction, type PersonalData } from './myMomentsStore.ts'
import { replayAvailability, type HistorySyncView, type LibraryMoment } from '../ui/library/model.ts'

/**
 * Watched history synced through the linked account
 * (`/v1/account/history/*`). The account's choice is the switch: when it is on,
 * every browser signed in to that account sends the jumps it records and
 * merges the others'. Only the account scope's record takes part; history kept
 * while signed out never leaves the device.
 */
export interface AccountHistorySync {
  enabled: boolean
  /** False once the server answered that it does not offer sync (404). */
  available: boolean
  /** Changes whenever this browser turns sync on or off, so a reply to an older run is ignored. */
  revision: number
  cursor?: string
  /** Moment keys recorded or held here that the account has not acknowledged. */
  pending: string[]
  /** The account's last explicit clear; jumps at or before it are dropped here too. */
  clearedAt?: number
  syncedAt?: number
  /** The last account settings read, which is how a browser learns sync was turned on elsewhere. */
  checkedAt?: number
  failed?: boolean
}
type Retention = 7 | 30 | 90
interface ServerSettings { syncEnabled: boolean; retentionDays: Retention }
interface SyncReply { settings: ServerSettings; entries: LibraryMoment[]; cursor: string; reset: boolean; clearedAt?: number }

const DAY = 86_400_000
const MAX_ENTRIES = 1000
// The server takes at most 50 entries and 16 KiB per push.
const BATCH_ENTRIES = 50
const BATCH_BYTES = 12_000
const MAX_ROUNDS = 25
const RECHECK_MS = 5 * 60_000

/** The server's key: the extension's moment identity at a whole second. */
export const syncKey = (m: Pick<LibraryMoment, 'channel' | 'streamId' | 'vodId' | 'offsetSeconds'>) =>
  `${m.channel}:${m.streamId || m.vodId}:${Math.floor(m.offsetSeconds ?? 0)}`
const syncable = (m: LibraryMoment) => m.jumpedAt !== undefined && m.offsetSeconds !== null && Number.isFinite(m.offsetSeconds)
  && m.offsetSeconds >= 0 && /^[a-z0-9_]{1,25}$/.test(m.channel) && !!(m.streamId || m.vodId)
export const syncableKeys = (history: readonly LibraryMoment[]) => [...new Set(history.filter(syncable).map(syncKey))]

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const numeric = (v: unknown) => v === undefined || (typeof v === 'string' && /^\d{1,20}$/.test(v))
const retention = (v: unknown): v is Retention => v === 7 || v === 30 || v === 90
function parseSettings(v: unknown): ServerSettings | null {
  return record(v) && typeof v.syncEnabled === 'boolean' && retention(v.retentionDays) ? { syncEnabled: v.syncEnabled, retentionDays: v.retentionDays } : null
}
function parseEntry(v: unknown): LibraryMoment | null {
  if (!record(v) || typeof v.key !== 'string' || typeof v.login !== 'string' || !/^[a-z0-9_]{1,25}$/.test(v.login)) return null
  if (!numeric(v.streamId) || !numeric(v.vodId) || (!v.streamId && !v.vodId)) return null
  if (!Number.isSafeInteger(v.offsetSeconds) || (v.offsetSeconds as number) < 0 || (v.offsetSeconds as number) > 172_800) return null
  if (typeof v.title !== 'string' || v.title.length > 400) return null
  const jumpedAt = typeof v.jumpedAt === 'string' ? Date.parse(v.jumpedAt) : NaN
  const expiresAt = typeof v.expiresAt === 'string' ? Date.parse(v.expiresAt) : NaN
  if (!Number.isFinite(jumpedAt) || !Number.isFinite(expiresAt) || expiresAt <= jumpedAt) return null
  const vodId = (v.vodId as string | undefined) ?? null
  const streamId = v.streamId as string | undefined
  const moment: LibraryMoment = { id: v.key, channel: v.login, title: v.title, vodId, ...(streamId ? { streamId } : {}), offsetSeconds: v.offsetSeconds as number,
    availability: replayAvailability({ vodId, offsetSeconds: v.offsetSeconds as number }), note: '', jumpedAt, historyExpiresAt: expiresAt }
  return syncKey(moment) === v.key ? moment : null
}
export function parseSyncReply(v: unknown): SyncReply | null {
  if (!record(v) || !Array.isArray(v.entries) || v.entries.length > MAX_ENTRIES || typeof v.cursor !== 'string' || v.cursor.length > 64 || typeof v.reset !== 'boolean') return null
  const settings = parseSettings(v.settings)
  const clearedAt = v.clearedAt === undefined ? undefined : typeof v.clearedAt === 'string' ? Date.parse(v.clearedAt) : NaN
  if (!settings || (clearedAt !== undefined && !Number.isFinite(clearedAt))) return null
  // One malformed row is skipped, as the server skips ours.
  const entries = v.entries.map(parseEntry).filter((m): m is LibraryMoment => m !== null)
  return { settings, entries, cursor: v.cursor, reset: v.reset, ...(clearedAt !== undefined ? { clearedAt } : {}) }
}

/** The next push: the oldest unacknowledged jumps that fit one request. */
export function nextBatch(data: PersonalData): Array<{ key: string; jumpedAt: number; input: Record<string, unknown> }> {
  const byKey = new Map(data.history.filter(syncable).map(m => [syncKey(m), m]))
  const batch: Array<{ key: string; jumpedAt: number; input: Record<string, unknown> }> = []
  let bytes = 40
  for (const key of data.accountSync?.pending ?? []) {
    const m = byKey.get(key)
    if (!m) continue
    const input = { login: m.channel, ...(m.streamId ? { streamId: m.streamId } : {}), ...(m.vodId ? { vodId: m.vodId } : {}),
      offsetSeconds: Math.floor(m.offsetSeconds!), title: m.title.slice(0, 160), jumpedAt: new Date(m.jumpedAt!).toISOString() }
    const size = new TextEncoder().encode(JSON.stringify(input)).length + 1
    if (batch.length >= BATCH_ENTRIES || bytes + size > BATCH_BYTES) break
    bytes += size
    batch.push({ key, jumpedAt: m.jumpedAt!, input })
  }
  return batch
}

/**
 * Merges a sync reply into this browser's copy. A moment keeps its latest jump;
 * the account's retention, cap and last clear apply to everything held here.
 * After a full reply, whatever the account lacks or holds older goes back into
 * the queue. Sent jumps leave the queue unless they were jumped again since.
 */
export function applySyncReply(data: PersonalData, started: { epoch: number; revision: number }, sent: ReadonlyMap<string, number>, reply: SyncReply, now: number): PersonalData {
  const sync = data.accountSync
  // A clear, retention change or switch since the request started outranks its reply.
  if (!sync?.enabled || sync.revision !== started.revision || data.epoch !== started.epoch) return data
  const days = reply.settings.retentionDays
  const history = data.history.map(m => ({ ...m }))
  const local = new Map(history.filter(syncable).map(m => [syncKey(m), m]))
  const server = new Map<string, LibraryMoment>()
  for (const entry of reply.entries) {
    const key = syncKey(entry)
    server.set(key, entry)
    const mine = local.get(key)
    if (!mine) { history.push(entry); local.set(key, entry); continue }
    if (entry.jumpedAt! > mine.jumpedAt!) Object.assign(mine, { title: entry.title || mine.title, jumpedAt: entry.jumpedAt,
      streamId: mine.streamId || entry.streamId, vodId: mine.vodId ?? entry.vodId })
  }
  const clearedAt = Math.max(sync.clearedAt ?? 0, reply.clearedAt ?? 0) || undefined
  const kept = history
    .map(m => m.jumpedAt === undefined ? m : { ...m, historyExpiresAt: m.jumpedAt + days * DAY })
    .filter(m => (m.historyExpiresAt ?? 0) > now && (clearedAt === undefined || (m.jumpedAt ?? 0) > clearedAt))
    .sort((a, b) => (a.jumpedAt ?? 0) - (b.jumpedAt ?? 0))
    .slice(-MAX_ENTRIES)
  const held = new Map(kept.filter(syncable).map(m => [syncKey(m), m]))
  const pending = new Set(sync.pending.filter(key => !(sent.has(key) && (held.get(key)?.jumpedAt ?? 0) <= sent.get(key)!)))
  if (reply.reset) for (const [key, m] of held) if (!server.has(key) || server.get(key)!.jumpedAt! < m.jumpedAt!) pending.add(key)
  // A clear from elsewhere also voids captures already under way here.
  const remoteClear = reply.clearedAt !== undefined && reply.clearedAt > (sync.clearedAt ?? 0)
  return { ...data, epoch: remoteClear ? Math.max(now, data.epoch + 1) : data.epoch, history: kept,
    preferences: { ...data.preferences, retentionDays: days },
    accountSync: { ...sync, cursor: reply.cursor, pending: [...pending].filter(key => held.has(key)), clearedAt, syncedAt: now, failed: false, available: true } }
}

export function historySyncView(signedIn: boolean, data: PersonalData): HistorySyncView {
  const sync = data.accountSync
  if (!signedIn) return { state: 'signed_out' }
  if (sync && !sync.available) return { state: 'unavailable' }
  if (!sync?.enabled) return { state: 'off' }
  return { state: 'on', syncedAt: sync.syncedAt ?? null, pending: sync.pending.length, failed: !!sync.failed }
}

/** Account settings (a read when `change` is empty); null when the server does not offer sync. */
async function accountSettings(accountId: string, change: Partial<ServerSettings> = {}): Promise<ServerSettings | null> {
  const result = await accountHistoryRequest('/v1/account/history/settings', change, accountId)
  if (result.status === 404) return null
  const settings = result.status === 200 ? parseSettings(result.body) : null
  if (!settings) throw new Error(`history_settings ${result.status}`)
  return settings
}
const unavailable = () => new Error('History sync is not available yet.')
const unchanged = (what: string) => new Error(`Could not reach StreamPulse to ${what}. Nothing was changed.`)

/** Turns the account's sync on or off from this browser. Off deletes the account's copy, never this device's. */
export async function setHistorySync(scope: string, accountId: string, enabled: boolean): Promise<void> {
  const local = await personalTransaction(scope)
  let settings: ServerSettings | null
  try {
    settings = await accountSettings(accountId)
    // Joining an account that already syncs keeps its retention; starting
    // sync brings this browser's.
    if (settings && settings.syncEnabled !== enabled) settings = await accountSettings(accountId, enabled ? { syncEnabled: true, retentionDays: local.preferences.retentionDays } : { syncEnabled: false })
  } catch { throw unchanged(enabled ? 'turn on history sync' : 'turn off history sync') }
  if (!settings) throw unavailable()
  const days = settings.retentionDays
  await personalTransaction(scope, data => ({ ...data, epoch: Math.max(Date.now(), data.epoch + 1),
    preferences: enabled ? { captureHistory: true, retentionDays: days } : data.preferences,
    accountSync: { enabled, available: true, revision: (data.accountSync?.revision ?? 0) + 1, pending: enabled ? syncableKeys(data.history) : [], checkedAt: Date.now() } }))
  if (enabled) await syncHistoryNow(scope, accountId)
}

/** A new retention while syncing applies to the whole account first. */
export async function setAccountRetention(accountId: string, retentionDays: Retention): Promise<void> {
  let settings: ServerSettings | null
  try { settings = await accountSettings(accountId, { retentionDays }) } catch { throw unchanged('change how long history is kept') }
  if (!settings) throw unavailable()
}
/** Clears the account's copy; every browser drops its own on its next sync. */
export async function clearAccountHistory(accountId: string): Promise<void> {
  let result: { status: number }
  try { result = await accountHistoryRequest('/v1/account/history/clear', {}, accountId) } catch { throw unchanged('clear your account’s history') }
  if (result.status !== 204) throw unchanged('clear your account’s history')
}

let running: Promise<void> | null = null
let queued: [scope: string, accountId: string] | null = null
/** Single flight per worker: a request during a run queues one more, for the latest account. */
export function syncHistoryNow(scope: string, accountId: string): Promise<void> {
  queued = [scope, accountId]
  if (running) return running
  running = (async () => {
    try {
      while (queued) { const [s, a] = queued; queued = null; await runSync(s, a) }
    } finally { running = null }
  })()
  return running
}
async function note(scope: string, revision: number, change: Partial<AccountHistorySync>) {
  await personalTransaction(scope, data => data.accountSync?.revision === revision ? { ...data, accountSync: { ...data.accountSync, ...change } } : data)
}
async function runSync(scope: string, accountId: string): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await personalTransaction(scope)
    const sync = data.accountSync
    if (!sync?.enabled) return
    const started = { epoch: data.epoch, revision: sync.revision }
    const batch = nextBatch(data)
    let result: { status: number; body: unknown }
    try {
      result = await accountHistoryRequest('/v1/account/history/sync', { entries: batch.map(b => b.input), cursor: sync.cursor ?? '' }, accountId)
    } catch {
      await note(scope, sync.revision, { failed: true })
      return
    }
    if (result.status === 404) return note(scope, sync.revision, { enabled: false, available: false, pending: [], cursor: undefined })
    if (result.status === 409 && record(result.body) && result.body.error === 'history_sync_off') {
      // Turned off elsewhere: the account's copy is gone; this device keeps its own.
      return note(scope, sync.revision, { enabled: false, pending: [], cursor: undefined, checkedAt: Date.now() })
    }
    const reply = result.status === 200 ? parseSyncReply(result.body) : null
    if (!reply) return note(scope, sync.revision, { failed: true })
    const at = Date.now()
    const next = await personalTransaction(scope, d => applySyncReply(d, started, new Map(batch.map(b => [b.key, b.jumpedAt])), reply, at))
    // A newer local change discarded the reply; the next trigger starts over.
    if (next.accountSync?.syncedAt !== at || !next.accountSync.pending.length) return
  }
}

/**
 * Whether a Pulse jump should first ask the account whether history sync is
 * on: it is not syncing here, it has not asked in the last few minutes, and
 * the server has not answered that it does not offer sync (that is learned
 * again when My Moments opens).
 */
export function historySyncCheckDue(data: PersonalData, now = Date.now()): boolean {
  const sync = data.accountSync
  return !sync?.enabled && sync?.available !== false && !(sync?.checkedAt && now - sync.checkedAt < RECHECK_MS)
}

/**
 * Before My Moments shows the account's history, and before a Twitch tab asks
 * whether to record a jump: sync if on, otherwise learn (at most every few
 * minutes) whether another browser or the website turned it on. A browser that
 * joins (or is reinstalled into) an account that syncs also starts
 * remembering watched moments: the account's choice was explicit, and without
 * it this browser would show other browsers' history but add none of its own.
 * It can still turn that off here, and a later check does not turn it back on.
 * Never throws; a failure shows as a status.
 */
export async function refreshHistorySync(scope: string, accountId: string, now = Date.now()): Promise<void> {
  try {
    const data = await personalTransaction(scope)
    const sync = data.accountSync
    if (sync?.enabled) return await syncHistoryNow(scope, accountId)
    if (sync?.checkedAt && now - sync.checkedAt < RECHECK_MS) return
    const settings = await accountSettings(accountId)
    const revision = (sync?.revision ?? 0) + 1
    await personalTransaction(scope, d => d.accountSync?.revision !== sync?.revision ? d : {
      ...d, ...(settings?.syncEnabled ? { preferences: { ...d.preferences, captureHistory: true, retentionDays: settings.retentionDays } } : {}),
      accountSync: { enabled: !!settings?.syncEnabled, available: settings !== null, revision, checkedAt: now,
        pending: settings?.syncEnabled ? syncableKeys(d.history) : [] },
    })
    if (settings?.syncEnabled) await syncHistoryNow(scope, accountId)
  } catch { /* The page still shows this device's copy. */ }
}
