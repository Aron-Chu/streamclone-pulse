/**
 * Always-tracked / Protect sync policy.
 * Local absence must never imply backend deletion. Removals only come from
 * explicit user deltas (message path or storage old→new).
 */

export type WatchlistSyncPlan = {
  trackTrue: string[]
  trackFalse: string[]
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
