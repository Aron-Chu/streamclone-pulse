import type { LibraryCommand, LibrarySnapshot, MomentReference } from '../ui/library/model.ts'
import type { PulseBookmark } from './messages.ts'

export type MyMomentsCommand = Extract<LibraryCommand, { kind: 'save' | 'unsave' | 'edit' | 'clear-history' | 'preferences' | 'import-device-saves' | 'history-sync' }>
export type MyMomentsRequest =
  | { type: 'MY_MOMENTS'; action: 'load' }
  | { type: 'MY_MOMENTS'; action: 'recent' }
  | { type: 'MY_MOMENTS'; action: 'mutate'; scope: string; command: MyMomentsCommand }
  | { type: 'MOMENT_CAPTURE'; action: 'status' }
  | { type: 'MOMENT_CAPTURE'; action: 'record'; epoch: number; reference: MomentReference; watchedSeconds: number }
/**
 * Why the hosted bookmark list is missing.
 *
 * `not_linked` and `expired` are the common cases and both have an action the
 * reader can take; a single "unavailable" boolean named neither, so the page
 * could not point at the one thing that fixes it.
 */
export type BookmarksState = 'ready' | 'not_linked' | 'expired' | 'error'

/**
 * What the toolbar popup offers to jump back into. Read from this device's own
 * database only; it never fetches the account's hosted bookmarks.
 */
export interface MyMomentsRecent {
  /** Most recent first, at most two, only while history is kept. */
  watched: Array<MomentReference & { jumpedAt: number }>
  /** Saves kept on this device without an account. */
  deviceSaves: number
  latestSave: MomentReference | null
}

export interface MyMomentsSnapshot extends LibrarySnapshot {
  scope: string
  production: true
  bookmarksState: BookmarksState
  /** Derived from `bookmarksState`; the save and export guards read this. */
  bookmarksAvailable: boolean
  localNotes: Record<string, string>
  /**
   * Saves made on this device without an account, while an account is linked.
   * Signed out, they are ordinary rows in `moments` and this is empty. Nothing
   * uploads them except an explicit "Add to account" (`import-device-saves`).
   */
  deviceBookmarks: PulseBookmark[]
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))
export function validMomentReference(v: unknown): v is MomentReference {
  if (!record(v) || !keys(v, ['id', 'channel', 'title', 'vodId', 'streamId', 'offsetSeconds', 'availability'])) return false
  return typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 200
    && typeof v.channel === 'string' && /^[a-z0-9_]{1,25}$/.test(v.channel)
    && typeof v.title === 'string' && v.title.length <= 200
    && (v.vodId === null || typeof v.vodId === 'string' && /^\d{6,20}$/.test(v.vodId))
    && (v.streamId === undefined || typeof v.streamId === 'string' && /^\d{6,20}$/.test(v.streamId))
    && !!(v.vodId || v.streamId) && typeof v.offsetSeconds === 'number' && Number.isFinite(v.offsetSeconds)
    && v.offsetSeconds >= 0 && v.offsetSeconds <= 604800
    && ['available', 'unavailable', 'unresolved'].includes(String(v.availability))
}
export function parseMyMoments(raw: Record<string, unknown>): MyMomentsRequest | null {
  if (raw.type === 'MOMENT_CAPTURE') {
    if (raw.action === 'status' && keys(raw, ['type', 'action'])) return { type: raw.type, action: raw.action }
    if (raw.action !== 'record' || !keys(raw, ['type','action','epoch','reference','watchedSeconds'])
      || !Number.isSafeInteger(raw.epoch) || !validMomentReference(raw.reference)
      || typeof raw.watchedSeconds !== 'number' || !Number.isFinite(raw.watchedSeconds)
      || raw.watchedSeconds < 10 || raw.watchedSeconds > 300) return null
    return { type: raw.type, action: raw.action, epoch: raw.epoch as number, reference: raw.reference, watchedSeconds: raw.watchedSeconds }
  }
  if (raw.type !== 'MY_MOMENTS') return null
  if ((raw.action === 'load' || raw.action === 'recent') && keys(raw, ['type','action'])) return { type: raw.type, action: raw.action }
  if (raw.action !== 'mutate' || !keys(raw, ['type','action','scope','command']) || typeof raw.scope !== 'string' || raw.scope.length > 500 || !record(raw.command)) return null
  const c = raw.command
  const valid = c.kind === 'save' ? keys(c, ['kind','reference']) && validMomentReference(c.reference)
    : c.kind === 'clear-history' ? keys(c, ['kind'])
      : c.kind === 'import-device-saves' ? keys(c, ['kind', 'id']) && (c.id === undefined || typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 200)
      : c.kind === 'history-sync' ? keys(c, ['kind','enabled']) && typeof c.enabled === 'boolean'
      : c.kind === 'preferences' ? keys(c, ['kind','value']) && record(c.value) && keys(c.value, ['captureHistory','retentionDays']) && typeof c.value.captureHistory === 'boolean' && [7,30,90].includes(c.value.retentionDays as number)
        : c.kind === 'edit' || c.kind === 'unsave' ? keys(c, c.kind === 'edit' ? ['kind','id','note'] : ['kind','id']) && typeof c.id === 'string' && c.id.length <= 200 && c.id.length > 0 && (c.kind !== 'edit' || typeof c.note === 'string' && c.note.length <= 1000)
          : false
  return valid ? { type: raw.type, action: 'mutate', scope: raw.scope, command: c as unknown as MyMomentsCommand } : null
}
