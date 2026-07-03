import { useParams } from 'react-router-dom'
import { AnalyticsConsole } from '@streamclone/analytics-console'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { getBackendUrl } from '../../lib/apiClient'
import { resolveBackendSource, backendSourceLabel } from '../../lib/backendSource'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import '../../ui/analytics-tailwind.css'
import '../../ui/components/analytics/analytics-console.css'
import '../../ui/components/analytics/figma-analytics.css'

function portalSessionPath(login: string, streamId: string): string {
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
}

/**
 * Streamclone analytics console (default channel view) inside the portal shell.
 */
export default function ConsoleChannelView() {
  const { login = '' } = useParams<{ login: string; streamId?: string }>()
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
      <main className="figma-analytics__main hub-sec--console" id="analytics-main" aria-label={`Analytics for ${displayChannel}`}>
        <div className="sc-analytics-console">
          <AnalyticsConsole
            mode="public"
            shellNested
            showGameSegments={true}
            buildSessionPath={portalSessionPath}
          />
        </div>
      </main>
    </AnalyticsFigmaShell>
  )
}
