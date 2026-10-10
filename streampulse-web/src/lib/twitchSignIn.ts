import { AccountError, accountRequest } from './accountApi'
import { accountBillingReturnPath } from './accountBillingReturn'
import { refreshAccountSession, rememberTwitchIdentity, type AccountProfile } from './accountSession'
import { announceAccountSignedIn } from './accountSessionSignal'
import { clearBillingStepUp, completeBillingStepUp } from './accountStepUp'
import { TWITCH_CALLBACK_PATH, TWITCH_STATE, takeTwitchCallback } from './twitchCallback'
import { twitchProfileImageRendition } from './twitchProfileImage'

/**
 * Website half of Continue with Twitch (backend: internal/accounts/twitch_handler.go).
 *
 * 1. POST /v1/account/auth/twitch/start {purpose} answers
 *    {flowId, flowSecret, authorizeUrl, expiresAt}. A sign-in flow is bound to
 *    the __Host-pulse_login cookie the API sets on that response; a link flow is
 *    bound to the current session, which must have signed in within 10 minutes.
 * 2. The flow ID, secret, purpose and an allowlisted return path wait in this
 *    tab's sessionStorage while the browser visits Twitch. The secret never
 *    enters a URL.
 * 3. Twitch redirects to /account/twitch/callback#id_token=…&state=<flowId>.
 *    twitchCallback.ts strips the URL before anything else runs.
 * 4. The callback posts {flowId, flowSecret, idToken} to
 *    /v1/account/auth/twitch/complete (sign-in; sets the session cookie) or
 *    /v1/account/identities/twitch/link (link; needs the CSRF header).
 */

export type TwitchPurpose = 'signin' | 'link'

/** Every code the callback or start can end in; server codes keep their API names. */
export type TwitchErrorCode =
  | 'pilot_only' | 'link_required' | 'identity_in_use' | 'account_already_linked' | 'revoked'
  | 'signup_unavailable' | 'interaction_required' | 'recent_auth_required' | 'sign_in_required'
  | 'account_deleted' | 'flow_invalid_or_expired' | 'token_invalid' | 'try_later'
  | 'state_mismatch' | 'callback_invalid' | 'access_denied' | 'twitch_error' | 'storage_unavailable'
  | 'unavailable'

export type TwitchNextStep = 'twitch' | 'switch_account' | 'email' | 'settings' | 'reauth' | 'support' | 'later'

export type TwitchCompletion =
  | { status: 'signed_in' | 'linked'; purpose: TwitchPurpose; returnTo: string; profile: AccountProfile }
  | { status: 'error'; purpose: TwitchPurpose; code: TwitchErrorCode }

type PendingFlow = { flowId: string; flowSecret: string; purpose: TwitchPurpose; returnTo: string; expiresAt: number }

const FLOW_KEY = 'pulse.account.twitchFlow.v1'
const FLOW_SECRET = /^[a-f0-9]{64}$/
const MAX_FLOW_MS = 10 * 60_000
const TWITCH_AUTHORIZE = 'https://id.twitch.tv/oauth2/authorize'
export const TWITCH_DEFAULT_RETURN = '/account/settings'

const SERVER_CODES = new Set<TwitchErrorCode>([
  'pilot_only', 'link_required', 'identity_in_use', 'account_already_linked', 'revoked',
  'signup_unavailable', 'interaction_required', 'recent_auth_required', 'sign_in_required',
  'account_deleted', 'flow_invalid_or_expired', 'token_invalid', 'try_later',
])

class TwitchFlowError extends Error {
  constructor(public code: TwitchErrorCode) { super('Twitch sign-in failed') }
}

/**
 * Where a finished flow may land: account settings, or a billing continuation
 * that accountBillingReturnPath already accepts. Anything else (other origins,
 * protocol-relative or encoded paths, extra queries) is refused, so the
 * callback can never become an open redirect.
 */
export function twitchReturnPath(value: unknown): string | null {
  if (value === TWITCH_DEFAULT_RETURN) return TWITCH_DEFAULT_RETURN
  return accountBillingReturnPath(value)
}

/**
 * Accepts only Twitch's authorize endpoint carrying this flow's state, the
 * id_token response type and this site's own callback as the redirect. The API
 * picks the redirect; a mismatch means the flow could not finish here anyway.
 */
export function trustedAuthorizeUrl(value: unknown, flowId: string, origin: string = window.location.origin): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.origin + url.pathname !== TWITCH_AUTHORIZE || url.username || url.password || url.hash) return null
  const one = (key: string) => { const values = url.searchParams.getAll(key); return values.length === 1 ? values[0] : null }
  if (one('state') !== flowId || one('response_type') !== 'id_token' || one('redirect_uri') !== origin + TWITCH_CALLBACK_PATH) return null
  return url.toString()
}

/** Mirrors the API's own display checks; anything else is dropped rather than shown. */
export function twitchProfile(value: unknown): AccountProfile {
  const profile: AccountProfile = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return profile
  const { displayName, picture } = value as { displayName?: unknown; picture?: unknown }
  if (typeof displayName === 'string') {
    const name = displayName.trim()
    if (name && name.length <= 100 && !/\p{Cc}/u.test(name)) profile.displayName = name
  }
  if (typeof picture === 'string' && picture.length <= 512) {
    try {
      const url = new URL(picture)
      const host = url.hostname
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
        && (host === 'static-cdn.jtvnw.net' || host.endsWith('.jtvnw.net'))) {
        profile.avatarUrl = twitchProfileImageRendition(url.toString(), 70) ?? url.toString()
      }
    } catch { /* No avatar. */ }
  }
  return profile
}

/** Maps a thrown request error onto the codes the pages explain. */
export function twitchErrorCode(error: unknown): TwitchErrorCode {
  if (error instanceof TwitchFlowError) return error.code
  if (error instanceof AccountError) {
    if (error.code && SERVER_CODES.has(error.code as TwitchErrorCode)) return error.code as TwitchErrorCode
    if (error.status === 429) return 'try_later'
  }
  // 404 (Twitch routes not mounted), origin_not_allowed, request_unavailable,
  // timeouts and network failures all read as "not available right now".
  return 'unavailable'
}

function savePendingFlow(flow: PendingFlow): void {
  try { sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow)) }
  catch { throw new TwitchFlowError('storage_unavailable') }
}

function readPendingFlow(): PendingFlow | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(FLOW_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const { flowId, flowSecret, purpose, returnTo, expiresAt } = value as Record<string, unknown>
    const destination = twitchReturnPath(returnTo)
    if (typeof flowId !== 'string' || !TWITCH_STATE.test(flowId) || typeof flowSecret !== 'string' || !FLOW_SECRET.test(flowSecret)
      || (purpose !== 'signin' && purpose !== 'link') || !destination || typeof expiresAt !== 'number') return null
    return { flowId, flowSecret, purpose, returnTo: destination, expiresAt }
  } catch { return null }
}

function clearPendingFlow(): void {
  try { sessionStorage.removeItem(FLOW_KEY) } catch { /* Already gone. */ }
}

/**
 * Starts a flow and returns the Twitch URL to visit. `returnTo` is kept only
 * when it passes twitchReturnPath; a link flow always returns to settings.
 */
export async function startTwitchFlow(options: { purpose: TwitchPurpose; returnTo?: unknown; forceVerify?: boolean }): Promise<string> {
  return (await openTwitchFlow(options)).authorizeUrl
}

async function openTwitchFlow(options: { purpose: TwitchPurpose; returnTo?: unknown; forceVerify?: boolean }): Promise<{ authorizeUrl: string; flowId: string }> {
  const { purpose } = options
  const result = await accountRequest('/auth/twitch/start', { purpose, ...(options.forceVerify ? { forceVerify: true } : {}) })
  const { flowId, flowSecret } = result
  if (typeof flowId !== 'string' || !TWITCH_STATE.test(flowId) || typeof flowSecret !== 'string' || !FLOW_SECRET.test(flowSecret)) {
    throw new TwitchFlowError('unavailable')
  }
  const authorizeUrl = trustedAuthorizeUrl(result.authorizeUrl, flowId)
  if (!authorizeUrl) throw new TwitchFlowError('unavailable')
  const now = Date.now()
  const serverExpiry = typeof result.expiresAt === 'string' ? Date.parse(result.expiresAt) : Number.NaN
  const expiresAt = Number.isFinite(serverExpiry) && serverExpiry > now ? Math.min(serverExpiry, now + MAX_FLOW_MS) : now + MAX_FLOW_MS
  const returnTo = purpose === 'link' ? TWITCH_DEFAULT_RETURN : twitchReturnPath(options.returnTo) ?? TWITCH_DEFAULT_RETURN
  savePendingFlow({ flowId, flowSecret, purpose, returnTo, expiresAt })
  return { authorizeUrl, flowId }
}

/**
 * Starts a flow and leaves for Twitch. `beforeLeave` runs with the new flow's
 * ID once it is saved, so a page can tie its own note to this exact flow.
 */
export async function beginTwitchFlow(options: { purpose: TwitchPurpose; returnTo?: unknown; forceVerify?: boolean; beforeLeave?: (flowId: string) => void }): Promise<void> {
  const { beforeLeave, ...flowOptions } = options
  const { authorizeUrl, flowId } = await openTwitchFlow(flowOptions)
  beforeLeave?.(flowId)
  window.location.assign(authorizeUrl)
}

let completion: Promise<TwitchCompletion> | null = null

/**
 * Finishes the flow named by the captured callback. Memoised per page, so a
 * re-mounted callback route (React StrictMode, a re-render) never posts the
 * single-use token twice.
 */
export function completeTwitchCallback(): Promise<TwitchCompletion> {
  completion ??= finishTwitchCallback()
  return completion
}

async function finishTwitchCallback(): Promise<TwitchCompletion> {
  const callback = takeTwitchCallback()
  const flow = readPendingFlow()
  const purpose: TwitchPurpose = flow?.purpose ?? 'signin'
  const fail = (code: TwitchErrorCode): TwitchCompletion => ({ status: 'error', purpose, code })
  if (!callback || callback.kind === 'invalid') return fail('callback_invalid')
  // State check: the callback must name the flow this tab started. A
  // mismatch leaves that flow in place, so a stray or forged callback cannot
  // cancel a sign-in still in progress.
  if (!flow || callback.state !== flow.flowId) return fail('state_mismatch')
  clearPendingFlow()
  // A billing "Confirm it's you" note for this flow counts only if this
  // sign-in finishes; every other ending drops it.
  const failFlow = (code: TwitchErrorCode): TwitchCompletion => { clearBillingStepUp(flow.flowId); return fail(code) }
  if (callback.kind === 'error') return failFlow(callback.error === 'access_denied' ? 'access_denied' : 'twitch_error')
  if (flow.expiresAt <= Date.now()) return failFlow('flow_invalid_or_expired')
  try {
    const path = purpose === 'link' ? '/identities/twitch/link' : '/auth/twitch/complete'
    const result = await accountRequest(path, { flowId: flow.flowId, flowSecret: flow.flowSecret, idToken: callback.idToken })
    const status = purpose === 'link' ? 'linked' : 'signed_in'
    if (result.status !== status) return failFlow('unavailable')
    const profile = twitchProfile(result.profile)
    rememberTwitchIdentity({ ...profile, via: purpose === 'link' ? 'link' : 'signin' })
    if (status === 'signed_in') completeBillingStepUp(flow.flowId)
    else clearBillingStepUp(flow.flowId)
    // A tab waiting on this sign-in (an extension approval or billing) re-checks too.
    if (status === 'signed_in') announceAccountSignedIn()
    await refreshAccountSession()
    return { status, purpose, returnTo: flow.returnTo, profile }
  } catch (error) {
    const code = twitchErrorCode(error)
    // Linking an account that already has Twitch tells us it is linked.
    if (code === 'account_already_linked') rememberTwitchIdentity({ via: 'link' })
    return failFlow(code)
  }
}

export function resetTwitchSignInForTests(): void {
  completion = null
}

export type TwitchErrorCopy = { title: string; body: string; next: TwitchNextStep }

/** Plain words for every outcome, each with one next step. */
export function twitchErrorCopy(code: TwitchErrorCode, purpose: TwitchPurpose): TwitchErrorCopy {
  const link = purpose === 'link'
  switch (code) {
    case 'pilot_only':
      return { title: 'Twitch sign-in is invite-only for now', body: 'Twitch sign-in is open to invited testers right now, and this Twitch account isn’t on the list. Nothing was created or changed. Free tools work without an account.', next: link ? 'settings' : 'email' }
    case 'link_required':
      return { title: 'Link Twitch to your account first', body: 'This Twitch account isn’t linked to a StreamPulse account yet. Invited testers: use Tester email sign-in, then choose Link Twitch in Account & devices. After that, Continue with Twitch works.', next: 'email' }
    case 'identity_in_use':
      return { title: 'That Twitch account belongs to another StreamPulse account', body: 'That Twitch account already has its own StreamPulse account. We never combine accounts. Contact us if one of them has a membership.', next: 'switch_account' }
    case 'account_already_linked':
      return { title: 'Twitch is already linked', body: 'This StreamPulse account already has a Twitch account linked, so nothing was changed.', next: 'settings' }
    case 'revoked':
      return { title: 'Confirm your sign-in on Twitch', body: 'This account was signed out on purpose (for example, a device was revoked), so StreamPulse needs you to confirm on Twitch again.', next: 'twitch' }
    case 'signup_unavailable':
      return { title: 'New accounts are paused', body: 'StreamPulse isn’t creating new accounts right now. Existing accounts can still sign in. Please try again later.', next: 'later' }
    case 'interaction_required':
      return { title: 'Continue on Twitch', body: 'Choose Continue with Twitch to confirm it’s you.', next: 'twitch' }
    case 'recent_auth_required':
      return { title: 'Sign in again to link Twitch', body: 'For your security, linking Twitch needs a sign-in from the last 10 minutes. Sign out, use Tester email sign-in again, then choose Link Twitch.', next: 'reauth' }
    case 'sign_in_required':
      return { title: 'Your session has ended', body: link ? 'Use Tester email sign-in again, then choose Link Twitch in Account & devices.' : 'Sign in again to continue.', next: link ? 'reauth' : 'twitch' }
    case 'account_deleted':
      return { title: 'This account was deleted', body: 'The StreamPulse account for this sign-in no longer exists. Contact support if you think this is a mistake.', next: 'support' }
    case 'access_denied':
      return { title: 'Twitch sign-in was cancelled', body: 'StreamPulse wasn’t authorized on Twitch, so nothing was shared or changed.', next: link ? 'settings' : 'twitch' }
    case 'flow_invalid_or_expired':
    case 'state_mismatch':
    case 'callback_invalid':
    case 'token_invalid':
    case 'twitch_error':
      return { title: link ? 'Twitch linking didn’t finish' : 'This sign-in didn’t finish', body: 'A Twitch sign-in works once, for 10 minutes, in the browser tab that started it. Please start again.', next: link ? 'settings' : 'twitch' }
    case 'try_later':
      return { title: 'Too many attempts', body: 'Wait a few minutes, then try again.', next: 'later' }
    case 'storage_unavailable':
      return { title: 'This browser blocked sign-in storage', body: 'Continue with Twitch needs to keep a short-lived value in this tab. Allow site data for streampulse.stream, then try again.', next: link ? 'settings' : 'email' }
    case 'unavailable':
    default:
      return { title: link ? 'Twitch linking is unavailable' : 'Twitch sign-in is unavailable', body: 'Account services couldn’t finish this right now. Please try again in a few minutes.', next: link ? 'settings' : 'email' }
  }
}
