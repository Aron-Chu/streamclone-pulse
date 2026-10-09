import { parseBookmarkPage } from '../shared/bookmarkPage.ts'
import type { CreatePulseBookmarkInput, PulseBookmark } from '../shared/messages.ts'
import type { LibraryMoment, LibraryPreferences } from '../ui/library/model.ts'

export interface PersonalData {
  preferences: LibraryPreferences
  epoch: number
  history: LibraryMoment[]
  notes: Record<string, string>
  /**
   * Saves made without an account. They never leave this database; each keeps
   * the hosted bookmark shape so a later, explicit account import can post them
   * as-is. Account scopes leave this empty.
   */
  bookmarks: PulseBookmark[]
}
export const emptyPersonalData = (): PersonalData => ({ preferences: { captureHistory: false, retentionDays: 30 }, epoch: 0, history: [], notes: {}, bookmarks: [] })
export const momentIdentity = (m: { channel: string; vodId: string | null; streamId?: string; offsetSeconds: number | null }) => `${m.channel}:${m.streamId || m.vodId}:${m.offsetSeconds}`
export const bookmarkIdentity = (b: PulseBookmark) => momentIdentity({ channel: b.login, vodId: b.vodId ?? null, streamId: b.streamId, offsetSeconds: b.offsetSeconds })
export function prunePersonalData(data: PersonalData, now: number): PersonalData {
  // Records written before device bookmarks existed have no `bookmarks` field.
  return { ...emptyPersonalData(), ...data, history: data.history.filter(m => (m.historyExpiresAt ?? 0) > now).slice(-1000) }
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
  return { ...next, history: [...next.history.filter(m => m.id !== entry.id), entry].slice(-1000) }
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
