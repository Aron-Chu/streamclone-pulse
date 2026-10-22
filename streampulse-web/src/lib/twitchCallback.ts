// Twitch returns the ID token in the callback URL fragment. This module has no
// imports so it can run before anything else on the page (see
// twitchCallbackBoot.ts, the first import in main.tsx): the fragment and query
// are removed from the address bar and history before the router, page
// metadata, Sentry or product analytics can read location. The token is kept
// in memory only, for one completion attempt.

export const TWITCH_CALLBACK_PATH = '/account/twitch/callback'

export type TwitchCallback =
  | { kind: 'token'; idToken: string; state: string }
  | { kind: 'error'; error: string; state: string }
  | { kind: 'invalid' }

/** The flow ID the API issues as OAuth state: 128 bits, lowercase hex. */
export const TWITCH_STATE = /^[a-f0-9]{32}$/
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/
/** The complete/link body (flow ID, flow secret, token) must fit the API's 4 KB limit. */
export const MAX_ID_TOKEN_LENGTH = 3800
const MAX_AGE_MS = 10 * 60_000

let captured: TwitchCallback | null = null
let capturedAt = 0

function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  return values.length === 1 ? values[0]! : null
}

/**
 * Parses what Twitch put on the callback URL: `#id_token=…&state=…` on
 * success, or `?error=…&state=…` (fragment tolerated) when the person
 * declines. Anything repeated, oversized or malformed is invalid.
 */
export function parseTwitchCallback(fragment: string, query: string): TwitchCallback {
  if (fragment.length > 8192 || query.length > 2048) return { kind: 'invalid' }
  const hash = new URLSearchParams(fragment)
  const search = new URLSearchParams(query)
  const errorSource = search.has('error') ? search : hash.has('error') ? hash : null
  if (errorSource) {
    const error = single(errorSource, 'error')
    const state = single(errorSource, 'state')
    return error && /^[a-z_]{1,64}$/.test(error) && state && TWITCH_STATE.test(state)
      ? { kind: 'error', error, state }
      : { kind: 'invalid' }
  }
  const idToken = single(hash, 'id_token')
  const state = single(hash, 'state')
  if (!idToken || idToken.length > MAX_ID_TOKEN_LENGTH || !JWT.test(idToken) || !state || !TWITCH_STATE.test(state)) {
    return { kind: 'invalid' }
  }
  return { kind: 'token', idToken, state }
}

/** On the callback path, strip the URL first, then keep the parsed result in memory. */
export function captureTwitchCallback(): void {
  if (window.location.pathname.replace(/\/+$/, '') !== TWITCH_CALLBACK_PATH) return
  const fragment = window.location.hash.slice(1)
  const query = window.location.search.slice(1)
  // Strip even malformed values, before anything else can observe them.
  window.history.replaceState(null, '', TWITCH_CALLBACK_PATH)
  captured = fragment || query ? parseTwitchCallback(fragment, query) : null
  capturedAt = Date.now()
}

/** Hands the captured callback out once; a later call (or a stale page) gets null. */
export function takeTwitchCallback(): TwitchCallback | null {
  const age = Date.now() - capturedAt
  const value = age >= 0 && age < MAX_AGE_MS ? captured : null
  captured = null
  return value
}

export function resetTwitchCallbackForTests(): void {
  captured = null
  capturedAt = 0
}
