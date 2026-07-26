import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { AnalyticsConsole } from '@streampulse/analytics-console'
import { setupStreamcloneAnalyticsApi, usesLocalAnalyticsBackend } from '../../lib/streamcloneAnalytics'
import { HubBackendSourceBanner } from '../../ui/components/analytics/HubBackendSourceBanner'
import { ChannelHubStatusShell } from '../../ui/components/analytics/ChannelHubStatusShell'
import { useAnalyticsMotion } from '../../ui/motion/useAnalyticsMotion'
import '../../ui/analytics-tailwind.css'
import '../../ui/components/analytics/analytics-console.css'
import '../../ui/components/analytics/figma-analytics.css'
import '@streampulse/analytics-console/analytics-chart-motion.css'
import '@streampulse/pulse-charts/pulse-chart-motion.css'

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
  const displayChannel = login.trim() || 'channel'

  useEffect(() => {
    fadeThemeCenter(consoleRef.current)
  }, [fadeThemeCenter, login])

  return (
    <ChannelHubStatusShell
      displayChannel={displayChannel}
      hideSidebar
      mainClassName="figma-analytics__main hub-sec--console"
    >
      <HubBackendSourceBanner />
      <div ref={consoleRef} className="sc-analytics-console">
        <AnalyticsConsole
          mode="public"
          shellNested
          showGameSegments
          enableSyncActions={usesLocalAnalyticsBackend()}
          buildSessionPath={portalSessionPath}
        />
      </div>
    </ChannelHubStatusShell>
  )
}
