import { useHubRecentLogins } from './useHubRecentLogins'
import type { WatchlistEntry } from '../lib/pulseTypes'

export interface RecentSessionRow {
  login: string
  streamId: string
  title?: string
  startedAt?: string
  profileImageUrl?: string
  syncBadge: 'Full pulse' | 'Chat synced' | 'Stats only' | 'No pulse' | 'Partial pulse'
}

export interface AnalyticsHubDataState {
  loading: boolean
  error: string | null
  watchlistEntries: WatchlistEntry[]
  pulseByLogin: Record<string, unknown>
  liveRows: []
  recentSessions: RecentSessionRow[]
  historyUnavailable: boolean
  watchlistEmpty: boolean
  reload: () => void
}

/** Watchlist-backed hub data remains future work; recent channels come from localStorage. */
export function useAnalyticsHubData(): AnalyticsHubDataState {
  const recentLogins = useHubRecentLogins()
  const recentSessions: RecentSessionRow[] = recentLogins.map((entry) => ({
    login: entry.login,
    streamId: '',
    title: entry.login,
    startedAt: entry.openedAt,
    syncBadge: 'Stats only',
  }))

  return {
    loading: false,
    error: null,
    watchlistEntries: [],
    pulseByLogin: {},
    liveRows: [],
    recentSessions,
    historyUnavailable: false,
    watchlistEmpty: true,
    reload: () => {},
  }
}
