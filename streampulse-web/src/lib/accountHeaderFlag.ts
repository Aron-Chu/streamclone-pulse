/**
 * Build-time switch for the header account entry (a quiet "Sign in" link, or
 * the account menu once signed in). Off unless the build sets
 * VITE_ACCOUNT_HEADER=1 (same "1" convention as VITE_TWITCH_SIGNIN and
 * VITE_ACCOUNT_MOMENTS). While off, the public and analytics headers are
 * exactly as on master: no account entry, the menu's plain "Account" link, and
 * no /v1/account/me check from header chrome.
 *
 * Independent of the other account flags: My Moments stays reachable from the
 * account pages' footer without it.
 */
export function accountHeaderEnabled(): boolean {
  return import.meta.env.VITE_ACCOUNT_HEADER === '1'
}
