import { Fragment, useId, type ReactNode } from 'react'
import { BarChart3, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { analyticsActionLabel } from '../../../lib/analyticsLinks'
import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import type { HubEmote, HubLiveChannel } from '../../../lib/publicHub'
import { buildVodTimestampUrl } from '../../../lib/figmaSessionAnalytics'
import {
  momentActivityBadge,
  momentEmoteTitle,
  momentHasEmoteRollups,
  momentTotalEmoteUses,
  momentWallClockLabel,
  resolveMomentEmote,
  ROLLUP_CONFIDENCE_TITLE,
  sourceLabel,
  vodStateLabel,
} from '../../../lib/pulseMomentsUtils'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { compact, initial, providerCssVarKey, providerLabel } from './hubFormat'
import { formatChatRate, formatReactionScore, formatViewerDelta, REACTION_SCORE_TOOLTIP } from '../../../lib/momentMetricLabels'
import type { MomentChannelContext } from './MostReactedMinutesTable'
import { BACKEND_SHARE_TITLE, formatSharePctLabel } from '../../../lib/emoteShare'
import { EmoteImg } from './EmoteImg'

export interface FigmaMomentInspectorProps {
  moment?: FigmaMomentRow | null
  vodId?: string
  momentHref?: string
  sessionHref?: string
  emoteLookup?: Map<string, HubEmote>
  channel?: MomentChannelContext
  liveChannels?: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>>
  variant?: 'default' | 'pulse-live'
  /** False when the channel is known offline — stops stale "Live IRC" copy. */
  channelLive?: boolean
}

function InspectorEmoteImage({ src, name, hero }: { src: string; name: string; hero?: boolean }) {
  return (
    <EmoteImg
      src={src}
      name={name}
      fallbackClassName={
        hero
          ? 'pulse-moments__inspector-top-emote-fallback pulse-moments__inspector-top-emote-fallback--hero'
          : 'pulse-moments__inspector-top-emote-fallback'
      }
    />
  )
}

function InfoAffordance({ description, label }: { description: string; label: string }) {
  const descriptionId = useId()
  return (
    <span className="pulse-moments__info-affordance">
      <button
        type="button"
        className="pulse-moments__info-btn"
        aria-label={label}
        aria-describedby={descriptionId}
        title={description}
      >
        <Info size={12} aria-hidden="true" />
      </button>
      <span id={descriptionId} className="visually-hidden">
        {description}
      </span>
    </span>
  )
}

export function MomentContextSpans({ moment, channelLive }: { moment: FigmaMomentRow; channelLive?: boolean }) {
  const source = sourceLabel(moment.source)
  const segments: Array<{ key: string; node: ReactNode }> = [
    { key: 'source', node: <span>{source}</span> },
  ]

  if (moment.confidence != null && Number.isFinite(moment.confidence)) {
    segments.push({
      key: 'confidence',
      node: (
        <span className="pulse-moments__context-confidence" title={ROLLUP_CONFIDENCE_TITLE}>
          {Math.round(moment.confidence)}% conf
          <InfoAffordance description={ROLLUP_CONFIDENCE_TITLE} label="What does data confidence mean?" />
        </span>
      ),
    })
  }

  const vod = vodStateLabel(moment.vodState, channelLive)
  if (vod !== '—' && vod.toLowerCase() !== source.toLowerCase()) {
    segments.push({ key: 'vod', node: <span>{vod}</span> })
  }

  if (segments.length === 0) return null

  return (
    <span className="pulse-moments__context-spans">
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? <span className="pulse-moments__context-sep" aria-hidden="true"> · </span> : null}
          {segment.node}
        </Fragment>
      ))}
    </span>
  )
}

function InspectorTopEmoteCard({
  emote,
  emoteTitle,
  topShare,
}: {
  emote: NonNullable<ReturnType<typeof resolveMomentEmote>>
  emoteTitle: string
  topShare?: number
}) {
  return (
    <div className="pulse-moments__inspector-emote-card" title={emoteTitle}>
      <div className="pulse-moments__inspector-emote-card-head">
        <span className="pulse-moments__inspector-top-emote-label">Top emote this minute</span>
        <InfoAffordance description={emoteTitle} label={`Emote details for ${emote.name}`} />
      </div>
      <div className="pulse-moments__inspector-emote-card-body">
        <div className="pulse-moments__inspector-emote-frame">
          {emote.imageUrl ? (
            <InspectorEmoteImage src={emote.imageUrl} name={emote.name} hero />
          ) : (
            <span
              className="pulse-moments__inspector-top-emote-fallback pulse-moments__inspector-top-emote-fallback--hero"
              aria-hidden="true"
            >
              {initial(emote.name)}
            </span>
          )}
        </div>
        <div className="pulse-moments__inspector-emote-details">
          <div className="pulse-moments__inspector-emote-title-row">
            <span className="pulse-moments__inspector-top-emote-name" title={emote.name}>
              {emote.name}
            </span>
            {emote.provider ? (
              <span
                className="pulse-moments__inspector-provider"
                data-provider={providerCssVarKey(emote.provider)}
              >
                {providerLabel(emote.provider)}
              </span>
            ) : null}
          </div>
          {emote.count != null ? (
            <p className="pulse-moments__inspector-emote-stat-row">
              <span className="pulse-moments__inspector-emote-stat-group">
                <strong>{compact(emote.count)}</strong>
                <span className="pulse-moments__inspector-emote-stat-unit">uses this minute</span>
              </span>
            </p>
          ) : null}
          {topShare != null && Number.isFinite(topShare) ? (
            <p className="pulse-moments__inspector-emote-share-row">
              <span
                className="pulse-moments__inspector-emote-share-line"
                title={`${formatSharePctLabel(topShare)} — ${BACKEND_SHARE_TITLE}`}
              >
                {formatSharePctLabel(topShare)} of emotes
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function InspectorHero({
  moment,
  emoteLookup,
  liveChannels,
  showScore,
}: {
  moment: FigmaMomentRow
  emoteLookup?: Map<string, HubEmote>
  liveChannels?: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>>
  showScore?: boolean
}) {
  const hasEmotes = momentHasEmoteRollups(moment)
  const emote = hasEmotes ? resolveMomentEmote(moment, emoteLookup ?? new Map()) : null
  const emoteTitle = emote ? momentEmoteTitle(emote) : ''
  const totalEmotes = momentTotalEmoteUses(moment)
  const viewerDelta = formatViewerDelta(moment.viewerDelta)
  const viewerDisplay = viewerDelta === '—' ? 'no change' : viewerDelta
  const activityBadge = momentActivityBadge(moment)
  const topShare = moment.topEmotes?.[0]?.sharePct

  return (
    <div className="pulse-moments__inspector-hero">
      {emote ? (
        <InspectorTopEmoteCard emote={emote} emoteTitle={emoteTitle} topShare={topShare} />
      ) : (
        <p className="muted pulse-moments__inspector-empty-emote">No emote rollups for this minute.</p>
      )}

      <div
        className={`pulse-moments__inspector-kpi-row${showScore ? ' pulse-moments__inspector-kpi-row--session' : ''}`}
      >
        <div className="pulse-moments__inspector-stat pulse-moments__inspector-stat--emote">
          <small>Total emote uses</small>
          <strong>{totalEmotes != null ? compact(totalEmotes) : '—'}</strong>
        </div>
        <div className="pulse-moments__inspector-stat">
          <small>Chat / min</small>
          <strong>{formatChatRate(moment.chatPerMin)}</strong>
        </div>
        <div className="pulse-moments__inspector-stat pulse-moments__inspector-stat--high">
          <small>Viewer change</small>
          <strong>{viewerDisplay}</strong>
        </div>
        {showScore ? (
          <div className="pulse-moments__inspector-stat pulse-moments__inspector-stat--mid" title={REACTION_SCORE_TOOLTIP}>
            <small>Reaction score</small>
            <strong>{formatReactionScore(moment.score)}</strong>
          </div>
        ) : null}
      </div>

      {activityBadge ? (
        <p className="pulse-moments__inspector-spike-label">
          <span className="pulse-moments__peak-badge">{activityBadge}</span>
        </p>
      ) : null}
    </div>
  )
}

export function FigmaMomentInspector({
  moment,
  vodId,
  momentHref,
  sessionHref,
  emoteLookup,
  channel: _channel,
  liveChannels = [],
  variant = 'default',
  channelLive,
}: FigmaMomentInspectorProps) {
  const labels = useCommandCenterLabels()
  const isLive = variant === 'pulse-live'

  if (!moment) {
    return (
      <aside
        className={`figma-panel figma-panel--inspector figma-panel--empty${isLive ? ' pulse-moments__inspector' : ''}`}
        aria-label={labels.inspector}
      >
        <header><h3>{labels.inspector}</h3></header>
        <p className="muted">Select a reacted minute to inspect backend scoring and VOD jump targets.</p>
      </aside>
    )
  }

  const resolvedVodId = moment.vodId ?? vodId
  const vodHref = resolvedVodId ? buildVodTimestampUrl(resolvedVodId, moment.offsetSeconds) : undefined
  const vodPartial = (moment.vodState ?? '').toLowerCase() === 'partial'
  const openMomentHref = momentHref ?? moment.href
  const vodStateDisplay = vodStateLabel(moment.vodState, channelLive)
  const timeLabel = momentWallClockLabel(moment, liveChannels)
  const category = moment.category?.trim()

  return (
    <aside
      className={`figma-panel figma-panel--inspector${isLive ? ' pulse-moments__inspector pulse-moments__inspector--live pulse-moments__inspector--compact' : ''}`}
      aria-label={labels.inspector}
    >
      <header className="pulse-moments__inspector-head pulse-moments__inspector-head--split">
        <h3>{labels.inspector}</h3>
        <div className="pulse-moments__inspector-time-badge">
          <span className="pulse-moments__inspector-time-badge-primary">{timeLabel.primary}</span>
          {timeLabel.secondary ? (
            <span className="pulse-moments__inspector-time-badge-secondary">{timeLabel.secondary}</span>
          ) : null}
          {isLive ? (
            <p className="pulse-moments__inspector-moment-head">
              <strong>{moment.label}</strong>
              {category ? <span className="pulse-moments__inspector-game"> · {category}</span> : null}
            </p>
          ) : (
            <p className="pulse-moments__inspector-moment-head">
              <strong>{moment.label}</strong>
            </p>
          )}
        </div>
      </header>

      <InspectorHero
        moment={moment}
        emoteLookup={emoteLookup}
        liveChannels={liveChannels}
        showScore={!isLive}
      />

      {!isLive ? (
        <dl className="figma-inspector__grid figma-inspector__grid--detail">
          <div>
            <dt>Data conf.</dt>
            <dd title={ROLLUP_CONFIDENCE_TITLE}>
              {moment.confidence ?? '—'}
              {moment.confidence != null ? (
                <InfoAffordance description={ROLLUP_CONFIDENCE_TITLE} label="What does data confidence mean?" />
              ) : null}
            </dd>
          </div>
          <div><dt>Top emote</dt><dd>{moment.topEmoteCode ?? '—'}</dd></div>
          <div><dt>VOD state</dt><dd>{vodStateDisplay}</dd></div>
        </dl>
      ) : null}

      <div className={`figma-inspector__actions${isLive ? ' pulse-moments__inspector-actions--compact' : ''}`}>
        {openMomentHref ? (
          <Link className="hub-openbtn" to={openMomentHref}>
            View moment
          </Link>
        ) : null}
        {vodHref ? (
          <a className="hub-openbtn hub-openbtn--ghost" href={vodHref} target="_blank" rel="noreferrer">
            {vodPartial ? 'Jump to partial VOD' : 'Jump to VOD'}
          </a>
        ) : (
          <span className="hub-openbtn hub-openbtn--disabled" aria-disabled="true">
            {channelLive === false ? 'No VOD indexed yet' : 'Live tracking only'}
          </span>
        )}
        {sessionHref ? (
          <Link className="hub-openbtn hub-openbtn--accent" to={sessionHref}>
            <BarChart3 size={13} strokeWidth={2.25} aria-hidden="true" />
            {analyticsActionLabel('recent-session')}
          </Link>
        ) : null}
      </div>
    </aside>
  )
}
