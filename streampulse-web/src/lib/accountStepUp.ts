/**
 * "Confirm it's you" before Manage subscription, for accounts that sign in with
 * Twitch. Managing billing needs a sign-in from the last 10 minutes, so the
 * billing page sends the person through Continue with Twitch again. That
 * sign-in can land on a different StreamPulse account (another Twitch user was
 * chosen on Twitch's page), so the page remembers which account asked and
 * compares on return; a different account never gets the portal button.
 *
 * The record names the Twitch flow it belongs to and counts only once the
 * callback for that same flow has finished a sign-in (completeBillingStepUp).
 * A cancelled, failed or abandoned round trip never reads as "confirmed" or as
 * "a different account": the callback or the failed start clears it, and a
 * billing read that finds it unfinished drops it.
 *
 * Only a non-reversible tag of the account ID is kept, in this tab's
 * sessionStorage, for at most 10 minutes. It is a display guard, not access
 * control: the API opens the portal only for the session's own customer.
 */
const KEY = 'pulse.account.billingStepUp.v1'
export const STEP_UP_MAX_AGE_MS = 10 * 60_000
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FLOW_ID = /^[a-f0-9]{32}$/

type StepUpRecord = { tag: string; flowId: string; expiresAt: number; completed: boolean }

/** FNV-1a over the normalised ID, plus its last six hex digits (already shown as the account reference). */
function accountTag(accountId: unknown): string | null {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) return null
  const id = accountId.toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0
  return `${hash.toString(16).padStart(8, '0')}${id.replace(/-/g, '').slice(-6)}`
}

function readRecord(): StepUpRecord | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const { tag, flowId, expiresAt, completed } = value as Record<string, unknown>
    const now = Date.now()
    if (typeof tag !== 'string' || typeof flowId !== 'string' || !FLOW_ID.test(flowId) || typeof expiresAt !== 'number'
      || expiresAt <= now || expiresAt > now + STEP_UP_MAX_AGE_MS || typeof completed !== 'boolean') return null
    return { tag, flowId, expiresAt, completed }
  } catch { return null }
}

/**
 * Forgets the "Confirm it's you" record in this tab: any record, or with
 * `flowId`, only the one started for that flow.
 */
export function clearBillingStepUp(flowId?: string): void {
  if (flowId !== undefined && readRecord()?.flowId !== flowId) return
  try { sessionStorage.removeItem(KEY) } catch { /* Already gone. */ }
}

/**
 * Called once the Twitch flow has started, just before leaving for Twitch.
 * Returns false when the account or flow is unknown (nothing is saved).
 */
export function rememberBillingStepUp(accountId: unknown, flowId: unknown): boolean {
  const tag = accountTag(accountId)
  try {
    if (!tag || typeof flowId !== 'string' || !FLOW_ID.test(flowId)) { sessionStorage.removeItem(KEY); return false }
    const record: StepUpRecord = { tag, flowId, expiresAt: Date.now() + STEP_UP_MAX_AGE_MS, completed: false }
    sessionStorage.setItem(KEY, JSON.stringify(record))
    return true
  } catch { return false }
}

/**
 * The Twitch callback finished a sign-in for `flowId`. Only the record started
 * for that same flow is marked; anything else is left alone.
 */
export function completeBillingStepUp(flowId: string): void {
  const record = readRecord()
  if (!record || record.completed || record.flowId !== flowId) return
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...record, completed: true })) } catch { /* Storage denied: no confirmation shown. */ }
}

export type BillingStepUpCheck = 'none' | 'same' | 'different'

/**
 * Compares the account now signed in with the one that asked, once: the record
 * is removed whatever the answer. Unfinished, expired, malformed or unreadable
 * records are 'none'.
 */
export function takeBillingStepUp(accountId: unknown): BillingStepUpCheck {
  const record = readRecord()
  clearBillingStepUp()
  if (!record || !record.completed) return 'none'
  const current = accountTag(accountId)
  if (!current) return 'none'
  return current === record.tag ? 'same' : 'different'
}
