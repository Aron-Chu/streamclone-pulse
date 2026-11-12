// Show my Twitch follows, the way back (lib/twitchFollows.ts starts it). Twitch
// sends this tab to /account/twitch/callback with a short-lived token in the
// #fragment, or with ?error= when the viewer says no. Before the app or
// diagnostics start, this checks the sign-in against the one this tab started,
// keeps the token in this document's memory only (never markup, storage or the
// address bar) and puts the address back to the page that asked. A token the
// hub will not read is cancelled at Twitch: at once when the sign-in is not
// this tab's, or as the page goes if the hub never took it.
export const TWITCH_FOLLOWS_CALLBACK = '/account/twitch/callback'
/** The sign-in this tab started: { state, returnTo, at }. */
export const TWITCH_FOLLOWS_PENDING_KEY = 'sp.twitchFollows.pending'
/** A sign-in, and the token it brings back, count for 15 minutes. */
export const TWITCH_FOLLOWS_MAX_AGE_MS = 15 * 60_000
/** Our state values start with this, so another flow's return is left alone. */
export const TWITCH_FOLLOWS_STATE_PREFIX = 'f.'
/** The one permission the sign-in asks for, which a returned token must carry. */
export const TWITCH_FOLLOWS_SCOPE = 'user:read:follows'
const TOKEN = /^[A-Za-z0-9]{16,128}$/
const HUB = '/analytics#follows'

/**
 * The Twitch apps whose redirect URIs are registered, by the origin they send
 * viewers back to (Twitch matches the URI exactly): the site and the plain dev
 * server. Client IDs are public; anywhere else (a preview deploy, 127.0.0.1) has
 * no button. The dev server's entry stays out of production builds, which may
 * carry no localhost origin (scripts/check-backend-url.mjs).
 */
const TWITCH_APPS: Readonly<Record<string, string>> = {
  'https://streampulse.stream': 'd1n7ykujmr737b2o82mrt0kh94zj8a',
  ...(import.meta.env.DEV ? { 'http://localhost:5173': 'tu9nskvs2kptj4mrp0py80r3j8uue0' } : {}),
}
const TWITCH_ID = 'https://id.twitch.tv'
const TWITCH_API = 'https://api.twitch.tv'
/** Dev only: scripts/dev-fake-twitch.mjs stands in for both Twitch origins and takes any client ID. */
const FAKE_CLIENT_ID = 'devfaketwitchclient000000000000'

export interface TwitchFollowsSetup {
  clientId: string
  /** Where the sign-in and the cancel go (id.twitch.tv). */
  idOrigin: string
  /** Where the follows are read (api.twitch.tv). */
  apiOrigin: string
  redirectUri: string
}

/** The setup for a page on `origin`; `fake` is the dev stand-in's origin, if any. */
export function resolveTwitchFollowsSetup(origin: string, fake: string | null): TwitchFollowsSetup | null {
  const redirectUri = origin + TWITCH_FOLLOWS_CALLBACK
  if (fake) return { clientId: FAKE_CLIENT_ID, idOrigin: fake, apiOrigin: fake, redirectUri }
  const clientId = Object.prototype.hasOwnProperty.call(TWITCH_APPS, origin) ? TWITCH_APPS[origin] : undefined
  return clientId ? { clientId, idOrigin: TWITCH_ID, apiOrigin: TWITCH_API, redirectUri } : null
}

/** Dev only: VITE_DEV_FAKE_TWITCH, an http origin on this machine. */
function devFakeTwitch(): string | null {
  const raw = import.meta.env.VITE_DEV_FAKE_TWITCH?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') ? url.origin : null
  } catch {
    return null
  }
}

export function twitchFollowsSetup(): TwitchFollowsSetup | null {
  if (typeof window === 'undefined') return null
  return resolveTwitchFollowsSetup(window.location.origin, import.meta.env.DEV ? devFakeTwitch() : null)
}

/** Twitch's cancel, best effort: the token is dropped either way. */
export function revokeTwitchToken(token: string): void {
  const setup = twitchFollowsSetup()
  if (!setup) return
  try {
    void fetch(`${setup.idOrigin}/oauth2/revoke`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: setup.clientId, token }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // nothing else to do
  }
}

/** The token goes to the hub, which reads with it and then cancels it; a failure carries none. */
export type TwitchFollowsReturn =
  | { token: string }
  | { failed: 'denied' | 'unfinished' | 'rejected' }
type Pending = { state?: unknown; returnTo?: unknown; at?: unknown }

let result: TwitchFollowsReturn | null = null
let capturedAt = 0

/** A path on this site; anything else goes back to the hub. */
function safePath(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : HUB
}

/** The page goes, or the token waited too long, before the hub took it: Twitch cancels it, and the sign-in did not finish. */
function cancelUntaken(): void {
  if (!result || !('token' in result)) return
  const { token } = result
  result = { failed: 'unfinished' }
  revokeTwitchToken(token)
}

export function captureTwitchFollowsCallback(): void {
  if (window.location.pathname.replace(/\/+$/, '') !== TWITCH_FOLLOWS_CALLBACK) return
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  const token = fragment.get('access_token')
  const error = query.get('error') ?? fragment.get('error')
  const state = fragment.get('state') ?? query.get('state') ?? ''
  // A server sign-in answers in the query with a code: its own page reads it.
  if (token == null && !(error != null && state.startsWith(TWITCH_FOLLOWS_STATE_PREFIX))) return
  let pending: Pending | null = null
  try {
    pending = JSON.parse(window.sessionStorage.getItem(TWITCH_FOLLOWS_PENDING_KEY) ?? 'null') as Pending | null
    window.sessionStorage.removeItem(TWITCH_FOLLOWS_PENDING_KEY)
  } catch {
    pending = null
  }
  const age = typeof pending?.at === 'number' ? Date.now() - pending.at : NaN
  const ours = typeof pending?.state === 'string' && pending.state === state && age >= 0 && age < TWITCH_FOLLOWS_MAX_AGE_MS
  // The token and the error leave the address before anything else can read it.
  window.history.replaceState(null, '', ours ? safePath(pending!.returnTo) : HUB)
  capturedAt = Date.now()
  const scope = fragment.get('scope')
  const valid = token != null && TOKEN.test(token) ? token : null
  let back: TwitchFollowsReturn
  if (!ours) back = { failed: 'unfinished' }
  else if (error != null) back = { failed: error === 'access_denied' ? 'denied' : 'rejected' }
  else if (!valid || (scope != null && !scope.split(' ').includes(TWITCH_FOLLOWS_SCOPE))) back = { failed: 'rejected' }
  else back = { token: valid }
  result = back
  // Closed, or reloaded before the hub loaded: the hub never reads this token.
  if ('token' in back) window.addEventListener('pagehide', cancelUntaken)
  // One Twitch sent all the same (another sign-in's, or without the follows permission) is never read.
  else if (valid) revokeTwitchToken(valid)
}

/** What this document brought back, once: the first reader takes it. A token left 15 minutes is cancelled instead. */
export function takeTwitchFollowsReturn(): TwitchFollowsReturn | null {
  const fresh = Date.now() - capturedAt < TWITCH_FOLLOWS_MAX_AGE_MS
  if (!fresh) cancelUntaken()
  const taken = fresh ? result : null
  result = null
  return taken
}
