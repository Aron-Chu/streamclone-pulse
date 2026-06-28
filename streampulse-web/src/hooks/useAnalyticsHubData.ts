import type { WatchlistEntry } from '../lib/pulseTypes'

export interface RecentSessionRow {
  login: string
  streamId: string
  title?: string
  startedAt?: string
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

export function useAnalyticsHubData(): AnalyticsHubDataState {
  return {
    loading: false,
    error: null,
    watchlistEntries: [],
    pulseByLogin: {},
    liveRows: [],
    recentSessions: [],
    historyUnavailable: false,
    watchlistEmpty: true,
    reload: () => {},
  }
}