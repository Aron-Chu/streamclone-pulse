import { useSyncExternalStore } from 'react'
import { AccountError, accountRequest } from './accountApi'
import { onAccountSessionSignal } from './accountSessionSignal'

/**
 * Page-lifetime answer to "is this browser signed in to a website account?"
 * for header chrome. It is a hint, not access control: the API still decides
 * every account request.
 *
 * The session cookie is HttpOnly. The CSRF cookie the API sets beside it is
 * readable, and the two are set, expire and clear together, so a visitor
 * without it is signed out and never sends a request. A visitor with it asks
 * /v1/account/me once per page, again on focus at most once a minute. Any
 * failure reads as signed out, quietly: nothing is logged or reported, and the
 * account ID in the response is never kept.
 *
 * /me does not say how the person signed in, and the API never stores a Twitch
 * display name or avatar. When a Twitch sign-in or link answers with them, this
 * tab keeps them for display only (sessionStorage), tied to the session they
 * arrived with, and drops them on sign-out or when the session changes.
 */

/** What the header can show about the person. Email sign-in provides neither;
 * a Twitch sign-in can fill both without changing the header. */
export type AccountProfile = {
  displayName?: string
  avatarUrl?: string
  /** From /me: the account can sign in with Twitch, even if this tab never saw it happen. */
  twitchLinked?: boolean
}
export type AccountSession =
  | { status: 'checking' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; profile: AccountProfile }

export const ACCOUNT_SESSION_REFRESH_MS = 60_000

const CHECKING: AccountSession = { status: 'checking' }
const SIGNED_OUT: AccountSession = { status: 'signed_out' }
const SIGNED_IN: AccountSession = { status: 'signed_in', profile: {} }

const TWITCH_IDENTITY_KEY = 'pulse.account.twitch.v1'
const CSRF_COOKIE = /^__Host-pulse_csrf=([a-f0-9]{64})$/

let snapshot: AccountSession | null = null
let generation = 0
let pending: Promise<void> | null = null
let lastRequestAt = Number.NEGATIVE_INFINITY
const listeners = new Set<() => void>()

function csrfCookie(): string | null {
  try {
    for (const part of document.cookie.split(';')) {
      const match = CSRF_COOKIE.exec(part.trim())
      if (match) return match[1]!
    }
  } catch { /* An unreadable cookie jar reads as signed out. */ }
  return null
}

/** True when the readable CSRF cookie suggests a session; reads nothing else. */
export function hasAccountSessionHint(): boolean {
  return csrfCookie() !== null
}

/**
 * Names the current session without storing its CSRF value: a 32-bit FNV-1a
 * digest. It only detects that cached display data belongs to another session;
 * it is not a security check (the API decides every request).
 */
function sessionTag(): string | null {
  const csrf = csrfCookie()
  if (!csrf) return null
  let hash = 0x811c9dc5
  for (let i = 0; i < csrf.length; i++) hash = Math.imul(hash ^ csrf.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

function displayProfile(value: unknown): AccountProfile {
  const profile: AccountProfile = {}
  if (!value || typeof value !== 'object') return profile
  const { displayName, avatarUrl } = value as { displayName?: unknown; avatarUrl?: unknown }
  if (typeof displayName === 'string' && displayName.length <= 100) profile.displayName = displayName
  if (typeof avatarUrl === 'string' && avatarUrl.length <= 512 && avatarUrl.startsWith('https://')) profile.avatarUrl = avatarUrl
  return profile
}

/** Records that this session signed in with, or linked, Twitch; name and avatar are optional. */
export function rememberTwitchIdentity(profile: AccountProfile): void {
  const session = sessionTag()
  try {
    if (session) sessionStorage.setItem(TWITCH_IDENTITY_KEY, JSON.stringify({ session, ...displayProfile(profile) }))
    else sessionStorage.removeItem(TWITCH_IDENTITY_KEY)
  } catch { /* Display only: the header falls back to "Account". */ }
}

/** The Twitch identity this tab saw for the current session, or null when unknown. */
export function knownTwitchIdentity(): AccountProfile | null {
  try {
    const raw = sessionStorage.getItem(TWITCH_IDENTITY_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    const session = sessionTag()
    if (session && value && typeof value === 'object' && (value as { session?: unknown }).session === session) return displayProfile(value)
    sessionStorage.removeItem(TWITCH_IDENTITY_KEY)
  } catch { /* Missing, malformed or blocked storage is simply unknown. */ }
  return null
}

function forgetTwitchIdentity(): void {
  try { sessionStorage.removeItem(TWITCH_IDENTITY_KEY) } catch { /* Nothing to forget. */ }
}

/** Keeps the snapshot identity stable while the profile is unchanged, so subscribers do not re-render. */
function signedIn(profile: AccountProfile): AccountSession {
  if (!profile.displayName && !profile.avatarUrl && !profile.twitchLinked) return SIGNED_IN
  if (snapshot?.status === 'signed_in' && snapshot.profile.displayName === profile.displayName
    && snapshot.profile.avatarUrl === profile.avatarUrl && snapshot.profile.twitchLinked === profile.twitchLinked) return snapshot
  return { status: 'signed_in', profile }
}

function publish(next: AccountSession) {
  if (snapshot === next) return
  snapshot = next
  listeners.forEach(listener => listener())
}

function settleSignedOut() {
  generation++
  pending = null
  forgetTwitchIdentity()
  publish(SIGNED_OUT)
}

/** A newer request or sign-out supersedes any answer still in flight. */
function request(): Promise<void> {
  const turn = ++generation
  lastRequestAt = Date.now()
  const result = accountRequest('/me').then(
    me => (typeof me.accountId === 'string'
      ? signedIn({
        ...(knownTwitchIdentity() ?? {}),
        ...(Array.isArray(me.signInMethods) && me.signInMethods.includes('twitch') ? { twitchLinked: true } : {}),
      })
      : SIGNED_OUT),
    () => SIGNED_OUT,
  ).then(next => {
    if (turn !== generation) return
    pending = null
    publish(next)
  })
  pending = result
  return result
}

function onReturn() {
  if (document.visibilityState === 'hidden') return
  // Cookies clear on sign-out in another tab; that needs no request to notice.
  if (!hasAccountSessionHint()) { if (snapshot?.status !== 'signed_out') settleSignedOut(); return }
  if (pending || Date.now() - lastRequestAt < ACCOUNT_SESSION_REFRESH_MS) return
  void request()
}

function getSnapshot(): AccountSession {
  if (snapshot === null) snapshot = hasAccountSessionHint() ? CHECKING : SIGNED_OUT
  return snapshot
}

let stopSignals: (() => void) | null = null
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    // Another tab signed in or out: re-check now rather than on the next focus.
    stopSignals = onAccountSessionSignal(() => { void refreshAccountSession() })
  }
  listeners.add(listener)
  if (getSnapshot() === CHECKING && !pending) void request()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    window.removeEventListener('focus', onReturn)
    document.removeEventListener('visibilitychange', onReturn)
    stopSignals?.()
    stopSignals = null
  }
}

// Prerendered public pages show the signed-out entry, which is what nearly
// every first visit resolves to, so the common case never shifts the header.
const serverSnapshot = () => SIGNED_OUT

export function useAccountSession(): AccountSession {
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
}

/** Re-check now, ignoring the focus throttle (for example after confirming a sign-in). */
export function refreshAccountSession(): Promise<void> {
  if (!hasAccountSessionHint()) { settleSignedOut(); return Promise.resolve() }
  return request()
}

/** Ends the website session. A session the API no longer recognises is already over. */
export async function signOutAccount(): Promise<void> {
  try { await accountRequest('/auth/logout', {}) }
  catch (error) { if (!(error instanceof AccountError && error.status === 401)) throw error }
  settleSignedOut()
}

/** Account pages hold loaded account data; a full navigation drops it, as Account settings does. */
export function leaveAccountPagesAfterSignOut(): void {
  window.location.assign('/account/sign-in')
}

export function resetAccountSessionForTests(): void {
  generation++
  snapshot = null
  pending = null
  lastRequestAt = Number.NEGATIVE_INFINITY
}
