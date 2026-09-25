import { useEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { analyticsReturnPath, broadcastTimelineHref } from '../../lib/momentsNavigation'
import { fromHubMoment } from '../../lib/discoveryMoments'
import { SaveMomentButton } from '../../ui/components/moments/SaveMomentButton'
import { AnalyticsConsole } from '@streampulse/analytics-console'
// Same cascade position as when the console module imported it: before portal styles.
import '@streampulse/analytics-console/session-signal-tape.css'
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

/**
 * Streamclone analytics console (default channel view) inside the portal shell.
 */
export default function ConsoleChannelView() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const [params] = useSearchParams()
  const returnTo = analyticsReturnPath(params.get('returnTo'))
  const returnView = returnTo ? new URL(returnTo, 'https://portal.invalid').searchParams.get('view') : null
  const consoleRef = useRef<HTMLDivElement>(null)
  const { fadeThemeCenter } = useAnalyticsMotion()
  const displayChannel = login.trim() || 'channel'
  // Without a return path (e.g. a shared link) go to this creator's broadcasts,
  // not global History, which may not be available on this server.
  const fallbackReturn = streamId && login.trim()
    ? { to: `/analytics/${encodeURIComponent(login.trim())}`, label: `All ${displayChannel} broadcasts` }
    : { to: '/analytics', label: 'Analytics hub' }
  const returnLabel = !returnTo ? fallbackReturn.label
    : returnTo.startsWith('/analytics/explore') ? 'Pulse Explorer'
    : returnView === 'saved' ? 'Saved moments' : returnView === 'history' ? 'Broadcast history' : 'Latest moments'

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
      <nav className="broadcast-return" aria-label="Broadcast navigation">
        <Link to={returnTo || fallbackReturn.to} state={returnTo ? { momentsReturn: true } : undefined}>← {returnLabel}</Link>
        <span>{displayChannel}{streamId ? ' · Stream timeline & moments' : ' · Broadcasts'}</span>
      </nav>
      <div ref={consoleRef} className="sc-analytics-console">
        <AnalyticsConsole
          mode="public"
          shellNested
          showGameSegments
          enableLayoutControls
          layer2LoadMode="staged"
          enableSyncActions={usesLocalAnalyticsBackend()}
          buildSessionPath={(channel, id) => broadcastTimelineHref(channel, id, returnTo || undefined)}
          renderSelectedMomentActions={selection => {
            const moment = fromHubMoment({ ...selection, label: selection.label || 'Saved stream minute' })
            return moment ? <div className="broadcast-save"><SaveMomentButton moment={moment} contextLabel="selected minute" /><Link to="/analytics/moments?view=saved">View saved moments →</Link></div> : null
          }}
        />
      </div>
    </ChannelHubStatusShell>
  )
}
