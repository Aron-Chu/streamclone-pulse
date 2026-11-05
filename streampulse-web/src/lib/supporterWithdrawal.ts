/** Public build-time gate. Backend intake remains separately disabled by default. */
export function supporterWithdrawalEnabled(): boolean {
  return import.meta.env.VITE_SUPPORTER_WITHDRAWAL_ENABLED === 'true'
}

export const SUPPORTER_WITHDRAWAL_PATH = '/withdraw'
const pendingKeyName = 'streampulse.withdrawal.pending-id'

/** Only an anonymous request key is retained in this tab, never form data. */
export function pendingWithdrawalKey(): string | null {
  try {
    const key = window.sessionStorage.getItem(pendingKeyName)
    return key && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ? key : null
  } catch { return null }
}

export function rememberWithdrawalKey(key: string): void {
  try { window.sessionStorage.setItem(pendingKeyName, key) } catch { /* Retry still works until this page is closed. */ }
}

export function forgetWithdrawalKey(key: string): void {
  try { if (window.sessionStorage.getItem(pendingKeyName) === key) window.sessionStorage.removeItem(pendingKeyName) } catch { /* Storage may be unavailable. */ }
}

/** Never fall back to a guessable idempotency key for a legal request. */
export function newWithdrawalKey(): string | null {
  return pendingWithdrawalKey() || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null)
}
