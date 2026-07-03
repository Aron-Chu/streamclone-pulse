import { useParams } from 'react-router-dom'
import { useChannelPageData } from '../../hooks/useChannelPageData'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { getBackendUrl } from '../../lib/apiClient'
import { resolveBackendSource, backendSourceLabel } from '../../lib/backendSource'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { FigmaChannelDashboard } from '../../ui/components/analytics/FigmaChannelDashboard'
import '../../ui/components/analytics/figma-analytics.css'

/**
 * Opt-in Figma session dashboard (`?figma=1`). Kept behind the hub shell on
 * purpose - this is a design-review surface, not the canonical channel view.
 */
export default function FigmaChannelView() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const channelData = useChannelPageData(login, streamId)
  const hub = usePublicHubData({ enabled: true, activityWindow: '30m' })

  const backendSource = resolveBackendSource(getBackendUrl())
  const displayChannel = login.trim() || 'channel'

  return (
    <AnalyticsFigmaShell
      backendStatus={{
        label: 'API',
        value: backendSourceLabel(backendSource),
        tone: hub.error && !hub.data ? 'offline' : backendSource === 'local' ? 'degraded' : 'ready',
      }}
    >
      <main className="figma-analytics__main" id="analytics-main" aria-label={`Analytics for ${displayChannel}`}>
        <FigmaChannelDashboard data={channelData} />
      </main>
    </AnalyticsFigmaShell>
  )
}
