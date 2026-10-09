/**
 * Build-time stage for Continue with Twitch on the website (VITE_TWITCH_SIGNIN):
 *
 * - unset / anything else: `off` (stage A, today). No Twitch button, no call to
 *   /v1/account/auth/twitch/*, no callback route. The sign-in page is the
 *   invited-tester email sign-in.
 * - `1`: `tester` (stage T). Continue with Twitch on the sign-in page with the
 *   tester note, and Link Twitch in Account & devices. Public pages (Supporter,
 *   Privacy, Terms) stay exactly as in stage A.
 * - `public`: `public` (stage C). Continue with Twitch is the public account
 *   path on /supporter and billing; email moves under "Tester email sign-in".
 *
 * Turning either on needs the backend's PULSE_TWITCH_SIGNIN_ENABLED (and, for
 * `public`, PULSE_TWITCH_SIGNIN_PUBLIC), the edge relay routes (edge-freeze
 * approval) and the privacy copy first.
 */
export type TwitchSignInStage = 'off' | 'tester' | 'public'

export function twitchSignInStage(): TwitchSignInStage {
  const value = import.meta.env.VITE_TWITCH_SIGNIN
  return value === 'public' ? 'public' : value === '1' ? 'tester' : 'off'
}

/** Continue with Twitch is offered at all (tester or public stage). */
export function twitchSignInEnabled(): boolean {
  return twitchSignInStage() !== 'off'
}

/** Continue with Twitch is the public account path (stage C). */
export function twitchSignInPublic(): boolean {
  return twitchSignInStage() === 'public'
}

/**
 * Label for a plain link to /account/sign-in. Until the public stage that page
 * is the invited-tester sign-in, and the link says so.
 */
export function accountSignInLabel(): string {
  return twitchSignInPublic() ? 'Sign in' : 'Tester sign-in'
}
