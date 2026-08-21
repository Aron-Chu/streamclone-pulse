import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRecordHubRecentLogin } from '../../hooks/useRecordHubRecentLogin'
import { AnalyticsRouteFallback } from '../AnalyticsRouteFallback'

const FigmaChannelView = lazy(() => import('./FigmaChannelView'))
const ConsoleChannelView = lazy(() => import('./ConsoleChannelView'))

/**
 * Public, no-login channel analytics for a Twitch channel.
 *
 * Default: Streamclone analytics console (chart, streams sidebar, moments).
 * `?figma=1`: Figma session dashboard (kept for design QA / comparison).
 */
export default function ChannelAnalyticsPage() {
  useRecordHubRecentLogin()
  const [searchParams] = useSearchParams()
  const figmaMode = searchParams.get('figma') === '1'

  return (
    <Suspense fallback={<AnalyticsRouteFallback />}>
      {figmaMode ? <FigmaChannelView /> : <ConsoleChannelView />}
    </Suspense>
  )
}
