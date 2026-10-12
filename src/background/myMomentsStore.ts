import { parseBookmarkPage } from '../shared/bookmarkPage.ts'
import type { CreatePulseBookmarkInput, PulseBookmark } from '../shared/messages.ts'
import type { LibraryMoment, LibraryPreferences } from '../ui/library/model.ts'
import type { AccountHistorySync } from './historySync.ts'

export interface PersonalData {
  preferences: LibraryPreferences
  epoch: number
  history: LibraryMoment[]
  notes: Record<string, string>
  /**
   * Saves made without an account. They leave this database only through an
   * explicit "Add to account" (`import-device-saves`), which posts the hosted
   * bookmark shape each one keeps. Account scopes leave this empty.
   */
  bookmarks: PulseBookmark[]
  /** Account scopes only: this browser's side of the account's synced history. */
  accountSync?: AccountHistorySync
}
export const emptyPersonalData = (): PersonalData => ({ preferences: { captureHistory: false, retentionDays: 30 }, epoch: 0, history: [], notes: {}, bookmarks: [] })
type MomentKey = { channel: string; vodId: string | null; streamId?: string; offsetSeconds: number | null }
/** Channel, stream (or VOD) and whole second, like bookmarks and the account's history keys. */
export const momentIdentity = (m: MomentKey) => `${m.channel}:${m.streamId || m.vodId}:${m.offsetSeconds === null ? null : Math.floor(m.offsetSeconds)}`
export const bookmarkIdentity = (b: PulseBookmark) => momentIdentity({ channel: b.login, vodId: b.vodId ?? null, streamId: b.streamId, offsetSeconds: b.offsetSeconds })
/** The id history entries got before identities used whole seconds (`…:125.6`). */
const fractionalIdentity = (m: MomentKey) => `${m.channel}:${m.streamId || m.vodId}:${m.offsetSeconds}`
/**
 * Re-keys history written with a fractional second to the whole-second
 * identity, once per read until the next write stores it. Duplicates merge
 * into the newest jump; a note follows its moment unless the new id has one.
 */
function wholeSecondHistory(data: PersonalData): PersonalData {
  if (!data.history.some(m => m.id === fractionalIdentity(m) && m.id !== momentIdentity(m))) return data
  const notes = { ...data.notes }
  const byId = new Map<string, LibraryMoment>()
  for (const m of data.history) {
    const id = m.id === fractionalIdentity(m) ? momentIdentity(m) : m.id
    if (id !== m.id && notes[m.id] !== undefined) {
      if (notes[id] === undefined) notes[id] = notes[m.id]
      delete notes[m.id]
    }
    const prior = byId.get(id)
    if (!prior || (m.jumpedAt ?? 0) >= (prior.jumpedAt ?? 0)) byId.set(id, { ...m, id })
  }
  return { ...data, notes, history: [...byId.values()].sort((a, b) => (a.jumpedAt ?? 0) - (b.jumpedAt ?? 0)) }
}
export function prunePersonalData(data: PersonalData, now: number): PersonalData {
  // Records written before device bookmarks existed have no `bookmarks` field.
  const current = wholeSecondHistory({ ...emptyPersonalData(), ...data })
  return { ...current, history: current.history.filter(m => (m.historyExpiresAt ?? 0) > now).slice(-1000) }
}
/**
 * Idempotent per channel, stream (or VOD) and whole second, like the hosted
 * list. Rows must pass the hosted page parser, so an import can post them as-is.
 */
export function addDeviceBookmark(data: PersonalData, input: Pick<CreatePulseBookmarkInput, 'login' | 'streamId' | 'vodId' | 'offsetSeconds' | 'label'>, now: number): PersonalData {
  const at = new Date(now).toISOString()
  const [bookmark] = parseBookmarkPage({ items: [{ id: `local:${crypto.randomUUID()}`, login: input.login, offsetSeconds: Math.floor(input.offsetSeconds),
    label: (input.label ?? '').slice(0, 160), notes: '', source: 'extension', createdAt: at, updatedAt: at,
    ...(input.streamId ? { streamId: input.streamId } : {}), ...(input.vodId ? { vodId: input.vodId } : {}) }] }, 1).items
  if (!bookmark.streamId && !bookmark.vodId) throw new Error('invalid_bookmark_page')
  if (data.bookmarks.some(b => bookmarkIdentity(b) === bookmarkIdentity(bookmark))) return data
  return { ...data, bookmarks: [...data.bookmarks, bookmark] }
}
export function recordWatched(data: PersonalData, moment: LibraryMoment, epoch: number, now: number): PersonalData {
  const next = prunePersonalData(data, now)
  if (!data.preferences.captureHistory || data.epoch !== epoch) return next
  const entry = { ...moment, jumpedAt: now, historyExpiresAt: now + data.preferences.retentionDays * 86400000 }
  const sync = next.accountSync
  // While the account syncs, the jump waits in the queue until it is sent.
  const key = `${entry.channel}:${entry.streamId || entry.vodId}:${Math.floor(entry.offsetSeconds ?? 0)}`
  return { ...next, history: [...next.history.filter(m => m.id !== entry.id), entry].slice(-1000),
    ...(sync?.enabled ? { accountSync: { ...sync, pending: [...sync.pending.filter(k => k !== key), key] } } : {}) }
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pulse-my-moments-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('personal')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
/** Removes one scope's record: an account's copy (history, notes) after this device leaves it. */
export async function deletePersonal(scope: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('personal', 'readwrite')
      tx.objectStore('personal').delete(scope)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Local storage unavailable'))
    })
  } finally { db.close() }
}
export async function personalTransaction(scope: string, update?: (data: PersonalData) => PersonalData): Promise<PersonalData> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('personal', update ? 'readwrite' : 'readonly')
      const store = tx.objectStore('personal')
      const request = store.get(scope)
      let data: PersonalData
      let failure: unknown
      request.onsuccess = () => {
        try {
          data = prunePersonalData(request.result ?? emptyPersonalData(), Date.now())
          if (update) {
            data = update(data)
            if (new TextEncoder().encode(JSON.stringify(data)).length > 2 * 1048576) throw new Error('Local data allowance reached. Export and remove notes or clear history.')
            store.put(data, scope)
          }
        } catch (error) { failure = error; tx.abort() }
      }
      tx.oncomplete = () => resolve(data)
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local storage unavailable'))
    })
  } finally { db.close() }
}
