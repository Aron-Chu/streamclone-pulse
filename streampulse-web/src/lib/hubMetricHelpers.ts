import type { PublicHub } from './publicHub'
import { peakActivityViewers as computePeakActivityViewers } from './hubActivitySummary'

export function livePoolViewerSum(hub: PublicHub): number {
  if (hub.activity.livePoolViewerSum != null && hub.activity.livePoolViewerSum > 0) {
    return hub.activity.livePoolViewerSum
  }
  return hub.liveChannels.reduce((sum, ch) => sum + (ch.viewers ?? 0), 0)
}

export function activityViewersBelowLivePool(hub: PublicHub): boolean {
  if (hub.activity.windowMinutes <= 30 || hub.liveChannels.length < 2) return false
  const livePoolViewers = livePoolViewerSum(hub)
  const peakViewers = computePeakActivityViewers(hub.activity.points, hub.activity.windowMinutes)
  return (
    livePoolViewers > 0 &&
    peakViewers > 0 &&
    peakViewers < livePoolViewers * 0.75
  )
}

export function hubMetricLegend(hub: PublicHub): string {
  const pool = hub.poolSize > 0 ? hub.poolSize : hub.liveChannels.length
  const ircActive = hub.corpusPipeline.collectorActive
  const ircMax = hub.corpusPipeline.collectorMax
  // normalizePublicHub already prefers corpusPipeline.roster.live and falls back
  // to legacy coverage.liveChannels. Prefer coverage here: roster.live is always
  // a number after normalize (default 0), so `??` never reaches the legacy path.
  const rosterLive = hub.coverage.liveChannels
  const parts = [
    `${pool} tracked in pool`,
    ircMax > 0 ? `${ircActive}/${ircMax} IRC collectors` : null,
    rosterLive > 0 ? `${rosterLive} roster live` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}
