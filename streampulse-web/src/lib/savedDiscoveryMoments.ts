import { useSyncExternalStore } from 'react'
import { fromHubMoment, type DiscoveryMoment } from './discoveryMoments'

export const SAVED_MOMENTS_KEY = 'streampulse.saved-moments.v1'
export const SAVED_MOMENTS_LIMIT = 200
export interface SavedMoment extends DiscoveryMoment { savedAt: number; note?: string }
interface Snapshot { items: SavedMoment[]; warning: string }
let snapshot: Snapshot = { items: [], warning: '' }
let initialized = false
let sessionOnly = false
const listeners = new Set<() => void>()
const publish = () => listeners.forEach(listener => listener())
/** Allowlist only public descriptive metadata: never persist media URLs, source IDs, or handoff grants. */
export function savedMomentRecord(moment: DiscoveryMoment, savedAt = Date.now()): SavedMoment {
  return { key: moment.key, publicMomentId: moment.publicMomentId, login: moment.login, streamId: moment.streamId,
    offsetSeconds: moment.offsetSeconds, at: moment.at, label: moment.label.slice(0, 300),
    displayName: moment.displayName?.slice(0, 100), category: moment.category?.slice(0, 150),
    storyId: moment.storyId, provenance: 'saved', savedAt }
}
export function parseSavedMoments(raw: string | null): SavedMoment[] {
  if (!raw) return []
  if (raw.length > 500_000) throw new Error('Saved data is too large')
  const envelope = JSON.parse(raw)
  if (envelope?.version !== 1 || !Array.isArray(envelope.items) || envelope.items.length > SAVED_MOMENTS_LIMIT) throw new Error('Unsupported saved data')
  const unique = new Map<string, SavedMoment>()
  for (const row of envelope.items) {
    if (!row || typeof row.label !== 'string' || row.label.length > 300 || !Number.isFinite(row.savedAt) || row.savedAt <= 0) throw new Error('Invalid saved moment')
    const moment = fromHubMoment(row)
    if (!moment) throw new Error('Invalid saved identity')
    moment.storyId = typeof row.storyId === 'string' && row.storyId.length <= 220 ? row.storyId : undefined
    unique.set(moment.key, { ...savedMomentRecord(moment, row.savedAt), ...(typeof row.note === 'string' ? { note: row.note.slice(0, 1000) } : {}) })
  }
  return [...unique.values()]
}
function initialize() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try { snapshot = { items: parseSavedMoments(window.localStorage.getItem(SAVED_MOMENTS_KEY)), warning: '' } }
  catch { sessionOnly = true; snapshot = { items: [], warning: 'Saved data could not be read. Saves are available for this session only; existing stored data was not overwritten.' } }
}
function refreshStored() {
  if (sessionOnly) return
  try { snapshot = { items: parseSavedMoments(window.localStorage.getItem(SAVED_MOMENTS_KEY)), warning: '' } }
  catch { sessionOnly = true; snapshot = { ...snapshot, warning: 'Saved data could not be read. Saves are available for this session only; existing stored data was not overwritten.' } }
}
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SAVED_MOMENTS_KEY) return
  refreshStored(); publish()
}
function persist(items: SavedMoment[]) {
  let warning = snapshot.warning
  if (!sessionOnly) {
    try { window.localStorage.setItem(SAVED_MOMENTS_KEY, JSON.stringify({ version: 1, items })) }
    catch { sessionOnly = true; warning = 'Storage unavailable. Saves are available for this session only.' }
  }
  snapshot = { items, warning }; publish()
}
export function toggleSavedMoment(moment: DiscoveryMoment): string {
  initialize()
  refreshStored()
  const existing = snapshot.items.some(item => item.key === moment.key)
  if (existing) { persist(snapshot.items.filter(item => item.key !== moment.key)); return 'Removed from saved moments.' }
  if (snapshot.items.length >= SAVED_MOMENTS_LIMIT) return '200 saved moments reached. Remove a saved moment before adding another.'
  persist([savedMomentRecord(moment), ...snapshot.items]); return sessionOnly ? 'Saved for this session only.' : 'Saved on this device.'
}
export function updateSavedMomentNote(key: string, note: string): string {
  initialize(); refreshStored()
  if (!snapshot.items.some(item => item.key === key)) return 'This moment is no longer saved.'
  persist(snapshot.items.map(item => item.key === key ? { ...item, note: note.slice(0, 1000) } : item))
  return sessionOnly ? 'Note saved for this session only.' : 'Note saved on this device.'
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
const serverSnapshot: Snapshot = { items: [], warning: '' }
export function useSavedMoments() {
  initialize()
  return useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot)
}
