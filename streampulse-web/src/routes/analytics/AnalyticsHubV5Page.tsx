import AnalyticsLandingPage from './AnalyticsLandingPage'
import { HubActivityPanelV5 } from '../../ui/components/analytics/HubActivityPanelV5'

/**
 * /analytics with the d3-v5 activity panel (PR 1 of 5: the U3 data layer and
 * the U6 chart, readout and provider lanes). Routed only when the build sets
 * VITE_PUBLIC_HUB_V5; the rest of the page is the Command Center page as is.
 */
export default function AnalyticsHubV5Page() {
  return <AnalyticsLandingPage activityPanel={HubActivityPanelV5} />
}
