import type { AnalyticsStream } from '../../apiTypes.ts'
import { duration, formatDateTime } from '../../utils/consoleFormat.ts'
import { RelativeTimeText } from './RelativeTimeText.tsx'

/**
 * The session lifecycle facts prod showed as a row above the chart, as they
 * read in one sentence ("Past broadcast · Offline confirmed … · Started … ·
 * Measured span 1h 0m"). Null while the row would not show: live collection,
 * a sync in progress, or no chart data yet.
 */
export function sessionLifecycleSentence({
  isLiveRoute,
  isActiveLiveCollector,
  stream,
  syncing = false,
  hasChartData = false,
}: {
  isLiveRoute: boolean
  isActiveLiveCollector: boolean
  stream?: AnalyticsStream
  syncing?: boolean
  hasChartData?: boolean
}): { phrase: string; sentence: string } | null {
  if (isActiveLiveCollector || syncing || !hasChartData) return null
  const startedLabel = stream?.startedAt ? formatDateTime(stream.startedAt) : null
  const durationLabel = duration(stream)
  const lifecycleKnown = stream?.lifecycleState === 'confirmed_ended'
  const lifecycleUnknown = !stream?.lifecycleState || stream.lifecycleState === 'unknown'
  const parts = isLiveRoute
    ? lifecycleKnown ? ['Streamer offline', 'Showing last broadcast']
      : lifecycleUnknown ? ['Session lifecycle unknown', 'Showing measured session'] : ['Showing measured session']
    : [lifecycleKnown ? 'Past broadcast' : lifecycleUnknown ? 'Session lifecycle unknown' : 'Measured session']
  if (!isLiveRoute && lifecycleKnown) {
    parts.push(`Offline confirmed ${formatDateTime(stream?.lifecycleDetectedAt)} (exact end time unknown)`)
  }
  if (startedLabel) parts.push(`Started ${startedLabel}`)
  if (durationLabel && durationLabel !== '-') parts.push(`Measured span ${durationLabel}`)
  return { phrase: parts[0]!, sentence: parts.join(' · ') }
}

/**
 * d3-v2 session-original: the lifecycle row is merged into the meta line.
 * "Started 11h ago" is the visible item; the date and the lifecycle sentence
 * are its title, and the sentence stays in the page, visually hidden, for
 * screen readers. On the channel door ("live") route the row's "Open session
 * page" link becomes its own meta item.
 *
 * Keeps prod's hooks: `data-session-lifecycle-row` on the item that carries
 * the lifecycle words, `data-has-action` when the meta line holds the row's
 * link (Watch VOD or Open session page).
 */
export function SessionLifecycleMeta({
  isLiveRoute,
  isActiveLiveCollector,
  stream,
  syncing = false,
  hasChartData = false,
  hasVodLink = false,
  sessionStreamId,
  channelLogin,
  buildSessionPath,
}: {
  isLiveRoute: boolean
  isActiveLiveCollector: boolean
  stream?: AnalyticsStream
  syncing?: boolean
  hasChartData?: boolean
  /** The meta line shows "Watch VOD" (rendered by the page, after "Updated"). */
  hasVodLink?: boolean
  sessionStreamId?: string
  channelLogin: string
  buildSessionPath: (login: string, streamId: string) => string
}) {
  const lifecycle = sessionLifecycleSentence({ isLiveRoute, isActiveLiveCollector, stream, syncing, hasChartData })
  const sessionPath = lifecycle && isLiveRoute && sessionStreamId?.trim()
    ? buildSessionPath(channelLogin, sessionStreamId.trim())
    : null
  const startedAt = stream?.startedAt
  const lifecycleHooks = lifecycle
    ? {
        'data-session-lifecycle-row': '',
        'data-has-action': sessionPath || hasVodLink ? '' : undefined,
      }
    : {}
  const title = [startedAt ? formatDateTime(startedAt) : null, lifecycle?.sentence].filter(Boolean).join(' · ') || undefined

  return (
    <>
      {startedAt ? (
        <span className="mi" title={title} {...lifecycleHooks}>
          <RelativeTimeText prefix="Started" value={startedAt} />
          {lifecycle ? <span role="status" className="sr-only">{`. ${lifecycle.sentence}`}</span> : null}
        </span>
      ) : lifecycle ? (
        // No start time to hang the facts on: the phrase itself is the item.
        <span className="mi" title={lifecycle.sentence} {...lifecycleHooks}>
          <span role="status">{lifecycle.phrase}</span>
        </span>
      ) : null}
      {sessionPath ? (
        <span className="mi">
          <a href={sessionPath}>Open session page</a>
        </span>
      ) : null}
    </>
  )
}
