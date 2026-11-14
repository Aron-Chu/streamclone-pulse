import { formatMomentOffset } from '@streampulse/pulse-core'
import { keptVodOriginDelta } from '../../shared/vodOriginAlignment.ts'
import type { BackupMoment } from '../../shared/myMomentsBackup.ts'

/** UI contract. Production adapters must validate ownership and input at the worker boundary. */
export interface MomentReference {
  id: string
  channel: string
  title: string
  vodId: string | null
  /** Stable stream identity allows a verified live jump before a VOD exists. */
  streamId?: string
  offsetSeconds: number | null
  /**
   * How many seconds `vodId`'s archive starts after the stream did
   * (`vod.startedAt - stream.startedAt`), as the panel's payload reported it
   * when the moment was kept. Only with a VOD id, only when non-zero. Absent
   * on older records and wherever it was not known: the identity mapping.
   */
  vodOriginDeltaSeconds?: number
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
/**
 * Watched history synced through the signed-in account. `unavailable`: the
 * server does not offer it. `on` is the account's choice, shared by every
 * browser signed in to it.
 */
export type HistorySyncView =
  | { state: 'signed_out' | 'unavailable' | 'off' }
  | { state: 'on'; syncedAt: number | null; pending: number; failed: boolean }
export interface LibrarySnapshot {
  moments: readonly LibraryMoment[]
  collections: readonly LibraryCollection[]
  preferences: LibraryPreferences
  membership: 'free' | 'supporter' | 'expired'
  storage: { usedBytes: number; limitBytes: number; persistence: 'granted' | 'not-granted' | 'unknown' }
  sync: SyncState
  historySync?: HistorySyncView
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
  /** Adds saves made without an account to the signed-in account: one (`id`) or all. */
  | { kind: 'import-device-saves'; id?: string }
  /** Copies the watched history this browser kept signed out into the signed-in account's; the browser's copy stays. */
  | { kind: 'import-device-history' }
  /** Drops one moment from History, saved or not; `restore-visit` is its Undo. */
  | { kind: 'remove-visit'; reference: MomentReference }
  | { kind: 'restore-visit'; reference: MomentReference; jumpedAt: number }
  /** A backup file's moments: adds only what this browser lacks. */
  | { kind: 'import-backup'; saves: BackupMoment[]; history: BackupMoment[] }
  | { kind: 'history-sync'; enabled: boolean }
  | { kind: 'create-collection'; name: string }
  | { kind: 'interaction'; event: MomentInteraction }
export interface LibraryRepository {
  /** Return an account-scoped, bounded snapshot; never query from a content script. */
  load(signal: AbortSignal): Promise<LibrarySnapshot>
  /** Resolve only after durable commit. Reject without publishing a false success. */
  execute(command: LibraryCommand, signal: AbortSignal): Promise<LibrarySnapshot>
  /** Export the complete authorized dataset, not just the visible page/search results. */
  export(signal: AbortSignal): Promise<string>
  /** Calls `onChange` when the data changed elsewhere, such as a moment watched in another tab. Returns the unsubscribe. */
  subscribe?(onChange: () => void): () => void
}
export type LibraryView = 'saved' | 'recent' | 'storage'
export const NOTE_LIMIT = 1000
export const DAY = 86_400_000

/** Time into the stream as h:mm:ss, the panel's clock (K1): 1:42:18. */
export function timestamp(seconds: number | null): string {
  return seconds === null || !Number.isFinite(seconds) || seconds < 0 ? 'Position unknown' : formatMomentOffset(seconds)
}
/**
 * The moment on Twitch. `offsetSeconds` counts from go-live and `?t=` from the
 * archive start, so a kept origin delta comes off (never below the start), as
 * the panel's own VOD jumps do. Without one, as on every older record, the two
 * clocks are taken to agree. Only a replay known to play gets one.
 */
export function replayUrl(reference: MomentReference): string | null {
  return reference.availability === 'available' ? videoUrl(reference) : null
}
/** The VOD link whether or not it still plays: "Try the replay" on one that may be gone. */
export function videoUrl(reference: MomentReference): string | null {
  if (reference.availability === 'unresolved' || !reference.vodId || !/^\d+$/.test(reference.vodId)
    || reference.offsetSeconds === null || !Number.isFinite(reference.offsetSeconds) || reference.offsetSeconds < 0) return null
  const delta = keptVodOriginDelta(reference.vodOriginDeltaSeconds) ?? 0
  return `https://www.twitch.tv/videos/${reference.vodId}?t=${Math.max(0, Math.floor(reference.offsetSeconds) - delta)}s`
}
/**
 * Twitch deletes most replays 7 days after the stream (partners' and Prime
 * viewers' after 60), so one last seen playing longer ago than this may be
 * gone. Seen playing: saved (live or on the VOD) or watched for 10 s.
 */
export const REPLAY_KEPT_DAYS = 7
/**
 * Pulse offsets count from go-live; Twitch's `?t=` counts from the archive
 * start. They agree when the archive starts with the stream, the mapping every
 * VOD path uses when the backend reports no origin delta (completed VOD pages,
 * the channel's open-in-VOD jump, the portal's bookmark link). A reference
 * keeps a delta (`vodOriginDeltaSeconds`) only when the panel knew one. A
 * numeric VOD id is required to address the second; a stream-only reference
 * stays unresolved and keeps its analytics link. `seenAt`: when the replay was
 * last known to play; older than REPLAY_KEPT_DAYS, it may be gone.
 */
export function replayAvailability(m: Pick<MomentReference, 'vodId' | 'offsetSeconds'>, seenAt?: number, now = Date.now()): MomentReference['availability'] {
  if (!(m.vodId && /^\d{6,20}$/.test(m.vodId) && m.offsetSeconds !== null && Number.isFinite(m.offsetSeconds) && m.offsetSeconds >= 0)) return 'unresolved'
  return seenAt && now - seenAt > REPLAY_KEPT_DAYS * DAY ? 'unavailable' : 'available'
}
/**
 * H2: what a My Moments row says about its replay, and what its main button
 * does. A replay that plays is watched; one not linked yet is previewed; one
 * that may be gone opens the channel instead.
 */
export function rowReplay(moment: MomentReference): { chip: string; tone: 'ok' | 'wait' | 'gone'; main: 'watch' | 'preview' | 'channel' } {
  return replayUrl(moment) ? { chip: 'Replay ready', tone: 'ok', main: 'watch' }
    : moment.availability === 'unavailable' ? { chip: 'Replay may be gone', tone: 'gone', main: 'channel' }
      : { chip: 'Replay not linked yet', tone: 'wait', main: 'preview' }
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
