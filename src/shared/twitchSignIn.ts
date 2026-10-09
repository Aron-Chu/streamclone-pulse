import type { SupporterAccountState } from './supporterAccount.ts'

/**
 * Sign in with Twitch build stage, fixed at build time from
 * PULSE_EXTENSION_TWITCH_SIGNIN (see scripts/extension-target.mjs):
 *
 *   - `off` (the default and every store build today): the options page says
 *     Supporter sign-ups are not open yet and keeps the invited-tester device
 *     link behind a closed disclosure. The worker answers TWITCH_SIGN_IN
 *     without network I/O.
 *   - `tester`: development and preview builds for invited testers while the
 *     backend runs Twitch sign-in in pilot mode. Store builds refuse it.
 *   - `public`: Continue with Twitch for everyone. A store build accepts it
 *     only once that store's manifest requests `identity`; that release also
 *     updates the permission allowlist and the store permission docs, and
 *     tests/manifestPermissions.test.ts fails until all of them move together.
 */
export type TwitchSignInStage = 'off' | 'tester' | 'public'

export function parseTwitchSignInStage(value: unknown): TwitchSignInStage {
  return value === 'tester' || value === 'public' ? value : 'off'
}

export const TWITCH_SIGNIN_STAGE: TwitchSignInStage = parseTwitchSignInStage(
  typeof __TWITCH_SIGNIN_STAGE__ !== 'undefined' ? __TWITCH_SIGNIN_STAGE__ : 'off',
)

/** Client kill switch: Twitch sign-in code runs only in the tester and public stages. */
export const TWITCH_SIGNIN_ENABLED = TWITCH_SIGNIN_STAGE !== 'off'

/** `silent` never opens a window and never creates an account. */
export type TwitchSignInMode = 'interactive' | 'silent'

/** Store surface the server keys its fixed redirect list by. */
export type TwitchSurface = 'chrome' | 'edge' | 'firefox'

/**
 * Display only: re-read at each sign-in, kept for the browser session at most,
 * never sent anywhere.
 */
export interface TwitchProfile {
  displayName: string
  picture?: string
}

/** Every way a sign-in or step-up attempt can end. Each maps to plain UI copy. */
export type TwitchSignInOutcome =
  | 'signed_in'
  | 'already_signed_in'
  /** Silent could not finish without a click; offer the button. */
  | 'interaction_required'
  /** The server ended this identity's sessions; only a click signs in again. */
  | 'revoked'
  | 'cancelled'
  | 'state_mismatch'
  | 'token_invalid'
  | 'flow_expired'
  | 'pilot_only'
  | 'link_required'
  | 'identity_in_use'
  | 'account_deleted'
  | 'signup_unavailable'
  | 'try_later'
  | 'surface_unavailable'
  | 'redirect_mismatch'
  | 'auth_window_failed'
  | 'network'
  | 'unavailable'
  | 'hosted_only'
  | 'revocation_pending'
  | 'busy'
  | 'disabled'
  | 'unsupported'
  | 'error'

export type TwitchStepUpError =
  | Exclude<TwitchSignInOutcome, 'signed_in' | 'already_signed_in' | 'revoked' | 'pilot_only' | 'link_required' | 'identity_in_use' | 'signup_unavailable' | 'revocation_pending'>
  /** The device bearer is gone; the user must sign in again. */
  | 'sign_in_required'
  /** The Twitch account in the window is not this account's identity. */
  | 'identity_mismatch'

export type TwitchStepUpResult =
  | { ok: true; expiresAt: string }
  | { ok: false; error: TwitchStepUpError; retryAfterSeconds?: number }

/** Safe projection for the options card. No flow secret, token or credential. */
export interface TwitchSignInStatus {
  /** Build flag. */
  enabled: boolean
  /** The browser exposes identity.launchWebAuthFlow (absent on Firefox for Android). */
  available: boolean
  /** True only on a first install that has not tried silent sign-in yet. */
  silentEligible: boolean
  profile: TwitchProfile | null
}

export type TwitchSignInRequest =
  | { type: 'TWITCH_SIGN_IN'; action: 'status' }
  | { type: 'TWITCH_SIGN_IN'; action: 'sign_in'; mode: TwitchSignInMode; forceVerify?: true }

export interface TwitchSignInResponse {
  type: 'TWITCH_SIGN_IN'
  status: TwitchSignInStatus
  account: SupporterAccountState
  outcome?: TwitchSignInOutcome
  retryAfterSeconds?: number
}
