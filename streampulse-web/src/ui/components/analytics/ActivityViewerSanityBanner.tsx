import type { PublicHub } from '../../../lib/publicHub'
import { activityViewersBelowLivePool, livePoolViewerSum } from '../../../lib/hubMetricHelpers'
import { peakActivityViewers } from '../../../lib/hubActivitySummary'
import { compact } from './hubFormat'

export function ActivityViewerSanityBanner({ hub }: { hub: PublicHub }) {
  if (!activityViewersBelowLivePool(hub)) return null
  const peak = peakActivityViewers(hub.activity.points, hub.activity.windowMinutes)
  const poolSum = livePoolViewerSum(hub)
  return (
    <p className="figma-global-activity__sanity-banner" role="note">
      Chart peak ({compact(peak)} viewers) is lower than the live pool sum ({compact(poolSum)}).
      Corpus viewer rollups may be sparse for this window; chat and emote lines require an active IRC
      collector.
    </p>
  )
}
