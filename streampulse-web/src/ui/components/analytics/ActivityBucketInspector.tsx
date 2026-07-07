import { memo, useMemo, type ReactNode } from 'react'
import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import type { HubActivityPoint, HubEmote, HubEmoteIntel, HubLiveChannel } from '../../../lib/publicHub'
import { bucketMinutes, hubActivityEmoteCount } from '../../../lib/hubActivitySummary'
import type { HubEmoteWithShare } from '../../../lib/emoteShare'
import { compact, initial } from './hubFormat'
import { HubTopEmotesTable } from './HubTopEmotesTable'
import { HubMomentRailBody } from './HubMomentRailBody'
import { InspectorTopEmoteCard } from './InspectorTopEmoteCard'
import {
  type InspectorMode,
  inspectorEmoteListSignature,
  resolveInspectorRangeStats,
  resolveInspectorTableEmotes,
  resolveTopLiveStreamers,
  type BucketStreamerPeak,
} from './activityBucketInspectorUtils'
import '../hub/hub.css'

export interface ActivityBucketInspectorProps {
  rangeEmotes: HubEmote[]
  windowLabel: string
  windowMinutes: number
  updatedAgo?: string
  emoteIntel?: HubEmoteIntel
  topEmoteName?: string
  /** Aggregated emotes from bucket-filtered Pulse Moments when hub points omit topEmotes. */
  bucketMomentEmotes?: HubEmote[]
  /** Pulse Moments rows in the active chart bucket (selected or hover preview). */
  bucketMoments?: FigmaMomentRow[]
  /** Historical bucket fetch in flight (selected bucket only). */
  bucketMomentsLoading?: boolean
  /** Locked bucket from chart click */
  selectedPoint: HubActivityPoint | null
  /** Hover preview bucket (when not locked) */
  hoverPoint: HubActivityPoint | null
  /** Pulse Moments row focus — replaces bucket/range body in the chart rail. */
  focusedMoment?: FigmaMomentRow | null
  emoteLookup?: Map<string, HubEmote>
  liveChannels?: HubLiveChannel[]
  channelLive?: boolean
  lockedBucketT?: number | null
  lockedBucketLabel?: string | null
  onBackToBucket?: () => void
  className?: string
}

type InspectorStatTone = 'high' | 'mid' | 'emote' | 'neutral'

interface InspectorStat {
  label: string
  value: string
  tone?: InspectorStatTone
}

function formatBucketTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  return new Date(ts).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dominantProvider(point: HubActivityPoint): string | null {
  const entries: Array<{ key: string; label: string; value: number }> = [
    { key: '7tv', label: '7TV', value: point.seventv ?? 0 },
    { key: 'twitch', label: 'Twitch', value: point.twitch ?? 0 },
    { key: 'bttv', label: 'BTTV', value: point.bttv ?? 0 },
    { key: 'ffz', label: 'FFZ', value: point.ffz ?? 0 },
  ]
  const best = entries.reduce((a, b) => (b.value > a.value ? b : a), entries[0])
  return best.value > 0 ? best.label : null
}

function bucketHeadMeta(
  point: HubActivityPoint,
  windowMinutes: number,
  momentFallbackActive: boolean,
  bucketHasEmotes: boolean,
): string | null {
  if (momentFallbackActive) {
    return 'Top emotes aggregated from detected spikes in this bucket'
  }
  if (!bucketHasEmotes) {
    return 'No emote rollups stored for this bucket yet'
  }
  const mins = bucketMinutes(windowMinutes)
  const widthLabel = mins > 1 ? `${mins}-min bucket` : '1-min bucket'
  if (point.bucketComplete === false) {
    return `Bucket still open · ${widthLabel}`
  }
  const dominant = dominantProvider(point)
  if (dominant) {
    return `Mostly ${dominant} · ${widthLabel}`
  }
  return widthLabel
}

const InspectorStreamersFooter = memo(function InspectorStreamersFooter({
  streamers,
  loading = false,
  showEmptyHint = false,
}: {
  streamers: BucketStreamerPeak[]
  loading?: boolean
  showEmptyHint?: boolean
}) {
  const label = 'Top live by activity'
  const emptyCopy = 'No live channels in the tracked pool right now.'

  if (loading && streamers.length === 0) {
    return (
      <div className="activity-bucket-inspector__bucket-streamers activity-bucket-inspector__bucket-streamers--pending">
        <span className="activity-bucket-inspector__bucket-streamers-label">{label}</span>
      </div>
    )
  }

  if (streamers.length === 0) {
    if (!showEmptyHint) return null
    return (
      <div className="activity-bucket-inspector__bucket-streamers">
        <span className="activity-bucket-inspector__bucket-streamers-label">{label}</span>
        <p className="activity-bucket-inspector__streamers-empty muted">{emptyCopy}</p>
      </div>
    )
  }

  return (
    <div className="activity-bucket-inspector__bucket-streamers">
      <span className="activity-bucket-inspector__bucket-streamers-label">{label}</span>
      <span className="activity-bucket-inspector__bucket-streamers-sub muted">
        Chat &amp; emote rate — live pool
      </span>
      <ul className="activity-bucket-inspector__streamer-list" role="list">
        {streamers.map((streamer, index) => {
          const name = streamer.displayName?.trim() || streamer.login
          const chatLabel = streamer.chatPerMin > 0 ? `${compact(streamer.chatPerMin)} chat` : null
          const emoteLabel = streamer.emotesPerMin > 0 ? `${compact(streamer.emotesPerMin)} emotes` : null
          const metrics = [chatLabel, emoteLabel].filter(Boolean).join(' · ') || '—'
          return (
            <li key={streamer.login} className="activity-bucket-inspector__streamer-row">
              <span className="activity-bucket-inspector__streamer-rank tnum" aria-hidden="true">
                {index + 1}
              </span>
              <span className="pulse-moments__channel pulse-moments__channel--compact activity-bucket-inspector__streamer-channel">
                {streamer.profileImageUrl ? (
                  <img
                    src={streamer.profileImageUrl}
                    alt=""
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <span className="pulse-moments__channel-fallback" aria-hidden="true">
                    {initial(name)}
                  </span>
                )}
                <span className="pulse-moments__channel-name" title={name}>
                  {name}
                </span>
              </span>
              <span className="activity-bucket-inspector__streamer-metrics tnum">{metrics}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
})

function inspectorStatToneClass(tone?: InspectorStatTone): string {
  if (!tone || tone === 'neutral') return ''
  return ` pulse-moments__inspector-stat--${tone}`
}

const InspectorChrome = memo(function InspectorChrome({
  headLabel,
  headBadge,
  headMeta,
  hero,
  stats,
}: {
  headLabel: string
  headBadge?: string | null
  headMeta: string | null
  hero?: ReactNode
  stats: InspectorStat[]
}) {
  return (
    <div className="activity-bucket-inspector__chrome">
      <div className="activity-bucket-inspector__head">
        <div className="activity-bucket-inspector__head-row">
          <span className="activity-bucket-inspector__head-label pulse-moments__inspector-top-emote-label">
            {headLabel}
          </span>
          {headBadge ? (
            <span className="activity-bucket-inspector__mode-badge">{headBadge}</span>
          ) : null}
        </div>
        <span className="activity-bucket-inspector__head-meta">{headMeta ?? '\u00a0'}</span>
      </div>

      {hero}

      <div className="pulse-moments__inspector-grid activity-bucket-inspector__stats">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`pulse-moments__inspector-stat${inspectorStatToneClass(stat.tone)}`}
          >
            <small>{stat.label}</small>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
})

const InspectorEmoteList = memo(
  function InspectorEmoteList({
    emotes,
    mode,
    fill,
  }: {
    emotes: HubEmoteWithShare[]
    mode: InspectorMode
    fill?: boolean
  }) {
    if (emotes.length === 0) {
      return (
        <div className="activity-bucket-inspector__empty muted">
          {mode === 'range'
            ? 'Top emotes appear when the public hub has provider rollups for this window.'
            : 'No per-bucket emote breakdown for this interval yet.'}
        </div>
      )
    }
    return (
      <div className="activity-bucket-inspector__table-slot">
        <HubTopEmotesTable emotes={emotes} maxRows={10} layout="inspector" fill={fill} />
      </div>
    )
  },
  (prev, next) =>
    prev.mode === next.mode &&
    prev.fill === next.fill &&
    inspectorEmoteListSignature(prev.emotes) === inspectorEmoteListSignature(next.emotes),
)

export function ActivityBucketInspector({
  rangeEmotes,
  windowLabel,
  windowMinutes,
  updatedAgo,
  emoteIntel,
  topEmoteName,
  bucketMomentEmotes = [],
  bucketMoments = [],
  bucketMomentsLoading = false,
  selectedPoint,
  hoverPoint,
  focusedMoment = null,
  emoteLookup,
  liveChannels = [],
  channelLive,
  lockedBucketT = null,
  lockedBucketLabel = null,
  onBackToBucket,
  className,
}: ActivityBucketInspectorProps) {
  const bucketMode: InspectorMode = selectedPoint
    ? 'selected'
    : hoverPoint
      ? 'preview'
      : 'range'
  const mode: InspectorMode = focusedMoment ? 'moment' : bucketMode

  const activePoint = selectedPoint ?? hoverPoint
  const bucketHasEmotes = (activePoint?.topEmotes?.length ?? 0) > 0
  const momentFallbackActive =
    (bucketMode === 'selected' || bucketMode === 'preview') &&
    !bucketHasEmotes &&
    bucketMomentEmotes.length > 0

  const tableEmotes = useMemo(
    () => resolveInspectorTableEmotes(bucketMode, activePoint, rangeEmotes, bucketMomentEmotes),
    [bucketMode, activePoint, rangeEmotes, bucketMomentEmotes],
  )

  const leadingEmote = tableEmotes[0]

  const headLabel =
    mode === 'moment'
      ? 'Moment inspector'
      : bucketMode === 'selected'
        ? `Selected bucket · ${formatBucketTime(activePoint!.t)}`
        : bucketMode === 'preview'
          ? `Preview · ${formatBucketTime(activePoint!.t)}`
          : `Top emotes — ${windowLabel}`

  const headBadge =
    mode === 'moment'
      ? 'Moment'
      : bucketMode === 'selected'
        ? 'Selected'
        : bucketMode === 'preview'
          ? 'Preview'
          : null

  const rangeStats = useMemo(
    () => resolveInspectorRangeStats(emoteIntel, topEmoteName),
    [emoteIntel, topEmoteName],
  )

  const headMeta =
    mode === 'moment'
      ? focusedMoment?.label ?? null
      : bucketMode === 'range'
        ? (updatedAgo ? `as of ${updatedAgo}` : null)
        : activePoint
          ? bucketHeadMeta(activePoint, windowMinutes, momentFallbackActive, bucketHasEmotes)
          : null

  const bucketFill = bucketMode === 'selected' || bucketMode === 'preview'
  const topLiveStreamers = useMemo(
    () => (bucketMode === 'range' ? resolveTopLiveStreamers(liveChannels, 5) : []),
    [bucketMode, liveChannels],
  )
  const streamersFooterEmptyHint = bucketMode === 'range' && topLiveStreamers.length === 0

  const displayPoint = activePoint && bucketMode !== 'range' ? activePoint : null
  const statsChatLabel = bucketMinutes(windowMinutes) > 1 ? 'Chat / min then' : 'Chat then'

  const stats: InspectorStat[] =
    bucketMode === 'range'
      ? [
          { label: rangeStats.stat1Label, value: rangeStats.stat1Value, tone: 'neutral' },
          { label: rangeStats.stat2Label, value: rangeStats.stat2Value, tone: 'emote' },
          { label: rangeStats.stat3Label, value: rangeStats.stat3Value, tone: 'mid' },
        ]
      : [
          { label: 'Viewers then', value: displayPoint ? compact(displayPoint.viewers) : '—', tone: 'mid' },
          { label: statsChatLabel, value: displayPoint ? compact(displayPoint.chat) : '—', tone: 'high' },
          {
            label: 'Emotes then',
            value: displayPoint ? compact(hubActivityEmoteCount(displayPoint)) : '—',
            tone: 'emote',
          },
        ]

  const hero =
    leadingEmote != null ? (
      <InspectorTopEmoteCard
        className="activity-bucket-inspector__hero"
        emote={leadingEmote}
        headline={
          bucketMode === 'range'
            ? `Leading emote — ${windowLabel}`
            : 'Top emote this bucket'
        }
        countUnit={bucketMode === 'range' ? 'uses in window' : 'uses this bucket'}
        topShare={leadingEmote.sharePct}
      />
    ) : null

  const modeClass =
    mode === 'moment'
      ? ' activity-bucket-inspector--moment'
      : bucketMode === 'selected'
        ? ' activity-bucket-inspector--active'
        : bucketMode === 'preview'
          ? ' activity-bucket-inspector--preview'
          : ''

  if (mode === 'moment' && focusedMoment) {
    return (
      <aside
        className={`activity-bucket-inspector${modeClass}${className ? ` ${className}` : ''}`}
        aria-label="Moment inspector"
      >
        <div className="activity-bucket-inspector__head activity-bucket-inspector__head--moment">
          <div className="activity-bucket-inspector__head-row">
            <span className="activity-bucket-inspector__head-label pulse-moments__inspector-top-emote-label">
              {headLabel}
            </span>
            {headBadge ? (
              <span className="activity-bucket-inspector__mode-badge">{headBadge}</span>
            ) : null}
          </div>
          {headMeta ? (
            <span className="activity-bucket-inspector__head-meta">{headMeta}</span>
          ) : null}
        </div>
        <div className="activity-bucket-inspector__moment-slot">
          <HubMomentRailBody
            moment={focusedMoment}
            emoteLookup={emoteLookup}
            liveChannels={liveChannels}
            channelLive={channelLive}
            lockedBucketT={lockedBucketT}
            lockedBucketLabel={lockedBucketLabel}
            onBackToBucket={onBackToBucket}
          />
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`activity-bucket-inspector${modeClass}${className ? ` ${className}` : ''}`}
      aria-label="Activity bucket inspector"
    >
      <InspectorChrome
        headLabel={headLabel}
        headBadge={headBadge}
        headMeta={headMeta}
        hero={hero}
        stats={stats}
      />
      <div className="activity-bucket-inspector__list-wrap">
        <InspectorEmoteList emotes={tableEmotes} mode={bucketMode} fill={bucketFill} />
        {bucketFill ? (
          <div className="activity-bucket-inspector__reserved-slot" data-reserved-for="clip-tools" aria-hidden="true" />
        ) : bucketMode === 'range' ? (
          <InspectorStreamersFooter
            streamers={topLiveStreamers}
            showEmptyHint={streamersFooterEmptyHint}
          />
        ) : null}
      </div>
    </aside>
  )
}
