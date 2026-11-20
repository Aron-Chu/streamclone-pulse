import { lazy, useEffect, useRef, type ReactElement } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { analyticsReturnPath, broadcastTimelineHref } from '../../lib/momentsNavigation'
import { fromHubMoment } from '../../lib/discoveryMoments'
import { handOverMoment, momentPageHref, momentPageWarmth } from '../../lib/momentPageFlag'
import { isMomentStreamId, loadMomentStream } from '../../lib/momentReads'
import { suggestChannelLink } from '../../lib/suggestChannel'
import { SaveMomentButton } from '../../ui/components/moments/SaveMomentButton'
import type { AnalyticsConsole } from '@streampulse/analytics-console'
// Same cascade position as when the console module imported it: before portal styles.
import '@streampulse/analytics-console/session-signal-tape.css'
import { HubBackendSourceBanner } from '../../ui/components/analytics/HubBackendSourceBanner'
import { ChannelHubStatusShell } from '../../ui/components/analytics/ChannelHubStatusShell'
import { settleThemeFade, useAnalyticsMotionEnabled } from '../../ui/motion/motionEnabled'
import { useReviewedRecapShown } from '../../ui/ReviewedRecapSummary'
import '../../ui/analytics-tailwind.css'
import '../../ui/components/analytics/analytics-console.css'
import '../../ui/components/analytics/figma-analytics.css'
import '@streampulse/analytics-console/analytics-chart-motion.css'
import '@streampulse/pulse-charts/pulse-chart-motion.css'
// Loaded last: compact desktop density overrides shared with the hub.
import '../../ui/components/analytics/analytics-compact.css'
// The session chart part (SpChart, its d3 navigator and the toolbar, pins and band).
import '../../ui/charts/sp-chart.css'
import '../../ui/charts/sp-navigator.css'
import '../../ui/charts/sp-session-chart.css'
// The rest of the session page (d3-v2 session-original): shell, moment rows, bar strip.
import '../../ui/charts/sp-session-page.css'
import '../../ui/charts/sp-session-rows.css'
import '../../ui/charts/sp-session-strip.css'

type ConsoleProps = Omit<NonNullable<Parameters<typeof AnalyticsConsole>[0]>, 'enableSyncActions'>
let consoleLoad: Promise<{ default: (props: ConsoleProps) => ReactElement }> | null = null

/**
 * The console's code and its API, loaded once. Each import names what it takes, so the build keeps
 * only those exports. A failed load is forgotten, so the next mount asks again.
 */
function loadConsole() {
  consoleLoad ??= Promise.all([
    import('@streampulse/analytics-console').then(({ AnalyticsConsole: Loaded }) => Loaded),
    import('../../lib/streamcloneAnalytics').then(({ setupStreamcloneAnalyticsApi, usesLocalAnalyticsBackend }) => ({ setupStreamcloneAnalyticsApi, usesLocalAnalyticsBackend })),
  ]).then(([Loaded, api]) => {
    api.setupStreamcloneAnalyticsApi()
    return { default: (props: ConsoleProps) => <Loaded {...props} enableSyncActions={api.usesLocalAnalyticsBackend()} /> }
  }, (error: unknown) => {
    consoleLoad = null
    throw error
  })
  return consoleLoad
}
const LazyAnalyticsConsole = lazy(loadConsole)

// Every page but a reviewed recap needs the console at once, so its code starts loading with this
// module. A reviewed recap (its summary template is in the document) first asks whether the stream's
// live data still exists.
if (typeof document !== 'undefined' && !document.getElementById('reviewed-recap-summary')) loadConsole().catch(() => {})

type LiveData = 'live' | 'expired'
/** Per stream: whether its live data still exists, once the stream route answered. */
const liveDataChecks = new Map<string, { result: LiveData | null; read: Promise<void> }>()

/**
 * Whether a reviewed recap's stream still has live data, from the stream route (the read the console's
 * own session read starts with). Only a 404 means it expired; any other failure counts as live, so the
 * console shows its own error and retry. While the answer is on its way the view suspends, as it does
 * while the console's code loads.
 */
function liveDataFor(streamId: string): LiveData {
  let check = liveDataChecks.get(streamId)
  if (!check) {
    const entry: { result: LiveData | null; read: Promise<void> } = { result: null, read: Promise.resolve() }
    entry.read = loadMomentStream(streamId).then(() => { entry.result = 'live' }, (error: unknown) => {
      const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
      entry.result = status === 404 ? 'expired' : 'live'
    })
    liveDataChecks.set(streamId, entry)
    check = entry
  }
  if (check.result === null) throw check.read
  return check.result
}

const expiredNotice = <p>Live data for this stream has expired. The reviewed summary is available above.</p>

/**
 * Streamclone analytics console (default channel view) inside the portal shell. On a reviewed recap
 * whose live data has expired it shows the expired notice without loading the console.
 */
export default function ConsoleChannelView() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const [params] = useSearchParams()
  const returnTo = analyticsReturnPath(params.get('returnTo'))
  const returnView = returnTo ? new URL(returnTo, 'https://portal.invalid').searchParams.get('view') : null
  const consoleRef = useRef<HTMLDivElement>(null)
  const motionEnabled = useAnalyticsMotionEnabled()
  const reviewedRecapShown = useReviewedRecapShown()
  const liveData = reviewedRecapShown && isMomentStreamId(streamId) ? liveDataFor(streamId) : 'live'
  const displayChannel = login.trim() || 'channel'
  // Without a return path (e.g. a shared link) go to this creator's broadcasts,
  // not global History, which may not be available on this server.
  const fallbackReturn = streamId && login.trim()
    ? { to: `/analytics/${encodeURIComponent(login.trim())}`, label: `All ${displayChannel} broadcasts` }
    : { to: '/analytics', label: 'Analytics hub' }
  const returnLabel = !returnTo ? fallbackReturn.label
    : returnView === 'saved' ? 'Saved moments' : returnView === 'history' ? 'Broadcast history' : 'Latest moments'

  useEffect(() => {
    settleThemeFade(consoleRef.current, motionEnabled)
  }, [motionEnabled, login])

  return (
    <ChannelHubStatusShell
      displayChannel={displayChannel}
      hideSidebar
      mainClassName="figma-analytics__main hub-sec--console"
    >
      <HubBackendSourceBanner />
      <nav className="broadcast-return" aria-label="Broadcast navigation">
        <Link to={returnTo || fallbackReturn.to} state={returnTo ? { momentsReturn: true } : undefined}>← {returnLabel}</Link>
        {/* d3-v2 session-original: the session page shows only the back link here. */}
        {streamId ? null : <span>{displayChannel} · Broadcasts</span>}
      </nav>
      <div ref={consoleRef} className="sc-analytics-console">
        {liveData === 'expired' ? expiredNotice : <LazyAnalyticsConsole
          mode="public"
          shellNested
          headingLevel={reviewedRecapShown ? 2 : 1}
          missingSessionFallback={reviewedRecapShown ? expiredNotice : undefined}
          showGameSegments
          enableLayoutControls
          layer2LoadMode="staged"
          buildSessionPath={(channel, id) => broadcastTimelineHref(channel, id, returnTo || undefined)}
          suggestChannel={suggestChannelLink()}
          renderSelectedMomentActions={selection => {
            const moment = fromHubMoment({ ...selection, label: selection.label || 'Saved stream minute' })
            // The Moment's page for the selected bar's own minute (its minuteTs), when the build has the page.
            const pagePath = moment ? momentPageHref({ streamId: moment.streamId, at: selection.at }) : null
            return moment ? <div className="broadcast-save"><SaveMomentButton moment={moment} contextLabel="selected minute" />
              {pagePath ? <Link to={pagePath} state={{ from: 'stream', moment: handOverMoment(moment, selection.at) }}
                {...momentPageWarmth({ streamId: moment.streamId, at: selection.at })}>Moment page →</Link> : null}
              <Link to="/analytics/moments?view=saved">View saved moments →</Link></div> : null
          }}
        />}
      </div>
    </ChannelHubStatusShell>
  )
}
