import type { AnalyticsStream } from '../../apiTypes.ts'
import { buildTwitchVodUrl, type VodLinkState } from '../../utils/twitchVodUrl.ts'
import { duration, formatDateTime } from '../../utils/consoleFormat.ts'

export function PastBroadcastBanner({
  isLiveRoute,
  isActiveLiveCollector,
  stream,
  syncing = false,
  hasChartData = false,
  vodLinkState,
  sessionStreamId,
  channelLogin,
  buildSessionPath,
}: {
  isLiveRoute: boolean
  isActiveLiveCollector: boolean
  stream?: AnalyticsStream
  syncing?: boolean
  hasChartData?: boolean
  vodLinkState?: VodLinkState
  sessionStreamId?: string
  channelLogin: string
  buildSessionPath: (login: string, streamId: string) => string
}) {
  if (isActiveLiveCollector || syncing || !hasChartData) return null

  const startedLabel = stream?.startedAt ? formatDateTime(stream.startedAt) : null
  const durationLabel = duration(stream)
  const lifecycleKnown = stream?.lifecycleState === 'confirmed_ended'
  const lifecycleUnknown = !stream?.lifecycleState || stream.lifecycleState === 'unknown'
  const vodUrl = vodLinkState?.status === 'linked' && vodLinkState.vodId
    ? buildTwitchVodUrl(vodLinkState.vodId)
    : null
  const sessionPath = sessionStreamId?.trim()
    ? buildSessionPath(channelLogin, sessionStreamId.trim())
    : null

  if (isLiveRoute) {
    const parts = lifecycleKnown ? ['Streamer offline', 'Showing last broadcast']
      : lifecycleUnknown ? ['Session lifecycle unknown', 'Showing measured session'] : ['Showing measured session']
    if (startedLabel) parts.push(`Started ${startedLabel}`)
    if (durationLabel && durationLabel !== '-') parts.push(`Measured span ${durationLabel}`)

    return (
      <div
        className="rounded border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-xs font-semibold text-zinc-300"
        role="status"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{parts.join(' · ')}</span>
          {sessionPath ? (
            <a
              href={sessionPath}
              className="rounded border border-white/10 bg-white/[0.04] inline-flex min-h-11 min-w-11 items-center px-2 py-2 text-xs font-black uppercase text-zinc-200 transition hover:bg-white/[0.08]"
            >
              Open session page
            </a>
          ) : null}
          {vodUrl ? (
            <a
              href={vodUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-cyan-400/20 bg-cyan-400/10 inline-flex min-h-11 min-w-11 items-center px-2 py-2 text-xs font-black uppercase text-cyan-100 transition hover:bg-cyan-400/15"
            >
              Watch VOD
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  const parts = [lifecycleKnown ? 'Past broadcast' : lifecycleUnknown ? 'Session lifecycle unknown' : 'Measured session']
  if (lifecycleKnown) parts.push(`Offline confirmed ${formatDateTime(stream.lifecycleDetectedAt)} (exact end time unknown)`)
  if (startedLabel) parts.push(`Started ${startedLabel}`)
  if (durationLabel && durationLabel !== '-') parts.push(`Measured span ${durationLabel}`)

  return (
    <div
      className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs font-semibold text-zinc-400"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{parts.join(' · ')}</span>
        {vodUrl ? (
          <a
            href={vodUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-cyan-400/20 bg-cyan-400/10 inline-flex min-h-11 min-w-11 items-center px-2 py-2 text-xs font-black uppercase text-cyan-100 transition hover:bg-cyan-400/15"
          >
            Watch VOD
          </a>
        ) : null}
      </div>
    </div>
  )
}
