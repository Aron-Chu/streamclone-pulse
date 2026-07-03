import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnalyticsConsole } from '@streamclone/analytics-console'
import { useRecordHubRecentLogin } from '../../hooks/useRecordHubRecentLogin'
import '../../ui/analytics-tailwind.css'

const FigmaChannelView = lazy(() => import('./FigmaChannelView'))

function portalSessionPath(login: string, streamId: string): string {
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
}

/**
 * Public, no-login channel analytics for a Twitch channel.
 *
 * `/analytics/:channelLogin` and `/analytics/:channelLogin/:streamId` render the
 * shared Streamclone analytics console directly (full Streamclone parity).
 *
 * `?figma=1` is an optional opt-in to the lighter Figma session dashboard for
 * design review only; it is not the default surface.
 */
export default function ChannelAnalyticsPage() {
  useRecordHubRecentLogin()
  const [searchParams] = useSearchParams()
  const figmaMode = searchParams.get('figma') === '1'

  if (figmaMode) {
    return (
      <Suspense fallback={null}>
        <FigmaChannelView />
      </Suspense>
    )
  }

  return (
    <div className="sc-analytics-console" id="analytics-main">
      <AnalyticsConsole
        mode="public"
        showGameSegments={true}
        buildSessionPath={portalSessionPath}
      />
    </div>
  )
}
