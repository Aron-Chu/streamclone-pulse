/**
 * Build-time switch for Sign in with Twitch on the website. Off unless the
 * build sets VITE_TWITCH_SIGNIN=1 (same "1" convention as
 * VITE_ALLOW_LOCAL_BACKEND). While off, the sign-in page, account settings,
 * header and routes are exactly as before.
 *
 * Turning it on needs the backend's PULSE_TWITCH_SIGNIN_ENABLED, the edge
 * relay routes (edge-freeze approval) and the privacy copy first.
 */
export function twitchSignInEnabled(): boolean {
  return import.meta.env.VITE_TWITCH_SIGNIN === '1'
}
