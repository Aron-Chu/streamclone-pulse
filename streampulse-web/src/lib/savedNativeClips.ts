import { useSyncExternalStore } from 'react'
import { validClipId, type NativeClip } from './nativeClips'

/**
 * Clips saved in this browser, apart from saved moments. Each keeps the clip's
 * id and a label to show if the clip later leaves the library; never media,
 * links or chat facts, which are read fresh from /v1/public/clips?ids=.
 */
export const SAVED_CLIPS_KEY = 'streampulse.saved-clips.v1'
export const SAVED_CLIPS_LIMIT = 100
export interface SavedClip { id: string; savedAt: number; title: string; channel: string }
interface Snapshot { items: SavedClip[]; warning: string }

let snapshot: Snapshot = { items: [], warning: '' }
let initialized = false
let sessionOnly = false
const listeners = new Set<() => void>()
const publish = () => listeners.forEach(listener => listener())
const label = (value: unknown, limit: number) => typeof value === 'string'
  ? [...value].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim().slice(0, limit) : ''

export function parseSavedClips(raw: string | null): SavedClip[] {
  if (!raw) return []
  if (raw.length > 100_000) throw new Error('Saved data is too large')
  const envelope = JSON.parse(raw)
  if (envelope?.version !== 1 || !Array.isArray(envelope.items) || envelope.items.length > SAVED_CLIPS_LIMIT) throw new Error('Unsupported saved data')
  const unique = new Map<string, SavedClip>()
  for (const row of envelope.items) {
    if (!row || !validClipId(row.id) || !Number.isFinite(row.savedAt) || row.savedAt <= 0) throw new Error('Invalid saved clip')
    if (!unique.has(row.id)) unique.set(row.id, { id: row.id, savedAt: row.savedAt, title: label(row.title, 200), channel: label(row.channel, 100) })
  }
  return [...unique.values()]
}

function initialize() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try { snapshot = { items: parseSavedClips(window.localStorage.getItem(SAVED_CLIPS_KEY)), warning: '' } }
  catch { sessionOnly = true; snapshot = { items: [], warning: 'Saved clips could not be read. Saves work for this visit only; stored data was not overwritten.' } }
}

function refreshStored() {
  if (sessionOnly) return
  try {
    const items = parseSavedClips(window.localStorage.getItem(SAVED_CLIPS_KEY))
    if (JSON.stringify(items) !== JSON.stringify(snapshot.items)) snapshot = { items, warning: snapshot.warning }
  } catch { sessionOnly = true; snapshot = { ...snapshot, warning: 'Saved clips could not be read. Saves work for this visit only; stored data was not overwritten.' } }
}

function persist(items: SavedClip[]) {
  let warning = snapshot.warning
  if (!sessionOnly) {
    try { window.localStorage.setItem(SAVED_CLIPS_KEY, JSON.stringify({ version: 1, items })) }
    catch { sessionOnly = true; warning = 'This browser is not keeping saves. Saved clips last for this visit only.' }
  }
  snapshot = { items, warning }
  publish()
}

/** Saves or unsaves a clip; returns what happened, for a status line. */
export function toggleSavedClip(clip: Pick<NativeClip, 'id' | 'title' | 'channel'>): string {
  initialize(); refreshStored()
  if (snapshot.items.some(item => item.id === clip.id)) { persist(snapshot.items.filter(item => item.id !== clip.id)); return 'Removed from saved clips.' }
  if (snapshot.items.length >= SAVED_CLIPS_LIMIT) return `${SAVED_CLIPS_LIMIT} saved clips reached. Remove one before saving another.`
  persist([{ id: clip.id, savedAt: Date.now(), title: label(clip.title, 200), channel: label(clip.channel.displayName, 100) }, ...snapshot.items])
  return sessionOnly ? 'Saved for this visit only.' : 'Saved in this browser.'
}

export function removeSavedClip(id: string): void {
  initialize(); refreshStored()
  if (snapshot.items.some(item => item.id === id)) persist(snapshot.items.filter(item => item.id !== id))
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SAVED_CLIPS_KEY) return
  refreshStored(); publish()
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}

const serverSnapshot: Snapshot = { items: [], warning: '' }
export function useSavedClips() {
  initialize()
  return useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot)
}
