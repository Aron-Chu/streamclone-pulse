import { apiClient, type ApiClientResult } from './apiClient'

export interface PublicStats {
  chatMessagesProcessed: number
  emotesIndexed: number
  streamsTracked: number
  momentsDetected: number
  vodsAnalyzed: number
  updatedAt: string | number
}

const emptyStats: PublicStats = {
  chatMessagesProcessed: 0,
  emotesIndexed: 0,
  streamsTracked: 0,
  momentsDetected: 0,
  vodsAnalyzed: 0,
  updatedAt: Date.now(),
}

export async function fetchPublicStats(): Promise<ApiClientResult<PublicStats>> {
  try {
    return await apiClient<PublicStats>('/v1/public/stats')
  } catch {
    return { data: emptyStats, status: 0 }
  }
}