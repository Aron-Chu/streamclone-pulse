export const STALE_TIME_LIVE_MS = 30_000
export const STALE_TIME_PUBLIC_MS = 60_000
export const STALE_TIME_FULL_TIMELINE = Number.POSITIVE_INFINITY

export const queryKeys = {
  health: ['health'] as const,
  publicStats: ['public', 'stats'] as const,
  publicStatus: ['public', 'status'] as const,
  pulseChannel: (login: string) => ['pulse', 'channel', login.toLowerCase()] as const,
  watchlist: (principalId: string) => ['watchlist', principalId] as const,
  bookmarks: (principalId: string) => ['bookmarks', principalId] as const,
  backfillJob: (jobId: string) => ['backfill', jobId] as const,
} as const
