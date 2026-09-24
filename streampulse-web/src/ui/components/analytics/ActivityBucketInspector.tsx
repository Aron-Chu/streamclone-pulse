import { memo, useMemo, type ReactNode } from 'react'
import { momentRowKey, type FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import type { HubActivityPoint, HubEmote, HubEmoteIntel, HubLiveChannel } from '../../../lib/publicHub'
import { assessViewerCoverage, bucketMinutes, hasProviderSample, hubActivityEmoteCount } from '../../../lib/hubActivitySummary'
import { formatMomentTableTime } from '../../../lib/pulseMomentsUtils'
import type { HubEmoteWithShare } from '../../../lib/emoteShare'
import { compact, displayName, initial } from './hubFormat'
import { HubTopEmotesTable } from './HubTopEmotesTable'
import { InspectorTopEmoteCard } from './InspectorTopEmoteCard'
import { ResilientImage } from '../ResilientImage'
import { twitchProfileImageRendition } from '../../../lib/twitchProfileImage'
import {
  type InspectorMode,
  inspectorEmoteListSignature,
  resolveInspectorRangeStats,
  resolveInspectorTableEmotes,
  resolveBucketMomentStreamers,
  resolveTopLiveStreamers,
  type BucketStreamerPeak,
} from './activityBucketInspectorUtils'
import '../hub/hub.css'

/** Compact chart-rail link to the Pulse Moments selection — not a second inspector. */
export interface LinkedMomentSummary {
  login: string
  displayName?: string
  label: string
}

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
  /** Locked or accent-driven bucket point */
  selectedPoint: HubActivityPoint | null
  /** Hover preview bucket (when not locked / linked) */
  hoverPoint: HubActivityPoint | null
  /** Short link to the selected Pulse Moments row (detail stays in the table inspector). */
  linkedMoment?: LinkedMomentSummary | null
  onClearLinkedMoment?: () => void
  /** True when selectedPoint comes from an explicit chart lock (not moment accent). */
  bucketLocked?: boolean
  onClearBucket?: () => void
  /** Whether non-7TV provider totals are exact counters rather than legacy lower bounds. */
  providerTotalsComplete?: boolean
  liveChannels?: HubLiveChannel[]
  className?: string
}

interface InspectorStat {
  label: string
  value: string
}

function formatBucketTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  return new Date(ts).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The viewer's zone name ("PDT", "UTC", "GMT+9"); times in this inspector are local. */
function localZoneLabel(ts: number): string {
  try {
    return new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date(ts))
      .find(part => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

function formatBucketInterval(ts: number, minutes: number): string {
  const start = new Date(ts)
  const end = new Date(ts + minutes * 60_000)
  const date = { month: 'short', day: 'numeric' } as const
  const time = { hour: 'numeric', minute: '2-digit' } as const
  const endDate = start.toDateString() === end.toDateString() ? '' : `${end.toLocaleDateString([], date)}, `
  return `${start.toLocaleDateString([], date)}, ${start.toLocaleTimeString([], time)} – ${endDate}${end.toLocaleTimeString([], time)}`
}

function dominantProvider(point: HubActivityPoint): string | null {
  const entries: Array<{ key: string; label: string; value: number }> = [
    { key: '7tv', label: '7TV', value: point.seventv ?? 0 },
    { key: 'twitch', label: 'Twitch', value: point.twitch ?? 0 },
    { key: 'bttv', label: 'BTTV', value: point.bttv ?? 0 },
    { key: 'ffz', label: 'FFZ', value: point.ffz ?? 0 },
    { key: 'other', label: 'Other', value: point.other ?? 0 },
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
  label = 'Top live by activity',
  sublabel = 'Chat & emote rate — live pool',
}: {
  streamers: BucketStreamerPeak[]
  loading?: boolean
  showEmptyHint?: boolean
  label?: string
  sublabel?: string
}) {
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
      <span className="activity-bucket-inspector__bucket-streamers-sub muted">{sublabel}</span>
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
                <ResilientImage
                  src={twitchProfileImageRendition(streamer.profileImageUrl, 70)}
                  fallbackSrc={streamer.profileImageUrl}
                  alt=""
                  loading="eager"
                  decoding="async"
                  fallback={
                    <span className="pulse-moments__channel-fallback" aria-hidden="true">
                      {initial(name)}
                    </span>
                  }
                />
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

const LinkedMomentStrip = memo(function LinkedMomentStrip({
  linked,
  onClear,
}: {
  linked: LinkedMomentSummary
  onClear?: () => void
}) {
  const name = displayName(linked.login, linked.displayName)
  return (
    <div className="activity-bucket-inspector__linked" data-testid="bucket-inspector-linked-moment">
      <div className="activity-bucket-inspector__linked-copy">
        <span className="activity-bucket-inspector__linked-eyebrow">Linked to selected moment</span>
        <span className="activity-bucket-inspector__linked-line">
          <strong>{name}</strong>
          <span aria-hidden="true"> · </span>
          <span>{linked.label}</span>
        </span>
      </div>
      {onClear ? (
        <button
          type="button"
          className="activity-bucket-inspector__linked-clear"
          onClick={onClear}
        >
          Clear
        </button>
      ) : null}
    </div>
  )
})

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
          <div key={stat.label} className="pulse-moments__inspector-stat">
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
  linkedMoment = null,
  onClearLinkedMoment,
  bucketLocked = false,
  onClearBucket,
  providerTotalsComplete = false,
  liveChannels = [],
  className,
}: ActivityBucketInspectorProps) {
  const bucketMode: InspectorMode = selectedPoint
    ? 'selected'
    : hoverPoint
      ? 'preview'
      : 'range'

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
  const linkedActive = Boolean(linkedMoment) && !bucketLocked && bucketMode === 'selected'

  const headLabel =
    bucketMode === 'selected'
      ? `Selected bucket · ${formatBucketTime(activePoint!.t)}`
      : bucketMode === 'preview'
        ? `Preview · ${formatBucketTime(activePoint!.t)}`
        : `Top emotes — ${windowLabel}`

  const headBadge =
    linkedActive
      ? 'Linked'
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
    bucketMode === 'range'
      ? (updatedAgo ? `as of ${updatedAgo}` : null)
      : activePoint
        ? bucketHeadMeta(activePoint, windowMinutes, momentFallbackActive, bucketHasEmotes)
        : null

  const bucketFill = bucketMode === 'selected' || bucketMode === 'preview'
  const topLiveStreamers = useMemo(
    () => (bucketMode === 'range' ? resolveTopLiveStreamers(liveChannels, 5) : []),
    [bucketMode, liveChannels],
  )
  const bucketStreamers = useMemo(
    () => (
      bucketMode === 'range'
        ? []
        : resolveBucketMomentStreamers(bucketMoments, liveChannels, 5)
    ),
    [bucketMode, bucketMoments, liveChannels],
  )
  const streamersFooterEmptyHint = bucketMode === 'range' && topLiveStreamers.length === 0

  const displayPoint = activePoint && bucketMode !== 'range' ? activePoint : null
  const viewerCoverage = displayPoint ? assessViewerCoverage(displayPoint) : null
  const chatMissing = displayPoint?.hasChatRollup === false || Boolean(displayPoint?.gapKind)

  const stats: InspectorStat[] =
    bucketMode === 'range'
      ? [
          { label: rangeStats.stat1Label, value: rangeStats.stat1Value },
          { label: rangeStats.stat2Label, value: rangeStats.stat2Value },
          { label: rangeStats.stat3Label, value: rangeStats.stat3Value },
        ]
      : [
          { label: viewerCoverage?.quality === 'partial' ? 'Viewers (partial)' : 'Viewers', value: displayPoint && viewerCoverage?.sampled ? compact(displayPoint.viewers) : '—' },
          { label: 'Chat / min', value: displayPoint && !chatMissing ? compact(displayPoint.chat) : '—' },
          {
            label: 'Emotes / min',
            value: displayPoint && !chatMissing ? compact(hubActivityEmoteCount(displayPoint)) : '—',
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
    bucketMode === 'selected'
      ? ' activity-bucket-inspector--active'
      : bucketMode === 'preview'
        ? ' activity-bucket-inspector--preview'
        : ''

  if (activePoint) {
    const coverageLabel = viewerCoverage?.coveragePct != null
      ? `${Math.round(viewerCoverage.coveragePct)}% of viewer samples`
      : viewerCoverage?.quality === 'complete'
        ? 'Viewer sampling complete'
        : viewerCoverage?.quality === 'partial'
          ? 'Partial viewer sample'
          : 'Viewer coverage unknown'
    const providerRows = [
      { key: 'sevenTv' as const, label: '7TV', value: activePoint.seventv },
      { key: 'twitch' as const, label: 'Twitch', value: activePoint.twitch },
      { key: 'bttv' as const, label: 'BTTV', value: activePoint.bttv },
      { key: 'ffz' as const, label: 'FFZ', value: activePoint.ffz },
    ]

    return (
      <aside className="activity-bucket-inspector activity-bucket-inspector--summary" aria-label="Activity bucket inspector">
        {linkedMoment ? <LinkedMomentStrip linked={linkedMoment} onClear={onClearLinkedMoment} /> : null}
        <header className="activity-bucket-inspector__summary-header">
          <div className="activity-bucket-inspector__summary-heading">
            <span className="activity-bucket-inspector__selection-state">
              {bucketLocked ? 'Bucket selected' : linkedMoment ? 'Moment bucket' : 'Bucket preview'}
            </span>
            {bucketLocked && onClearBucket ? (
              <button type="button" onClick={onClearBucket} aria-label="Clear selected bucket">Clear selection</button>
            ) : null}
          </div>
          <strong><time dateTime={new Date(activePoint.t).toISOString()}>{formatBucketInterval(activePoint.t, bucketMinutes(windowMinutes))}</time>{localZoneLabel(activePoint.t) ? <small className="activity-bucket-inspector__zone"> {localZoneLabel(activePoint.t)}</small> : null}</strong>
          <span>Bucket activity · {bucketMinutes(windowMinutes)} min{activePoint.bucketComplete === false ? ' · In progress' : ''}{bucketLocked ? ' · Filters moments below' : ''}</span>
        </header>
        <dl className="activity-bucket-inspector__summary-stats">
          {stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}
        </dl>
        <p className="activity-bucket-inspector__scope">
          <span>{chatMissing ? 'Chat and emote measurements unavailable.' : 'Tracked IRC chat and emotes, averaged over this interval.'}</span>
          {activePoint.providerCountsLowerBound ? <span>Provider counts are lower bounds.</span> : null}
        </p>
        <section className="activity-bucket-inspector__context" aria-label="Bucket breakdown">
          <div className="activity-bucket-inspector__summary-emotes">
            <h4>{momentFallbackActive ? 'Top emotes · uses in matching detections' : 'Top emotes · uses in this bucket'}</h4>
            {tableEmotes.length ? <ul>{tableEmotes.slice(0, 3).map((emote, index) => <li key={`${emote.name}-${index}`}>
              <ResilientImage src={emote.imageUrl} alt="" fallback={<span aria-hidden="true">—</span>} />
              <span title={emote.name}>{emote.name}</span>
              <strong title={`${emote.count.toLocaleString()} uses`}>{compact(emote.count)}</strong>
            </li>)}</ul> : <p>No named emote breakdown was supplied for this interval.</p>}
          </div>
        </section>
        {bucketLocked ? (
          <section className="activity-bucket-inspector__matching" aria-label="Matching moments in selected bucket">
            <div className="activity-bucket-inspector__matching-heading">
              <h4>Matching detections</h4>
              <span>{bucketMoments.length > 3 ? `Previewing 3 of ${bucketMoments.length} loaded` : `${bucketMoments.length} loaded`}{bucketMomentsLoading ? ' · checking for more' : ''}</span>
            </div>
            {bucketMoments.length > 0 ? (
              <ol>
                {bucketMoments.slice(0, 3).map(moment => (
                  <li key={momentRowKey(moment)}>
                    <span className="activity-bucket-inspector__matching-channel" title={moment.displayName || moment.login || undefined}>
                      {moment.displayName || moment.login || 'Unknown channel'}
                    </span>
                    <strong title={moment.label}>{moment.label}</strong>
                    <span className="activity-bucket-inspector__matching-time">{formatMomentTableTime(moment, liveChannels)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{bucketMomentsLoading ? 'Checking for matching detections…' : 'No matching detections loaded. Check Pulse Moments below for the fetch status.'}</p>
            )}
            <p className="activity-bucket-inspector__matching-note">Detector-selected moments only; this is not a list of every active channel.</p>
            <a className="activity-bucket-inspector__moments-link" href="#section-pulse-moments">Inspect matching moments <span aria-hidden="true">↓</span></a>
          </section>
        ) : null}
        <section className="activity-bucket-inspector__providers" aria-label="Selected bucket provider rates">
          <h4>Emote providers · uses / min</h4>
          <dl>{providerRows.map(({ key, label, value }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{hasProviderSample(activePoint, key)
                ? `${key !== 'sevenTv' && !providerTotalsComplete ? '≥' : ''}${compact(value ?? 0)}`
                : '—'}</dd>
            </div>
          ))}</dl>
          <p>{coverageLabel}</p>
        </section>
      </aside>
    )
  }

  return (
    <aside
      className={`activity-bucket-inspector${modeClass}${className ? ` ${className}` : ''}`}
      aria-label="Activity bucket inspector"
    >
      {linkedMoment ? (
        <LinkedMomentStrip linked={linkedMoment} onClear={onClearLinkedMoment} />
      ) : null}
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
          <InspectorStreamersFooter
            streamers={bucketStreamers}
            loading={bucketMomentsLoading}
            label="Channels in this bucket"
            sublabel="Peak chat & emote rate in the selected interval"
          />
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
