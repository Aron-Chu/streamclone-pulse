import type { PulsePayload } from '../shared/messages.ts'

/** VOD pages should not hide analytics the live session already collected. */
export function shouldShowVodMissingCard(input: {
  isVodPage: boolean
  hasRecapPanel: boolean
  showingLiveAnalytics: boolean
  vodCoverageStatus?: string
}): boolean {
  if (!input.isVodPage) return false
  if (
    input.vodCoverageStatus === 'missing'
    || input.vodCoverageStatus === 'error'
    || input.vodCoverageStatus === 'syncing'
  ) {
    return true
  }
  return !input.hasRecapPanel && !input.showingLiveAnalytics
}

export function payloadHasChartAnalytics(payload: PulsePayload | null | undefined): boolean {
  if (!payload) return false
  return (payload.rollups?.length ?? 0) > 0
    || (payload.fullRollups?.length ?? 0) > 0
    || (payload.peaks?.length ?? 0) > 0
}

/** Current-broadcast VOD of a stream Pulse already collected. */
export function vodPageShowsLiveChart(payload: PulsePayload | null | undefined): boolean {
  if (!payload) return false
  if (payload.recap && !payload.isLive) return false
  return payloadHasChartAnalytics(payload)
}

