/**
 * Show my Twitch follows (11-01; Aron: "load their followed streamer using
 * twitch sign on ... so it doesn't need a storage or persistence"). Browser
 * only: Twitch asks the viewer and hands this tab a token
 * (twitchFollowsCallback.ts, which cancels a token the hub never reads), the
 * tab reads the account's follows straight from Twitch, then asks Twitch to
 * cancel the token (as the tab leaves, when a read is cut short). Only the
 * followed logins are kept, in this tab's sessionStorage, so a reload keeps
 * them and Forget drops them (closing the tab does too, unless the browser
 * reopens it). Nothing goes to StreamPulse.
 */
import { useSyncExternalStore } from 'react'
import {
  TWITCH_FOLLOWS_PENDING_KEY,
  TWITCH_FOLLOWS_SCOPE,
  TWITCH_FOLLOWS_STATE_PREFIX,
  revokeTwitchToken,
  takeTwitchFollowsReturn,
  twitchFollowsSetup,
  type TwitchFollowsSetup,
} from './twitchFollowsCallback'

const SAVED_KEY = 'sp.twitchFollows.v1'
/** Twitch sends 100 follows a page; 30 pages read up to 3,000. */
const PAGE = 100
const MAX_PAGES = 30
const READ_TIMEOUT_MS = 12_000
/** A trip to Twitch that never left this page (Stop, or Esc before Twitch answered) gives the button back. */
const OPENING_MS = 8_000
const LOGIN = /^[a-z0-9_]{1,25}$/

export function twitchAuthorizeUrl(setup: TwitchFollowsSetup, state: string): string {
  const query = new URLSearchParams({
    response_type: 'token',
    client_id: setup.clientId,
    redirect_uri: setup.redirectUri,
    scope: TWITCH_FOLLOWS_SCOPE,
    state,
  })
  return `${setup.idOrigin}/oauth2/authorize?${query}`
}

/* ---------- the list this tab keeps ---------- */

export interface TwitchFollows {
  /** The Twitch account the list belongs to. */
  login: string
  name: string
  /** The followed channels' logins, lowercase. */
  logins: string[]
  /** Twitch's count: more than `logins` when the read stopped at 3,000. */
  total: number
  /** Epoch ms of the read. */
  at: number
}

function asFollows(value: unknown): TwitchFollows | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.login !== 'string' || !LOGIN.test(v.login) || typeof v.name !== 'string') return null
  if (!Array.isArray(v.logins) || !v.logins.every((l) => typeof l === 'string' && LOGIN.test(l))) return null
  if (typeof v.total !== 'number' || !Number.isFinite(v.total) || v.total < 0) return null
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null
  return { login: v.login, name: v.name, logins: v.logins as string[], total: v.total, at: v.at }
}

function loadSaved(): TwitchFollows | null {
  try {
    const raw = window.sessionStorage.getItem(SAVED_KEY)
    if (raw == null) return null
    const follows = asFollows(JSON.parse(raw))
    if (!follows) window.sessionStorage.removeItem(SAVED_KEY)
    return follows
  } catch {
    return null
  }
}

function save(follows: TwitchFollows): void {
  try {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(follows))
  } catch {
    // the list still shows; a reload asks Twitch again
  }
}

/* ---------- reading from Twitch ---------- */

/** Why the list is not on screen: the viewer said no, the sign-in did not finish in this tab, Twitch refused it, Twitch did not answer, or this tab cannot keep the sign-in's state. */
export type TwitchFollowsFailure = 'denied' | 'unfinished' | 'rejected' | 'unreachable' | 'storage'

class ReadFailed extends Error {
  constructor(readonly why: TwitchFollowsFailure) {
    super(why)
  }
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  if (typeof AbortController === 'undefined') return undefined
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

async function helix(setup: TwitchFollowsSetup, token: string, path: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(setup.apiOrigin + path, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': setup.clientId },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: timeoutSignal(READ_TIMEOUT_MS),
    })
  } catch {
    throw new ReadFailed('unreachable')
  }
  if (!response.ok) throw new ReadFailed(response.status === 429 || response.status >= 500 ? 'unreachable' : 'rejected')
  try {
    return await response.json()
  } catch {
    throw new ReadFailed('unreachable')
  }
}

/** The token's account, then its follows, a page at a time. */
async function readFollows(setup: TwitchFollowsSetup, token: string, progress: (read: number, total: number | null) => void): Promise<TwitchFollows> {
  const users = await helix(setup, token, '/helix/users') as { data?: Array<{ id?: unknown; login?: unknown; display_name?: unknown }> }
  const user = users?.data?.[0]
  if (!user || typeof user.id !== 'string' || typeof user.login !== 'string' || !LOGIN.test(user.login.toLowerCase())) throw new ReadFailed('rejected')
  const logins = new Set<string>()
  let total: number | null = null
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ user_id: user.id, first: String(PAGE) })
    if (after) query.set('after', after)
    const body = await helix(setup, token, `/helix/channels/followed?${query}`) as {
      total?: unknown
      data?: Array<{ broadcaster_login?: unknown }>
      pagination?: { cursor?: unknown }
    }
    if (!body || !Array.isArray(body.data)) throw new ReadFailed('unreachable')
    if (typeof body.total === 'number' && Number.isFinite(body.total)) total = body.total
    for (const follow of body.data) {
      const login = typeof follow?.broadcaster_login === 'string' ? follow.broadcaster_login.toLowerCase() : ''
      if (LOGIN.test(login)) logins.add(login)
    }
    progress(logins.size, total)
    after = typeof body.pagination?.cursor === 'string' && body.pagination.cursor ? body.pagination.cursor : undefined
    if (!after || body.data.length === 0) break
  }
  const name = typeof user.display_name === 'string' && user.display_name.trim() ? user.display_name.trim() : user.login
  return { login: user.login.toLowerCase(), name, logins: [...logins], total: Math.max(total ?? 0, logins.size), at: Date.now() }
}

/* ---------- the store the hub reads ---------- */

export type TwitchFollowsState =
  | { status: 'off' }
  | { status: 'idle' }
  | { status: 'opening' }
  | { status: 'reading'; read: number; total: number | null }
  | { status: 'ready'; follows: TwitchFollows }
  | { status: 'failed'; why: TwitchFollowsFailure }

const OFF: TwitchFollowsState = Object.freeze({ status: 'off' })
const IDLE: TwitchFollowsState = Object.freeze({ status: 'idle' })
const OPENING: TwitchFollowsState = Object.freeze({ status: 'opening' })

let state: TwitchFollowsState | null = null
/** The token Twitch brought back, held until a reader subscribes and starts the read. */
let heldToken: string | null = null
/** That token until Twitch is asked to cancel it: when the read ends, or when the tab leaves first. */
let liveToken: string | null = null
let watchingPage = false
const listeners = new Set<() => void>()

function emit(next: TwitchFollowsState): void {
  state = next
  for (const listener of listeners) listener()
}

function cancelToken(): void {
  const token = liveToken
  liveToken = null
  if (token) revokeTwitchToken(token)
}

/** The list this tab keeps, if any, else the button. */
function shown(): TwitchFollowsState {
  const saved = loadSaved()
  return saved ? { status: 'ready', follows: saved } : IDLE
}

function watchPage(): void {
  if (watchingPage || typeof window === 'undefined') return
  watchingPage = true
  // Back through the back/forward cache: a page left for Twitch never left "Opening Twitch", and a later page in
  // this tab may have read the list (Back twice after a read) or forgotten it.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || (state?.status !== 'opening' && state?.status !== 'idle' && state?.status !== 'ready')) return
    emit(shown())
  })
  // Closed, reloaded or left mid-read: the read will not finish, so Twitch cancels its token now.
  window.addEventListener('pagehide', cancelToken)
}

function snapshot(): TwitchFollowsState {
  if (state) return state
  if (!twitchFollowsSetup()) return (state = OFF)
  const back = takeTwitchFollowsReturn()
  if (back && 'failed' in back) {
    // Back past a finished read goes through Twitch, which signs the viewer in again: the list stays up.
    const saved = back.failed === 'unfinished' ? loadSaved() : null
    return (state = saved ? { status: 'ready', follows: saved } : { status: 'failed', why: back.failed })
  }
  if (back) {
    heldToken = liveToken = back.token
    watchPage()
    return (state = { status: 'reading', read: 0, total: null })
  }
  const saved = loadSaved()
  return (state = saved ? { status: 'ready', follows: saved } : IDLE)
}

async function read(token: string): Promise<void> {
  const setup = twitchFollowsSetup()
  if (!setup) return emit(OFF)
  try {
    const follows = await readFollows(setup, token, (read, total) => emit({ status: 'reading', read, total }))
    save(follows)
    emit({ status: 'ready', follows })
  } catch (error) {
    // Twitch refusing a token this tab cancelled (left mid-read, then back from the back/forward cache)
    emit({ status: 'failed', why: liveToken !== token ? 'unfinished' : error instanceof ReadFailed ? error.why : 'unreachable' })
  } finally {
    if (liveToken === token) cancelToken()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  snapshot()
  if (heldToken) {
    const token = heldToken
    heldToken = null
    void read(token)
  }
  watchPage()
  return () => {
    listeners.delete(listener)
  }
}

export function useTwitchFollows(): TwitchFollowsState {
  return useSyncExternalStore(subscribe, snapshot, () => OFF)
}

function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return TWITCH_FOLLOWS_STATE_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** "Show my Twitch follows": off to Twitch, back to this page's #follows. */
export function connectTwitchFollows(): void {
  const setup = twitchFollowsSetup()
  const now = snapshot()
  if (!setup || now.status === 'opening' || now.status === 'reading') return
  const sign = randomState()
  const returnTo = `${window.location.pathname}${window.location.search}#follows`
  try {
    window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: sign, returnTo, at: Date.now() }))
  } catch {
    emit({ status: 'failed', why: 'storage' })
    return
  }
  emit(OPENING)
  window.setTimeout(() => {
    if (state === OPENING) emit(shown())
  }, OPENING_MS)
  window.location.assign(twitchAuthorizeUrl(setup, sign))
}

/** Forget: the list leaves this tab. */
export function forgetTwitchFollows(): void {
  try {
    window.sessionStorage.removeItem(SAVED_KEY)
  } catch {
    // nothing kept to drop
  }
  emit(twitchFollowsSetup() ? IDLE : OFF)
}

/** Close a failure: back to the list this tab keeps, if any, else the button. */
export function dismissTwitchFollowsFailure(): void {
  emit(shown())
}

/** Tests only. */
export function resetTwitchFollowsForTests(): void {
  state = null
  heldToken = null
  liveToken = null
  listeners.clear()
}
