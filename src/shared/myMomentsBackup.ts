import { keptVodOriginDelta } from './vodOriginAlignment.ts'

/**
 * One moment read back from a My Moments export file: a save (`at`: when it
 * was saved) or a History entry (`at`: when it was watched). Only these fields
 * are taken; anything else in the file is ignored.
 */
export interface BackupMoment {
  channel: string
  title: string
  vodId: string | null
  streamId?: string
  offsetSeconds: number
  vodOriginDeltaSeconds?: number
  note: string
  at: number
}

/** Larger than any export this browser can make (2 MiB of data, pretty-printed). */
export const BACKUP_MAX_BYTES = 8 * 1048576
/** Bounds one import, like the 1,000 History entries a browser keeps. */
export const BACKUP_MAX_SAVES = 2000
export const BACKUP_MAX_HISTORY = 1000

const EARLIEST = Date.UTC(2020, 0, 1)
const text = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : ''
const time = (v: unknown, now: number) => typeof v === 'number' && Number.isFinite(v) && v >= EARLIEST && v <= now + 86_400_000 ? Math.floor(v) : null

/** One moment of the file, or null when it is not one this browser could have written. */
function backupMoment(v: unknown, at: unknown, now: number): BackupMoment | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const m = v as Record<string, unknown>
  const when = time(at, now)
  const vodId = typeof m.vodId === 'string' && /^\d{6,20}$/.test(m.vodId) ? m.vodId : null
  const streamId = typeof m.streamId === 'string' && /^\d{6,20}$/.test(m.streamId) ? m.streamId : undefined
  const offset = m.offsetSeconds
  if (when === null || typeof m.channel !== 'string' || !/^[a-z0-9_]{1,25}$/.test(m.channel) || (!vodId && !streamId)
    || typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0 || offset > 604800) return null
  const delta = vodId ? keptVodOriginDelta(m.vodOriginDeltaSeconds) : undefined
  return { channel: m.channel, title: text(m.title, 160) || 'Saved moment', vodId, ...(streamId ? { streamId } : {}),
    offsetSeconds: Math.floor(offset), ...(delta === undefined ? {} : { vodOriginDeltaSeconds: delta }), note: text(m.note, 1000), at: when }
}

/** Whether a command's moment is one `parseMomentsBackup` could have made: the worker checks every entry again. */
export function validBackupMoment(v: unknown, now = Date.now()): v is BackupMoment {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const m = v as Record<string, unknown>
  if (!Object.keys(m).every(k => ['channel', 'title', 'vodId', 'streamId', 'offsetSeconds', 'vodOriginDeltaSeconds', 'note', 'at'].includes(k))) return false
  const read = backupMoment(m, m.at, now)
  return !!read && read.title === m.title && read.note === m.note && read.offsetSeconds === m.offsetSeconds && read.vodId === m.vodId
    && read.streamId === m.streamId && read.vodOriginDeltaSeconds === m.vodOriginDeltaSeconds
}

/**
 * Reads the file My Moments' Export makes (`streampulse-my-moments.json`,
 * version 1): its saves (rows with `savedAt`, and the saves an account kept on
 * the device) and its History entries (rows with `jumpedAt`). Rows that do
 * not check out are left out. Null when the file is not such an export.
 */
export function parseMomentsBackup(raw: string, now = Date.now()): { saves: BackupMoment[]; history: BackupMoment[] } | null {
  let file: unknown
  try { file = JSON.parse(raw) } catch { return null }
  if (!file || typeof file !== 'object' || Array.isArray(file)) return null
  const f = file as Record<string, unknown>
  if (f.version !== 1 || !Array.isArray(f.moments)) return null
  const saves: BackupMoment[] = []
  const history: BackupMoment[] = []
  for (const row of f.moments.slice(0, BACKUP_MAX_SAVES + BACKUP_MAX_HISTORY)) {
    const r = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    const saved = backupMoment(r, r.savedAt, now)
    if (saved) saves.push(saved)
    const watched = backupMoment(r, r.jumpedAt, now)
    if (watched) history.push({ ...watched, note: '' })
  }
  // An account's saves kept on the device: the hosted bookmark shape.
  for (const b of Array.isArray(f.deviceBookmarks) ? f.deviceBookmarks.slice(0, BACKUP_MAX_SAVES) : []) {
    const r = b && typeof b === 'object' ? b as Record<string, unknown> : {}
    const saved = backupMoment({ ...r, channel: r.login, title: r.label, note: r.notes }, typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : null, now)
    if (saved) saves.push(saved)
  }
  return { saves: saves.slice(0, BACKUP_MAX_SAVES), history: history.slice(0, BACKUP_MAX_HISTORY) }
}
