import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { isChannelRouteLogin } from '../../lib/channelRoute'
import NotFound from '../public/NotFound'
import { useRecordHubRecentLogin } from '../../hooks/useRecordHubRecentLogin'
import { AnalyticsRouteFallback } from '../AnalyticsRouteFallback'

// The console's code starts with this page's view, not after it: every page but a reviewed recap (its summary
// template is in the document) mounts the console at once.
const ConsoleChannelView = lazy(() => {
  if (typeof document !== 'undefined' && !document.getElementById('reviewed-recap-summary')) import('@streampulse/analytics-console').catch(() => {})
  return import('./ConsoleChannelView')
})

/**
 * Public, no-login channel analytics for a Twitch channel.
 *
 * The Streamclone analytics console is the only supported channel surface.
 * Legacy preview query parameters are deliberately ignored so bookmarked links
 * cannot reactivate a retired analytics stack.
 */
export default function ChannelAnalyticsPage() {
  const { login = '' } = useParams<{ login: string }>()
  return isChannelRouteLogin(login) ? <ValidChannelAnalyticsPage /> : <NotFound />
}

function ValidChannelAnalyticsPage() {
  useRecordHubRecentLogin()

  return (
    <Suspense fallback={<AnalyticsRouteFallback />}>
      <ConsoleChannelView />
    </Suspense>
  )
}
