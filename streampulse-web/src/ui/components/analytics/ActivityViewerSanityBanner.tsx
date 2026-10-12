import type { PublicHub } from '../../../lib/publicHub'
import { livePoolViewerSum } from '../../../lib/hubMetricHelpers'
import { peakActivityViewers } from '../../../lib/hubActivitySummary'
import { compact } from './hubFormat'

export function ActivityViewerSanityBanner({
  hub,
  /** Peak from the exact normalized series rendered by HubActivityChart. */
  chartPeakViewers,
  /** Served chart window, rather than the requested window label. */
  chartWindowMinutes,
}: {
  hub: PublicHub
  chartPeakViewers?: number
  chartWindowMinutes?: number
}) {
  const peak = chartPeakViewers ?? peakActivityViewers(hub.activity.points, chartWindowMinutes ?? hub.activity.windowMinutes)
  const poolSum = livePoolViewerSum(hub)
  // Keep this warning for long-window requests even when degraded data is
  // honestly narrowed to a recent served window. The warning explains the
  // relationship between the timeline peak and the live-pool KPI; it must use
  // the same peak the chart and headline use.
  if (hub.activity.windowMinutes <= 30 || hub.liveChannels.length < 2) return null
  if (poolSum <= 0 || peak <= 0 || peak >= poolSum * 0.75) return null
  return (
    <p className="figma-global-activity__sanity-banner" role="note">
      The chart's peak ({compact(peak)} sampled viewers) is below Watching now ({compact(poolSum)}) because
      they count different channels: the chart samples a configured roster, Watching now adds up every
      live tracked channel in this snapshot. Neither is a share of the other.
    </p>
  )
}
