import { AccountError } from './accountApi'
import { currentAccountTag } from './accountSession'

/**
 * Sensitive account actions need a sign-in from the last 10 minutes (the
 * API's RecentAuthentication): delete, export, sign out everywhere, watched
 * history settings and forget, and the billing portal. The API refuses them
 * with 403 {"error":"recent_auth_required"} (streampulse-backend
 * internal/accounts: self_service.go, stepup.go). The page then offers
 * Sign in again, and this tab remembers which action to reopen when the
 * person comes back to the same page, signed in to the same account.
 *
 * Nothing secret is kept: the action's name, the page, a time, and the same
 * account digest the saves copy uses (never the account ID).
 */
export const RECENT_SIGN_IN_CODE = 'recent_auth_required'

export function needsRecentSignIn(error: unknown): boolean {
  return error instanceof AccountError && error.status === 403 && error.code === RECENT_SIGN_IN_CODE
}

export type StepUpAction = 'delete' | 'export' | 'sign-out-everywhere' | 'history-settings' | 'history-forget'
const ACTIONS: ReadonlySet<string> = new Set<StepUpAction>(['delete', 'export', 'sign-out-everywhere', 'history-settings', 'history-forget'])
const KEY = 'pulse.account.stepUp.v1'
/** A Twitch sign-in flow lasts 10 minutes; the way back gets a little longer. */
export const STEP_UP_RESUME_MS = 15 * 60_000

export function rememberStepUp(action: StepUpAction, path: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ action, path, account: currentAccountTag(), at: Date.now() })) }
  catch { /* The action is simply not reopened. */ }
}

export function forgetStepUp(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* Nothing to forget. */ }
}

/**
 * The action to reopen on `path`, read once. It is dropped when it is old,
 * malformed, or another account is signed in now; another page leaves it.
 */
export function takeStepUp(path: string): StepUpAction | null {
  let value: unknown
  try { value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') } catch { forgetStepUp(); return null }
  if (!value || typeof value !== 'object') return null
  const { action, path: saved, account, at } = value as Record<string, unknown>
  if (saved !== path) return null
  forgetStepUp()
  const age = typeof at === 'number' ? Date.now() - at : Number.NaN
  if (typeof action !== 'string' || !ACTIONS.has(action) || !(age >= 0 && age < STEP_UP_RESUME_MS)) return null
  const now = currentAccountTag()
  if (account !== null && now !== null && account !== now) return null
  return action as StepUpAction
}
