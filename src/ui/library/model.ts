/** UI contract. Production adapters must validate ownership and input at the worker boundary. */
export interface MomentReference {
  id: string
  channel: string
  title: string
  vodId: string | null
  /** Stable stream identity allows a verified live jump before a VOD exists. */
  streamId?: string
  offsetSeconds: number | null
  availability: 'available' | 'unavailable' | 'unresolved'
}
export interface LibraryMoment extends MomentReference {
  savedAt?: number
  jumpedAt?: number
  historyExpiresAt?: number
  note: string
  collectionId?: string
}
export interface LibraryPreferences { captureHistory: boolean; retentionDays: 7 | 30 | 90 }
export interface LibraryCollection { id: string; name: string }
export type SyncState =
  | { kind: 'local' }
  | { kind: 'offline'; pending: number }
  | { kind: 'syncing'; pending: number }
  | { kind: 'synced'; at: number }
  | { kind: 'error'; message: string }
export interface LibrarySnapshot {
  moments: readonly LibraryMoment[]
  collections: readonly LibraryCollection[]
  preferences: LibraryPreferences
  membership: 'free' | 'supporter' | 'expired'
  storage: { usedBytes: number; limitBytes: number; persistence: 'granted' | 'not-granted' | 'unknown' }
  sync: SyncState
}
export type MomentInteraction =
  | { kind: 'selected' | 'opened-link' | 'seek-failed'; reference: MomentReference }
  | { kind: 'seek-confirmed'; reference: MomentReference; occurredAt: number; incognito: boolean }
export type LibraryCommand =
  | { kind: 'save'; reference: MomentReference }
  | { kind: 'unsave'; id: string }
  | { kind: 'edit'; id: string; note: string; collectionId?: string }
  | { kind: 'clear-history' }
  | { kind: 'preferences'; value: LibraryPreferences }
  | { kind: 'create-collection'; name: string }
  | { kind: 'interaction'; event: MomentInteraction }
export interface LibraryRepository {
  /** Return an account-scoped, bounded snapshot; never query from a content script. */
  load(signal: AbortSignal): Promise<LibrarySnapshot>
  /** Resolve only after durable commit. Reject without publishing a false success. */
  execute(command: LibraryCommand, signal: AbortSignal): Promise<LibrarySnapshot>
  /** Export the complete authorized dataset, not just the visible page/search results. */
  export(signal: AbortSignal): Promise<string>
}
export type LibraryView = 'saved' | 'recent' | 'storage'
export const NOTE_LIMIT = 1000
export const DAY = 86_400_000

export function timestamp(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'Position unknown'
  const value = Math.floor(seconds)
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(v => String(v).padStart(2, '0')).join(':')
}
export function replayUrl(reference: MomentReference): string | null {
  if (reference.availability !== 'available' || !reference.vodId || !/^\d+$/.test(reference.vodId)
    || reference.offsetSeconds === null || !Number.isFinite(reference.offsetSeconds) || reference.offsetSeconds < 0) return null
  return `https://www.twitch.tv/videos/${reference.vodId}?t=${Math.floor(reference.offsetSeconds)}s`
}
export function hasRecent(moment: LibraryMoment, now: number): boolean {
  return moment.jumpedAt !== undefined && moment.historyExpiresAt !== undefined && moment.historyExpiresAt > now
}
export function visibleMoments(snapshot: LibrarySnapshot, view: LibraryView, query: string, collection: string, now: number): LibraryMoment[] {
  const term = query.trim().toLocaleLowerCase()
  return snapshot.moments.filter(m => view === 'recent' ? hasRecent(m, now) : m.savedAt !== undefined)
    .filter(m => !collection || m.collectionId === collection)
    .filter(m => !term || `${m.channel} ${m.title} ${m.note}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => ((view === 'recent' ? b.jumpedAt : b.savedAt) ?? 0) - ((view === 'recent' ? a.jumpedAt : a.savedAt) ?? 0) || a.id.localeCompare(b.id))
}
/** Captures confirmed seeks only. Selection, link opening, failures and incognito are not history. */
export function rememberInteraction(snapshot: LibrarySnapshot, event: MomentInteraction): LibrarySnapshot {
  if (event.kind !== 'seek-confirmed' || event.incognito || !snapshot.preferences.captureHistory) return snapshot
  const reference = event.reference
  const stableSource = (reference.vodId !== null && /^\d+$/.test(reference.vodId)) || !!reference.streamId?.trim()
  if (!stableSource || reference.offsetSeconds === null || !Number.isFinite(reference.offsetSeconds)
    || reference.offsetSeconds < 0 || reference.availability === 'unavailable') return snapshot
  if (!Number.isFinite(event.occurredAt) || event.occurredAt < 0) return snapshot
  const old = snapshot.moments.find(m => m.id === event.reference.id)
  const jumpedAt = Math.max(old?.jumpedAt ?? 0, event.occurredAt)
  const entry: LibraryMoment = { ...old, ...event.reference, note: old?.note ?? '', jumpedAt,
    historyExpiresAt: jumpedAt + snapshot.preferences.retentionDays * DAY }
  return { ...snapshot, moments: [...snapshot.moments.filter(m => m.id !== entry.id), entry] }
}
export function clearHistory(snapshot: LibrarySnapshot): LibrarySnapshot {
  return { ...snapshot, moments: snapshot.moments.filter(m => m.savedAt !== undefined).map(({ jumpedAt: _j, historyExpiresAt: _e, ...m }) => m) }
}
export function validateNote(note: string): string | null {
  if (note.length > NOTE_LIMIT) return `Keep notes under ${NOTE_LIMIT.toLocaleString()} characters.`
  if (new TextEncoder().encode(note).byteLength > 4096) return 'This note exceeds the 4 KiB text limit.'
  return null
}
