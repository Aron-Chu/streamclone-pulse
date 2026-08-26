import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronDown, Radio } from 'lucide-react'
import {
  compareMomentsChronologically,
  momentRowKey,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from '../../../lib/figmaSessionAnalytics'
import {
  buildEmoteLookupFromMoments,
  enrichPulseMomentRows,
} from '../../../lib/pulseMomentRow'
import {
  capNewKeysPerPoll,
  classifyMomentWindow,
  dedupeMomentsByLogin,
  partitionMomentWindow,
} from '../../../lib/liveWire'
import { resolveMomentActions } from '../../../lib/momentActions'
import { resolveMomentEmote } from '../../../lib/pulseMomentsUtils'
import type { PublicHub, PublicHubLoadSource } from '../../../lib/publicHub'
import { isHubNetworkDegraded } from '../../../lib/hubUiState'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { displayName, compact } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { Avatar } from '../hub/primitives'
import { isLifecycleMomentKind } from '../../../lib/poolWireReducer'
import { MetricComparison } from './AnalyticsTruthPrimitives'

const LIVE_WINDOW_MS = 30 * 60 * 1000
const VISIBLE_CAP_LIVE = 10
const VISIBLE_CAP_OLDER = 12
const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const MAX_NEW_ANIMATIONS_PER_POLL = 3
const LIVE_WIRE_QUIET_EMPTY = 'No network breakouts in the live window right now'

const EMPTY_REASONS: Record<string, string> = {
  no_qualifying_session:
    'No live channel currently qualifies. Peaks appear once tracked rooms have enough chat activity.',
  store_unavailable: 'Analytics store unavailable — live moments will return when storage recovers.',
  stream_unavailable: 'The picked live stream could not be loaded.',
  rollup_unavailable: 'Minute activity is still warming up for the tracking pool.',
  insufficient_peaks:
    'Activity is flowing but no peaks were detected yet. Give the stream a few minutes.',
}

export interface HubLiveWireFeedProps {
  hub: PublicHub
  feed: LivePulseMomentsResult
  activityWindow?: string
  loading?: boolean
  hubEndpointOk?: boolean
  loadSource?: PublicHubLoadSource
  layout?: 'section' | 'ticker' | 'rail'
  titleId?: string
  pollSequence?: number
  /** Select the corresponding Global Activity bucket without nesting links. */
  onSelectMoment?: (moment: FigmaMomentRow) => void
}

interface WireHeaderProps {
  titleId: string
  metaLabel: string
}

function WireHeader({ titleId, metaLabel }: WireHeaderProps) {
  return (
    <header className="hub-live-wire__head">
      <h2 id={titleId} className="hub-live-wire__title">
        <Radio aria-hidden="true" />
        Live Wire
      </h2>
      <span className="hub-live-wire__meta">{metaLabel}</span>
    </header>
  )
}

function relativeTime(at: number | undefined, now: number): string {
  if (at == null || !Number.isFinite(at) || at <= 0) return ''
  const ms = at > 1e12 ? at : at * 1000
  const deltaSec = Math.max(0, Math.round((now - ms) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

function breakoutStrengthLabel(score: number | undefined): string | null {
  if (score == null || !Number.isFinite(score) || score <= 0) return null
  return `Breakout strength ${Math.round(Math.max(0, Math.min(100, score)))}/100`
}

function eventComparisonFact(moment: FigmaMomentRow): string | null {
  const comparison = moment.comparison
  if (!comparison) return null
  const emotes = comparison.emotes
  if (emotes.state === 'new_activity') return `Emotes reached ${compact(emotes.currentPerMin ?? 0)}/min from a zero earlier baseline`
  if (emotes.state === 'ready' && emotes.multiplier != null) return `Emotes reached ${compact(emotes.currentPerMin ?? 0)}/min · ${emotes.multiplier.toFixed(emotes.multiplier >= 10 ? 0 : 1)}× this stream's earlier average`
  const chat = comparison.chat
  if (chat.state === 'new_activity') return `Chat reached ${compact(chat.currentPerMin ?? 0)}/min from a zero earlier baseline`
  if (chat.state === 'ready' && chat.changePct != null) return `Chat reached ${compact(chat.currentPerMin ?? 0)}/min · ${chat.changePct > 0 ? '+' : ''}${Math.round(chat.changePct)}% versus this stream's earlier average`
  return null
}

export function HubLiveWireFeed({
  hub,
  feed,
  loading = false,
  hubEndpointOk,
  loadSource,
  layout = 'rail',
  titleId = 'hub-live-wire-title',
  pollSequence = 0,
  onSelectMoment,
}: HubLiveWireFeedProps) {
  const isRail = layout === 'rail'
  const { animateEnterHorizontal, motionEnabled } = useAnalyticsMotion()
  const hubDegraded = isHubNetworkDegraded(loadSource, hubEndpointOk)
  const isLiveNetwork = feed.source === 'network' && !hubDegraded
  /** Hard gate: a moment may only be NEW on a healthy full network feed. */
  const healthyFullNetwork = feed.source === 'network' && loadSource === 'full' && hubEndpointOk === true

  const [now, setNow] = useState(() => Date.now())
  const [showOlder, setShowOlder] = useState(false)
  const [activeNewKeys, setActiveNewKeys] = useState<Set<string>>(new Set())

  const profileImageByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const ch of hub.liveChannels) {
      if (ch.profileImageUrl) map.set(ch.login.toLowerCase(), ch.profileImageUrl)
    }
    return map
  }, [hub.liveChannels])

  const categoryByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const ch of hub.liveChannels) {
      const category = ch.category?.trim()
      if (category) map.set(ch.login.toLowerCase(), category)
    }
    return map
  }, [hub.liveChannels])

  const enrichCtx = useMemo(
    () => ({ liveChannels: hub.liveChannels, categoryByLogin }),
    [categoryByLogin, hub.liveChannels],
  )

  // Valid retained candidates — NO 30m pre-filter. Older moments appear in the
  // "Recent detections" disclosure, not dropped.
  const candidates = useMemo(() => {
    const peakOnly = feed.moments.filter((m) => !isLifecycleMomentKind(m.kind))
    return enrichPulseMomentRows(peakOnly, enrichCtx)
  }, [enrichCtx, feed.moments])

  const { liveMoments, olderMoments } = useMemo(() => {
    // Both sections share the same validator so missing/future timestamps can
    // never leak into one section while being rejected from the other.
    const { live, older } = partitionMomentWindow(candidates, now, LIVE_WINDOW_MS)
    const sortDesc = (rows: FigmaMomentRow[]) =>
      [...rows].sort(compareMomentsChronologically)
    return {
      liveMoments: dedupeMomentsByLogin(sortDesc(live), VISIBLE_CAP_LIVE, DEDUPE_WINDOW_MS),
      olderMoments: dedupeMomentsByLogin(sortDesc(older), VISIBLE_CAP_OLDER, DEDUPE_WINDOW_MS),
    }
  }, [candidates, now])

  const emoteLookup = useMemo(
    () => buildEmoteLookupFromMoments(candidates, hub.topEmotes),
    [candidates, hub.topEmotes],
  )

  // Incremental NEW tracking — refs persist across renders so we don't re-badge
  // already-seen moments every second.
  const prevSeenRef = useRef<Set<string>>(new Set())
  const newKeysRef = useRef<Set<string>>(new Set())
  const hasBaselinedRef = useRef(false)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())

  const liveMomentsRef = useRef(liveMoments)
  liveMomentsRef.current = liveMoments
  const nowRef = useRef(now)
  nowRef.current = now

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Keyed on pollSequence (the hub poll identity), not the 1-second clock.
  useLayoutEffect(() => {
    const moments = liveMomentsRef.current
    const nowMs = nowRef.current
    const liveKeys = moments.map(momentRowKey)

    if (!healthyFullNetwork) {
      // Cache/degraded: never NEW, never animate, but keep the seen-set intact
      // so a recovered feed doesn't re-badge already-shown moments.
      liveKeys.forEach((k) => prevSeenRef.current.add(k))
      setActiveNewKeys(new Set())
      return
    }

    // Baseline: the first healthy full snapshot seeds the seen-set so the initial
    // state is never a burst of NEW badges / entrance animation.
    if (!hasBaselinedRef.current) {
      hasBaselinedRef.current = true
      liveKeys.forEach((k) => prevSeenRef.current.add(k))
      setActiveNewKeys(new Set())
      return
    }

    const freshUnseen = moments.filter(
      (m) =>
        !prevSeenRef.current.has(momentRowKey(m)) &&
        classifyMomentWindow(m.at, nowMs, LIVE_WINDOW_MS) === 'live',
    )

    // Semantic NEW = all fresh unseen in-window keys; animation = capped subset.
    const animationKeys = capNewKeysPerPoll(
      prevSeenRef.current,
      moments.map((m) => ({ key: momentRowKey(m), at: m.at })),
      nowMs,
      LIVE_WINDOW_MS,
      MAX_NEW_ANIMATIONS_PER_POLL,
    )
    newKeysRef.current = new Set([...newKeysRef.current, ...freshUnseen.map(momentRowKey)])
    setActiveNewKeys(animationKeys)

    // Record current keys as seen (after computing fresh so we don't self-baseline).
    liveKeys.forEach((k) => prevSeenRef.current.add(k))

    // Animate only the newly introduced rows (right-entry). rowRefs are populated
    // by the render that produced `moments`.
    for (const key of animationKeys) {
      const el = rowRefs.current.get(key)
      if (el) animateEnterHorizontal(el, { from: 'right' })
    }
  }, [animateEnterHorizontal, healthyFullNetwork, pollSequence])

  const metaLabel = isLiveNetwork
    ? 'detected in the last 30m · newest first'
    : hubDegraded
      ? 'live network feed paused'
      : 'snapshot — not live network cadence'
  const emptyReason = hubDegraded
    ? 'Live network moments need a healthy hub connection. Showing aggregate stats only until the feed recovers.'
    : (feed.reason && EMPTY_REASONS[feed.reason]) || LIVE_WIRE_QUIET_EMPTY

  const renderCard = (moment: FigmaMomentRow) => {
    const key = momentRowKey(moment)
    const login = moment.login ?? ''
    const name = displayName(login, moment.displayName)
    const category = moment.category?.trim() || categoryByLogin.get(login.toLowerCase())?.trim()
    const actions = resolveMomentActions(moment)
    const isNew =
      healthyFullNetwork &&
      newKeysRef.current.has(key) &&
      partitionMomentWindow([moment], now, LIVE_WINDOW_MS).live.length === 1
    const profileImageUrl = moment.profileImageUrl ?? profileImageByLogin.get(login.toLowerCase())
    const signalLabel = moment.label?.trim() || 'Activity moment'
    const comparisonFact = eventComparisonFact(moment)
    const sourceLabel = moment.source === 'live_irc'
      ? 'IRC measured'
      : moment.source?.trim()
      ? moment.source.split('_').join(' ')
        : null

    const refCb = (el: HTMLElement | null) => {
      if (el) rowRefs.current.set(key, el)
      else rowRefs.current.delete(key)
    }

    return (
      <li role="listitem" key={key}>
        <article
          className={`hub-live-wire__rail-card${isNew ? ' hub-live-wire__card--new' : ''}`}
          ref={refCb as never}
        >
          <div className="hub-live-wire__rail-head">
            <Avatar login={login} src={profileImageUrl} alt="" className="hub-live-wire__rail-av" />
            <span className="hub-live-wire__rail-names">
              <span className="hub-live-wire__rail-name">{name}</span>
              {category ? <span className="hub-live-wire__rail-category">{category}</span> : null}
            </span>
            <span className="hub-live-wire__rail-age">{relativeTime(moment.at, now)}</span>
          </div>

          <div className="hub-live-wire__rail-signal" aria-label="Detected event">
            <span>
              <strong>{signalLabel}</strong>
              {comparisonFact ? <small>{comparisonFact}</small> : null}
            </span>
            {breakoutStrengthLabel(moment.score) ? (
              <span
                className="hub-live-wire__rail-score"
                title="Weighted breakout strength from the available chat, emote, and viewer signals; it is not a probability or a viewer total."
                aria-label={`${breakoutStrengthLabel(moment.score)}; weighted breakout strength, not a probability or viewer total`}
              >
                {breakoutStrengthLabel(moment.score)}
              </span>
            ) : null}
          </div>

          {moment.comparison ? (
            <div className="hub-live-wire__rail-comparisons">
              <MetricComparison label="Chat" comparison={moment.comparison.chat} tone="chat" compact presentation="percentage" currentLabel="Event minute" baselineLabel="Earlier stream avg" />
              <MetricComparison label="Emotes" comparison={moment.comparison.emotes} tone="emotes" compact presentation="multiplier" currentLabel="Event minute" baselineLabel="Earlier stream avg" />
            </div>
          ) : (
            <div className="hub-live-wire__rail-rates" aria-label="Event rates; earlier stream comparison unavailable">
              <span>Chat <strong>{moment.chatPerMin != null && moment.chatPerMin > 0 ? `${compact(moment.chatPerMin)}/min` : '—'}</strong></span>
              <span>Emotes <strong>{moment.emotesPerMin != null && moment.emotesPerMin > 0 ? `${compact(moment.emotesPerMin)}/min` : '—'}</strong></span>
              <small>Earlier stream comparison unavailable</small>
            </div>
          )}

          {(moment.topEmotes?.length ?? 0) > 0 ? (
            <div className="hub-live-wire__rail-emotes" aria-label="Top emotes">
              {(moment.topEmotes ?? []).slice(0, 3).map((emote, index) => {
                const resolved = resolveMomentEmote(
                  { ...moment, topEmotes: [emote] },
                  emoteLookup,
                )
                return (
                  <span className="hub-live-wire__rail-emote" key={`${emote.name}-${index}`}>
                    <EmoteImg src={resolved?.imageUrl ?? emote.imageUrl} name={emote.name ?? '?'} />
                  </span>
                )
              })}
            </div>
          ) : null}

          <div className="hub-live-wire__rail-evidence" aria-label="Signal evidence">
            {sourceLabel ? <span>{sourceLabel}</span> : null}
            {moment.confidence != null && moment.confidence > 0 ? (
              <span>confidence {moment.confidence}%</span>
            ) : null}
            {moment.viewerDelta ? <span>{moment.viewerDelta}</span> : null}
            {moment.comparison ? (
              <span>
                Event minute vs {moment.comparison.evidence.baselineMeasuredMinutes}/{moment.comparison.evidence.baselineExpectedMinutes} earlier min · {Math.round(moment.comparison.evidence.baselineCoveragePct)}% coverage
              </span>
            ) : null}
            {breakoutStrengthLabel(moment.score) ? (
              <span title="Weighted breakout strength from available signals; a baseline comparison is shown only when supplied by the source.">
                weighted score · {moment.comparison ? 'event comparison available' : 'baseline unavailable'}
              </span>
            ) : null}
            {(() => {
              const missing: string[] = []
              if (moment.chatPerMin == null || moment.chatPerMin <= 0) missing.push('chat rate')
              if (moment.emotesPerMin == null || moment.emotesPerMin <= 0) missing.push('emote rate')
              if (moment.viewers == null || moment.viewers <= 0) missing.push('viewer sample')
              if (!sourceLabel && !(moment.confidence != null && moment.confidence > 0) && !moment.viewerDelta) {
                return <span>Evidence limited · {missing.length > 0 ? `missing ${missing.join(', ')}` : 'baseline comparison unavailable'}</span>
              }
              return missing.length > 0 ? <span>Missing {missing.join(', ')}</span> : null
            })()}
          </div>

          <div className="hub-live-wire__rail-footer">
            {isNew ? <span className="hub-live-wire__rail-new">NEW</span> : null}
            <div className="hub-live-wire__rail-actions">
              {onSelectMoment && moment.at != null ? (
                <button
                  type="button"
                  className="hub-live-wire__action"
                  onClick={() => onSelectMoment(moment)}
                >
                  Inspect this minute
                </button>
              ) : null}
              {actions.analyticsHref ? (
                <Link className="hub-live-wire__action" to={actions.analyticsHref}>
                  View moment
                </Link>
              ) : null}
              {actions.vodHref ? (
                <a className="hub-live-wire__action" href={actions.vodHref} target="_blank" rel="noreferrer">
                  Jump to VOD
                </a>
              ) : null}
              {!actions.analyticsHref && !actions.vodHref ? (
                <span
                  className="hub-live-wire__action hub-live-wire__action--disabled"
                  aria-disabled="true"
                >
                  Live tracking only
                </span>
              ) : null}
            </div>
          </div>
        </article>
      </li>
    )
  }

  const rootClass = `hub-live-wire${isRail ? ' hub-live-wire--rail' : ''}`
  const skeletonCount = 4

  if (loading && liveMoments.length === 0) {
    return (
      <section className={rootClass} aria-labelledby={titleId} aria-busy="true">
        <WireHeader titleId={titleId} metaLabel={metaLabel} />
        <ul role="list" className="hub-live-wire__rail-list">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <li key={i} role="listitem">
              <article className="hub-live-wire__rail-card hub-live-wire__card--skeleton" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className={rootClass} aria-labelledby={titleId}>
      <WireHeader titleId={titleId} metaLabel={metaLabel} />

      {hubDegraded ? (
        <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">
          Live network moments need a healthy hub connection. Showing aggregate stats only until the feed recovers.
        </p>
      ) : null}

      {!hubDegraded && !isLiveNetwork && feed.banner ? (
        <p className="hub-live-wire__banner" role="status">
          {feed.banner}
        </p>
      ) : null}

      {liveMoments.length === 0 && olderMoments.length === 0 ? (
        <div className="hub-live-wire__empty" role="status">
          <Activity aria-hidden="true" />
          <span>{emptyReason}</span>
        </div>
      ) : (
        <>
          {liveMoments.length > 0 ? (
            <>
              <h3 className="hub-live-wire__rail-tier hub-live-wire__rail-tier--live">Live now <span className="hub-live-wire__rail-tier-note">· current 30m window</span></h3>
              <ul role="list" className="hub-live-wire__rail-list">
                {liveMoments.map(renderCard)}
              </ul>
            </>
          ) : null}

          {olderMoments.length > 0 ? (
            <>
              <button
                type="button"
                className="hub-live-wire__disclosure"
                aria-expanded={showOlder}
                onClick={() => setShowOlder((v) => !v)}
              >
                Recent detections <span className="hub-live-wire__rail-tier-note">· earlier than 30m</span>
                <span className="hub-live-wire__disclosure-count">{olderMoments.length}</span>
                <ChevronDown className="hub-live-wire__disclosure-chevron" aria-hidden="true" size={14} />
              </button>
              {showOlder ? (
                <ul role="list" className="hub-live-wire__rail-list">
                  {olderMoments.map(renderCard)}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
