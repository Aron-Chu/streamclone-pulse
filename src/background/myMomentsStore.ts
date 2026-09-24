import type { LibraryMoment, LibraryPreferences } from '../ui/library/model.ts'

export interface PersonalData {
  preferences: LibraryPreferences
  epoch: number
  history: LibraryMoment[]
  notes: Record<string, string>
}
export const emptyPersonalData = (): PersonalData => ({ preferences: { captureHistory: false, retentionDays: 30 }, epoch: 0, history: [], notes: {} })
export function prunePersonalData(data: PersonalData, now: number): PersonalData {
  return { ...data, history: data.history.filter(m => (m.historyExpiresAt ?? 0) > now).slice(-1000) }
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
