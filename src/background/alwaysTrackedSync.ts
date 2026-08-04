/**
 * Always-tracked / Protect sync policy.
 * Local absence must never imply backend deletion. Removals only come from
 * explicit user deltas (message path or storage old→new).
 */

export type WatchlistSyncPlan = {
  trackTrue: string[]
  trackFalse: string[]
}

export function classifyProtectHttpStatus(
  status: number,
  operation: ProtectSyncOperation,
): ProtectSyncState | 'removed' {
  if (operation === 'remove' && status === 404) return 'removed'
  if (status === 401 || status === 403) return 'unauthorized'
  if (operation === 'add' && status === 409) return 'cap'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  return 'failure'
}

export function classifyProtectError(error: unknown): ProtectSyncState {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/401|403|unauthorized|invalid_authorization|device_authorization_required/i.test(message)) return 'unauthorized'
  if (/409|cap_reached/i.test(message)) return 'cap'
  if (/408|425|429|5\d\d|timeout|cancelled|network|fetch/i.test(message)) return 'retry'
  return 'failure'
}

export function protectStatusMessage(
  state: ProtectSyncState | 'removed',
  operation: ProtectSyncOperation,
  status?: number,
): string | undefined {
  if (state === 'removed') return undefined
  if (state === 'unauthorized') return 'device_authorization_required'
  if (state === 'cap') return operation === 'add' ? 'protect_cap_reached' : 'protect_remove_cap_error'
  if (state === 'retry') return `protect_${operation}_retry${status ? `_${status}` : ''}`
  if (state === 'failure') return `protect_${operation}_failed${status ? `_${status}` : ''}`
  return undefined
}

/** Startup / SYNC_WATCHLIST: push local protections only; never untrack. */
export function planWatchlistStartupSync(
  localChannels: string[] | null,
  _backendChannels: string[] = [],
): WatchlistSyncPlan {
  if (localChannels == null) {
    return { trackTrue: [], trackFalse: [] }
  }
  return {
    trackTrue: [...localChannels],
    trackFalse: [],
  }
}

/** Storage change deltas from an explicit user edit of the watchlist key. */
export function planWatchlistStorageDelta(
  oldChannels: string[],
  newChannels: string[],
): WatchlistSyncPlan {
  const oldSet = new Set(oldChannels.map(item => item.toLowerCase()))
  const newSet = new Set(newChannels.map(item => item.toLowerCase()))
  const trackTrue = newChannels.filter(login => !oldSet.has(login.toLowerCase()))
  const trackFalse = oldChannels.filter(login => !newSet.has(login.toLowerCase()))
  return { trackTrue, trackFalse }
}
import type { ProtectSyncOperation, ProtectSyncState } from '../shared/messages.ts'
