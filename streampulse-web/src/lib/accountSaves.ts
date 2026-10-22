import { useSyncExternalStore } from 'react'
import { AccountError, accountRequest } from './accountApi'
import { addSignOutStep, currentAccountTag } from './accountSession'
import { fromHubMoment } from './discoveryMoments'
import {
  clearSavedMoments, onSavedMomentChange, replaceSavedMoments, savedMomentRecord, savedMomentsNow,
  type SavedMoment, type SavedMomentChange,
} from './savedDiscoveryMoments'

/**
 * One save list (Aron's M1 and O1 picks, local sandbox 2026-10-21).
 *
 * Signed out, saves stay in this browser. On the first signed-in load, this
 * browser's saves go to the account once: a moment saved on both sides within
 * 90 s is kept once and the newest note wins (the server decides both). The
 * list then becomes this browser's copy of the account's, and every save,
 * removal and note goes to the account through /v1/account/saves/update, the
 * call the extension makes too. Changes that cannot reach the account wait in
 * an outbox and go on the next focus.
 *
 * Sign-out sends the outbox first; offline, it stops and says what would be
 * lost. Then this browser's copy is cleared: the account keeps it all.
 */

const STATE_KEY = 'streampulse.account-saves.v1'
/** The server's batch limit. */
const BATCH = 50
const REFRESH_MS = 60_000
const LOGIN = /^[a-z0-9_]{1,25}$/
const NUMERIC = /^\d{1,20}$/

/** One save as the account holds it. */
export interface AccountSave {
  id: string
  /** The site list's key (channel, stream, second); null for a save with only a VOD. */
  key: string | null
  login: string
  streamId?: string
  vodId?: string
  offsetSeconds: number
  label: string
  notes: string
  /** Where it was saved: the extension ("saved in Chrome") or the site. */
  source: 'web' | 'extension'
  createdAt: number
  updatedAt: number
}

interface SaveChange {
  id?: string
  login: string
  streamId: string
  offsetSeconds: number
  label?: string
  notes?: string
  editedAt?: string
  savedAt?: string
  source: 'web'
  removed?: boolean
}
interface State { account: string; ids: Record<string, string>; outbox: SaveChange[] }

/** What the Account page and the toast read. */
export interface AccountSavesView {
  status: 'idle' | 'syncing' | 'ready' | 'error'
  saves: AccountSave[]
  /** Changes made here that have not reached the account yet. */
  pending: number
  /** Shown once, after this browser's saves joined the account. */
  toast: string | null
}

let view: AccountSavesView = { status: 'idle', saves: [], pending: 0, toast: null }
const listeners = new Set<() => void>()
function publish(next: Partial<AccountSavesView>) {
  view = { ...view, ...next }
  listeners.forEach(listener => listener())
}

function readState(): State | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STATE_KEY) || 'null')
    if (!value || typeof value !== 'object') return null
    const { account, ids, outbox } = value as Partial<State>
    if (typeof account !== 'string' || !ids || typeof ids !== 'object' || !Array.isArray(outbox)) return null
    return { account, ids, outbox }
  } catch { return null }
}
function writeState(state: State | null) {
  try {
    if (state) window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
    else window.localStorage.removeItem(STATE_KEY)
  } catch { /* The outbox then lasts this page only; the next sign-in merges again. */ }
}

const iso = (ms: number) => new Date(ms).toISOString()
function change(item: SavedMoment, state: State, extra: Partial<SaveChange>): SaveChange {
  const id = state.ids[item.key]
  return { ...(id ? { id } : {}), login: item.login, streamId: item.streamId, offsetSeconds: item.offsetSeconds, source: 'web', ...extra }
}

function parseSave(value: unknown): AccountSave | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !v.id || typeof v.login !== 'string' || !LOGIN.test(v.login)) return null
  const streamId = typeof v.streamId === 'string' && NUMERIC.test(v.streamId) ? v.streamId : undefined
  const vodId = typeof v.vodId === 'string' && NUMERIC.test(v.vodId) ? v.vodId : undefined
  if ((!streamId && !vodId) || !Number.isSafeInteger(v.offsetSeconds) || (v.offsetSeconds as number) < 0) return null
  const createdAt = Date.parse(String(v.createdAt))
  const updatedAt = Date.parse(String(v.updatedAt))
  if (!Number.isFinite(createdAt)) return null
  const offsetSeconds = v.offsetSeconds as number
  return {
    id: v.id, key: streamId ? JSON.stringify([v.login, streamId, offsetSeconds]) : null, login: v.login,
    ...(streamId ? { streamId } : {}), ...(vodId ? { vodId } : {}), offsetSeconds,
    label: typeof v.label === 'string' ? v.label.slice(0, 200) : '', notes: typeof v.notes === 'string' ? v.notes.slice(0, 1000) : '',
    source: v.source === 'extension' ? 'extension' : 'web', createdAt, updatedAt: Number.isFinite(updatedAt) ? updatedAt : createdAt,
  }
}

/** The whole account list, newest first. */
export async function listAccountSaves(): Promise<AccountSave[]> {
  const saves: AccountSave[] = []
  let before: string | undefined
  for (let page = 0; page < 60; page++) {
    const body = await accountRequest('/saves/list', before ? { before } : {})
    if (!Array.isArray(body.saves)) throw new AccountError(503)
    for (const row of body.saves) { const save = parseSave(row); if (save) saves.push(save) }
    before = typeof body.next === 'string' && body.next ? body.next : undefined
    if (!before) break
  }
  return saves
}

type Outcome = 'added' | 'updated' | 'kept' | 'removed' | 'missing'
async function send(changes: SaveChange[]): Promise<Array<{ outcome: Outcome; save: AccountSave | null }>> {
  const results: Array<{ outcome: Outcome; save: AccountSave | null }> = []
  for (let start = 0; start < changes.length; start += BATCH) {
    const body = await accountRequest('/saves/update', { saves: changes.slice(start, start + BATCH) })
    if (!Array.isArray(body.results)) throw new AccountError(503)
    for (const row of body.results as Array<Record<string, unknown>>) {
      results.push({ outcome: String(row?.outcome) as Outcome, save: parseSave(row?.save) })
    }
  }
  return results
}

/** The account's saves as the site's list: only those on a stream (a VOD-only save shows in My Moments). */
function asSiteList(saves: AccountSave[]): SavedMoment[] {
  const items: SavedMoment[] = []
  const seen = new Set<string>()
  for (const save of saves) {
    if (!save.streamId || !save.key || seen.has(save.key)) continue
    const moment = fromHubMoment({ login: save.login, streamId: save.streamId, offsetSeconds: save.offsetSeconds, label: save.label })
    if (!moment) continue
    seen.add(save.key)
    items.push(savedMomentRecord({ ...moment, ...(save.notes ? { note: save.notes } : {}) }, save.createdAt))
  }
  return items
}

function adopt(saves: AccountSave[], account: string, outbox: SaveChange[]) {
  const ids: Record<string, string> = {}
  for (const save of saves) if (save.key) ids[save.key] = save.id
  writeState({ account, ids, outbox })
  replaceSavedMoments(asSiteList(saves), { account: true })
  publish({ status: 'ready', saves, pending: outbox.length })
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

let running: Promise<void> | null = null
let lastPull = Number.NEGATIVE_INFINITY

/**
 * Brings this browser in line with the signed-in account: the one-time merge,
 * then the outbox, then the account's list. Safe to call often; calls while
 * one runs share it.
 */
export function syncAccountSaves({ force = false }: { force?: boolean } = {}): Promise<void> {
  const account = currentAccountTag()
  if (!account) return Promise.resolve()
  if (running) return running
  if (!force && Date.now() - lastPull < REFRESH_MS && view.status === 'ready' && !(readState()?.outbox.length)) return Promise.resolve()
  running = (async () => {
    publish({ status: view.status === 'ready' ? 'ready' : 'syncing' })
    const local = savedMomentsNow()
    let state = readState()
    if (local.account && state?.account !== account) {
      // A copy of another account's list (its session ended without a sign-out
      // here). That account still has it; it is not merged into this one.
      clearSavedMoments()
      state = null
    }
    let toast: string | null = null
    if (!state || state.account !== account) {
      const mine = savedMomentsNow().items
      const fresh: State = { account, ids: {}, outbox: [] }
      if (mine.length) {
        const results = await send(mine.map(item => change(item, fresh, {
          label: item.label.slice(0, 160), savedAt: iso(item.savedAt),
          ...(item.note ? { notes: item.note, editedAt: iso(item.savedAt) } : {}),
        })))
        const moved = results.filter(result => result.outcome === 'added' || result.outcome === 'updated')
        const notes = mine.filter((item, index) => item.note && (results[index]?.outcome === 'added' || results[index]?.outcome === 'updated')).length
        if (moved.length) {
          toast = `Added ${plural(moved.length, 'save', 'saves')}${notes ? ` and ${plural(notes, 'note', 'notes')}` : ''} from this browser to your account.`
        }
      }
      state = fresh
    } else {
      // Changes made while a batch is on its way join the outbox behind it.
      for (let round = 0; round < 3 && state?.outbox.length; round++) {
        const sent: number = state.outbox.length
        await send(state.outbox)
        const now = readState()
        state = now && now.account === account ? { ...now, outbox: now.outbox.slice(sent) } : { account, ids: {}, outbox: [] }
        writeState(state)
      }
    }
    const saves = await listAccountSaves()
    lastPull = Date.now()
    // Anything saved here while the list was loading goes on the next sync.
    adopt(saves, account, readState()?.account === account ? (readState()?.outbox ?? []) : [])
    if (toast) publish({ toast })
  })().catch(error => {
    publish({ status: 'error', pending: readState()?.outbox.length ?? 0 })
    throw error
  }).finally(() => { running = null })
  return running
}

/** Sends one change made here (a save, a removal or a note), or keeps it for the next sync. */
async function onChange({ kind, item }: SavedMomentChange) {
  const account = currentAccountTag()
  const state = readState()
  if (!account || !state || state.account !== account || !savedMomentsNow().account) return
  const next = kind === 'remove' ? change(item, state, { removed: true })
    : kind === 'add' ? change(item, state, { label: item.label.slice(0, 160), savedAt: iso(item.savedAt) })
      : change(item, state, { notes: item.note ?? '', editedAt: iso(Date.now()) })
  state.outbox.push(next)
  writeState(state)
  publish({ pending: state.outbox.length })
  try { await syncAccountSaves({ force: true }) } catch { /* It waits in the outbox for the next focus. */ }
}

export function dismissAccountSavesToast(): void {
  publish({ toast: null })
}

/** Raised by sign-out when changes made here could not reach the account. */
export class UnsentSavesError extends Error {
  constructor(public count: number) { super('Saves have not reached the account') }
}

let started = false
/** Starts listening for changes made here; the layout calls it once. */
export function startAccountSaves(): void {
  if (started || typeof window === 'undefined') return
  started = true
  onSavedMomentChange(change => { void onChange(change) })
  addSignOutStep({
    async before(force) {
      if (!savedMomentsNow().account || force) return
      try { await syncAccountSaves({ force: true }) } catch { /* Counted below. */ }
      const unsent = readState()?.outbox.length ?? 0
      if (unsent) throw new UnsentSavesError(unsent)
    },
    after() {
      // A list that never joined the account is this browser's own, and stays.
      if (savedMomentsNow().account) {
        clearSavedMoments()
        try { window.localStorage.removeItem('sp-moments-checked-saved') } catch { /* Nothing to clear. */ }
      }
      // Viewed (viewedMoments.ts) never joins the account; it goes with this browser's other copies (V1).
      try { window.localStorage.removeItem('sp-moments-viewed') } catch { /* Nothing to clear. */ }
      writeState(null)
      lastPull = Number.NEGATIVE_INFINITY
      publish({ status: 'idle', saves: [], pending: 0, toast: null })
    },
  })
}

/**
 * The session ended without a sign-out here (another tab, or it expired).
 * With nothing waiting to be sent, this browser's copy goes, as on sign-out;
 * anything unsent stays until the same account signs in again.
 */
export function settleSignedOutSaves(): void {
  if (!savedMomentsNow().account) return
  if (readState()?.outbox.length) return
  writeState(null)
  clearSavedMoments()
  publish({ status: 'idle', saves: [], pending: 0 })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const idle: AccountSavesView = { status: 'idle', saves: [], pending: 0, toast: null }
export function useAccountSaves(): AccountSavesView {
  return useSyncExternalStore(subscribe, () => view, () => idle)
}
