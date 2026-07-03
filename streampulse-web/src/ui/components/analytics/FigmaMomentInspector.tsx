import { Fragment, useId, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import type { HubEmote } from '../../../lib/publicHub'
import { buildVodTimestampUrl, formatOffsetLabel } from '../../../lib/figmaSessionAnalytics'
import {
  momentEmoteTitle,
  momentHasEmoteRollups,
  resolveMomentEmote,
  ROLLUP_CONFIDENCE_TITLE,
  sourceLabel,
  vodStateLabel,
} from '../../../lib/pulseMomentsUtils'
import { compact, initial, providerLabel } from './hubFormat'
import { formatChatRate, formatReactionScore, formatViewerDelta, REACTION_SCORE_TOOLTIP } from '../../../lib/momentMetricLabels'
import type { MomentChannelContext } from './MostReactedMinutesTable'

export interface FigmaMomentInspectorProps {
  moment?: FigmaMomentRow | null
  vodId?: string
  momentHref?: string
  sessionHref?: string
  emoteLookup?: Map<string, HubEmote>
  channel?: MomentChannelContext
  variant?: 'default' | 'pulse-live'
}

function InspectorEmoteImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="pulse-moments__inspector-top-emote-fallback" aria-hidden="true">
        {initial(name)}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
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

export function MomentContextSpans({ moment }: { moment: FigmaMomentRow }) {
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

  const vod = vodStateLabel(moment.vodState)
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

export function FigmaMomentInspector({
  moment,
  vodId,
  momentHref,
  sessionHref,
  emoteLookup,
  channel: _channel,
  variant = 'default',
}: FigmaMomentInspectorProps) {
  const isLive = variant === 'pulse-live'

  if (!moment) {
    return (
      <aside
        className={`figma-panel figma-panel--inspector figma-panel--empty${isLive ? ' pulse-moments__inspector' : ''}`}
        aria-label="Moment inspector"
      >
        <header><h3>Moment inspector</h3></header>
        <p className="muted">Select a reacted minute to inspect backend scoring and VOD jump targets.</p>
      </aside>
    )
  }

  const resolvedVodId = moment.vodId ?? vodId
  const vodHref = resolvedVodId ? buildVodTimestampUrl(resolvedVodId, moment.offsetSeconds) : undefined
  const hasEmotes = momentHasEmoteRollups(moment)
  const emote = hasEmotes ? resolveMomentEmote(moment, emoteLookup ?? new Map()) : null
  const emoteTitle = emote ? momentEmoteTitle(emote) : ''
  const vodPartial = (moment.vodState ?? '').toLowerCase() === 'partial'
  const openMomentHref = momentHref ?? moment.href
  const vodStateDisplay = vodStateLabel(moment.vodState)

  return (
    <aside
      className={`figma-panel figma-panel--inspector${isLive ? ' pulse-moments__inspector pulse-moments__inspector--live pulse-moments__inspector--compact' : ''}`}
      aria-label="Moment inspector"
    >
      <header className="pulse-moments__inspector-head">
        <h3>Moment inspector</h3>
      </header>
      {isLive ? (
        emote ? (
          <div
            className={`pulse-moments__inspector-top-emote${emote.imageUnavailable ? ' pulse-moments__inspector-top-emote--text-only' : ''}`}
            title={emoteTitle}
          >
            <span className="pulse-moments__inspector-top-emote-label">Top emote this minute</span>
            {emote.imageUrl ? (
              <InspectorEmoteImage src={emote.imageUrl} name={emote.name} />
            ) : (
              <span className="pulse-moments__inspector-top-emote-fallback" aria-hidden="true">
                {initial(emote.name)}
              </span>
            )}
            <span className="pulse-moments__inspector-top-emote-name">{emote.name}</span>
            {emote.provider ? <small>{providerLabel(emote.provider)}</small> : null}
            {emote.count != null ? <strong>{compact(emote.count)}</strong> : null}
            <InfoAffordance description={emoteTitle} label={`Emote details for ${emote.name}`} />
          </div>
        ) : (
          <p className="muted pulse-moments__inspector-empty-emote">No emote rollups for this minute.</p>
        )
      ) : (
        <>
          <div className="figma-inspector__time">{formatOffsetLabel(moment.offsetSeconds)}</div>
          <p className="figma-inspector__label">{moment.label}</p>
          <dl className="figma-inspector__grid">
            <div><dt title={REACTION_SCORE_TOOLTIP}>Score</dt><dd>{formatReactionScore(moment.score)}</dd></div>
            <div><dt>Chat / min</dt><dd>{formatChatRate(moment.chatPerMin)}</dd></div>
            <div><dt>Viewer Δ</dt><dd>{formatViewerDelta(moment.viewerDelta)}</dd></div>
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
        </>
      )}
      <div className={`figma-inspector__actions${isLive ? ' pulse-moments__inspector-actions--compact' : ''}`}>
        {openMomentHref ? (
          <Link className="hub-openbtn" to={openMomentHref}>
            Open moment
          </Link>
        ) : null}
        {vodHref ? (
          <a className="hub-openbtn hub-openbtn--ghost" href={vodHref} target="_blank" rel="noreferrer">
            {vodPartial ? 'Jump to partial VOD' : 'Jump to VOD'}
          </a>
        ) : (
          <span className="hub-openbtn hub-openbtn--disabled" aria-disabled="true">
            Live IRC only
          </span>
        )}
        {sessionHref ? (
          <Link className="hub-openbtn hub-openbtn--ghost" to={sessionHref}>
            Open session
          </Link>
        ) : null}
      </div>
    </aside>
  )
}
