import { accountRequest, AccountError } from './accountApi'
import { buildAnalyticsHref } from './analyticsLinks'

/**
 * Build-time switch for My Moments on the website. Off unless the build sets
 * VITE_ACCOUNT_MOMENTS=1. Turning it on needs the backend's
 * PULSE_ACCOUNT_HISTORY_SYNC_ENABLED and the edge relay routes
 * (/v1/account/history/list|forget, /v1/account/saves/list), which need an
 * edge-freeze approval.
 */
export function accountMomentsEnabled(): boolean {
  return import.meta.env.VITE_ACCOUNT_MOMENTS === '1'
}

/** A saved or watched moment: one channel, stream (or VOD) and whole second. */
export interface AccountMoment {
  key: string
  login: string
  streamId?: string
  vodId?: string
  offsetSeconds: number
  title: string
  /** Saved at, or last watched at (ms). */
  at: number
  /** History only: when it leaves the account. */
  expiresAt?: number
  /** Saves only: the note kept with the account. */
  notes?: string
}
export interface HistoryPage { syncEnabled: boolean; retentionDays: number; entries: AccountMoment[]; next?: string }
export interface SavesPage { saves: AccountMoment[]; next?: string }

const LOGIN = /^[a-z0-9_]{1,25}$/
const NUMERIC = /^\d{1,20}$/
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optionalId = (v: unknown) => v === undefined || (typeof v === 'string' && NUMERIC.test(v))
const cursor = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : undefined

function moment(v: unknown, kind: 'history' | 'save'): AccountMoment | null {
  if (!record(v) || typeof v.login !== 'string' || !LOGIN.test(v.login) || !optionalId(v.streamId) || !optionalId(v.vodId)) return null
  if (!v.streamId && !v.vodId) return null
  if (!Number.isSafeInteger(v.offsetSeconds) || (v.offsetSeconds as number) < 0) return null
  const title = kind === 'history' ? v.title : v.label
  const at = Date.parse(String(kind === 'history' ? v.jumpedAt : v.createdAt))
  const key = kind === 'history' ? v.key : v.id
  if (typeof title !== 'string' || typeof key !== 'string' || !key || !Number.isFinite(at)) return null
  const expiresAt = kind === 'history' ? Date.parse(String(v.expiresAt)) : NaN
  return { key, login: v.login, ...(v.streamId ? { streamId: v.streamId as string } : {}), ...(v.vodId ? { vodId: v.vodId as string } : {}),
    offsetSeconds: v.offsetSeconds as number, title: title.slice(0, 200), at,
    ...(Number.isFinite(expiresAt) ? { expiresAt } : {}), ...(kind === 'save' && typeof v.notes === 'string' && v.notes ? { notes: v.notes.slice(0, 1000) } : {}) }
}
const rows = (v: unknown, kind: 'history' | 'save') => Array.isArray(v) ? v.map(item => moment(item, kind)).filter((m): m is AccountMoment => m !== null) : null

/** Newest first, a page at a time; `before` is the previous page's `next`. */
export async function listHistory(before?: string): Promise<HistoryPage> {
  const body = await accountRequest('/history/list', before ? { before } : {})
  const settings = body.settings
  const entries = rows(body.entries, 'history')
  if (!record(settings) || typeof settings.syncEnabled !== 'boolean' || ![7, 30, 90].includes(settings.retentionDays as number) || !entries) throw new AccountError(503)
  return { syncEnabled: settings.syncEnabled, retentionDays: settings.retentionDays as number, entries, ...(cursor(body.next) ? { next: cursor(body.next) } : {}) }
}

export async function listSaves(before?: string): Promise<SavesPage> {
  const body = await accountRequest('/saves/list', before ? { before } : {})
  const saves = rows(body.saves, 'save')
  if (!saves) throw new AccountError(503)
  return { saves, ...(cursor(body.next) ? { next: cursor(body.next) } : {}) }
}

/** Deletes the account's synced history; each browser drops its copy on its next sync. */
export async function forgetHistory(): Promise<void> {
  await accountRequest('/history/forget', {})
}

export function momentTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':')
}
/**
 * The replay on Twitch at that second. Pulse offsets count from go-live and
 * agree with the VOD's `?t=` when the archive starts with the stream, the same
 * mapping the extension uses.
 */
export function replayHref(m: Pick<AccountMoment, 'vodId' | 'offsetSeconds'>): string | null {
  return m.vodId && /^\d{6,20}$/.test(m.vodId) ? `https://www.twitch.tv/videos/${m.vodId}?t=${Math.floor(m.offsetSeconds)}s` : null
}
export function momentAnalyticsHref(m: Pick<AccountMoment, 'login' | 'streamId' | 'offsetSeconds'>): string | null {
  return m.streamId ? buildAnalyticsHref({ login: m.login, streamId: m.streamId, offsetSeconds: m.offsetSeconds }) : null
}
