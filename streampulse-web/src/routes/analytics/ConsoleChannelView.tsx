import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { AnalyticsConsole } from '@streamclone/analytics-console'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { getBackendUrl } from '../../lib/apiClient'
import { resolveBackendSource, backendSourceLabel } from '../../lib/backendSource'
import { setupStreamcloneAnalyticsApi, usesLocalAnalyticsBackend } from '../../lib/streamcloneAnalytics'
import { HubBackendSourceBanner } from '../../ui/components/analytics/HubBackendSourceBanner'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { useAnalyticsMotion } from '../../ui/motion/useAnalyticsMotion'
import '../../ui/analytics-tailwind.css'
import '../../ui/components/analytics/analytics-console.css'
import '../../ui/components/analytics/figma-analytics.css'
import '../../../../../twitch-7tv-clone/packages/pulse-charts/pulse-chart-motion.css'

setupStreamcloneAnalyticsApi()

function portalSessionPath(login: string, streamId: string): string {
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
}

/**
 * Streamclone analytics console (default channel view) inside the portal shell.
 */
export default function ConsoleChannelView() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const consoleRef = useRef<HTMLDivElement>(null)
  const { fadeThemeCenter } = useAnalyticsMotion()
  const hub = usePublicHubData({ enabled: true, activityWindow: '30m' })
  const backendSource = resolveBackendSource(getBackendUrl())
  const displayChannel = login.trim() || 'channel'

  useEffect(() => {
    fadeThemeCenter(consoleRef.current)
  }, [fadeThemeCenter, login, streamId])

  return (
    <AnalyticsFigmaShell
      backendStatus={{
        label: 'API',
        value: backendSourceLabel(backendSource),
        tone: hub.error && !hub.data ? 'offline' : 'ready',
      }}
    >
      <main className="figma-analytics__main hub-sec--console" id="analytics-main" aria-label={`Analytics for ${displayChannel}`}>
        <HubBackendSourceBanner />
        <div ref={consoleRef} className="sc-analytics-console">
          <AnalyticsConsole
            mode="public"
            shellNested
            showGameSegments={Boolean(streamId?.trim())}
            enableSyncActions={usesLocalAnalyticsBackend()}
            buildSessionPath={portalSessionPath}
          />
        </div>
      </main>
    </AnalyticsFigmaShell>
  )
}
