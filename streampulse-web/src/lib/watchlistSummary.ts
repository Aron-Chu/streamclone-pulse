import { apiClient } from './apiClient'

export interface WatchlistSummaryLiveNow {
  login: string
  displayName?: string
  avatarUrl?: string
  category?: string
  viewerCount?: number | null
  heatTier?: string
}

export interface WatchlistSummaryRecap {
  streamId: string
  login: string
  title?: string
  endedAt?: string
  durationSeconds?: number | null
  status?: string
}

export interface WatchlistSummary {
  liveCount: number
  recapReadyCount: number
  attentionCount: number
  protectedCount: number
  liveNow: WatchlistSummaryLiveNow[]
  recaps: WatchlistSummaryRecap[]
}

export async function fetchWatchlistSummary(): Promise<WatchlistSummary | null> {
  try {
    const { data } = await apiClient<WatchlistSummary>('/v1/pulse/watchlist/summary', {
      gated: true,
    })
    return data
  } catch {
    return null
  }
}
