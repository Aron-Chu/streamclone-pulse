import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronLeft, ChevronRight, MessageSquare, Radio, TrendingUp } from 'lucide-react'
import {
  compareMomentsChronologically,
  momentRowKey,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from '../../../lib/figmaSessionAnalytics'
import { buildEmoteLookupFromMoments, enrichPulseMomentRows } from '../../../lib/pulseMomentRow'
import {
  capNewKeysPerPoll,
  classifyMomentWindow,
  dedupeMomentsByLogin,
  partitionMomentWindow,
  resolveMomentAtMs,
  type LiveWireMetricComparison,
} from '../../../lib/liveWire'
import { resolveMomentEmote } from '../../../lib/pulseMomentsUtils'
import type { PublicHub, PublicHubLoadSource } from '../../../lib/publicHub'
import { isHubNetworkDegraded } from '../../../lib/hubUiState'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { displayName, compact } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { Avatar } from '../hub/primitives'
import { isLifecycleMomentKind } from '../../../lib/poolWireReducer'

const LIVE_WINDOW_MS = 30 * 60 * 1000
const LATEST_VERIFIED_WINDOW_MS = 24 * 60 * 60 * 1000
const VISIBLE_CAP_LIVE = 12
const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const MAX_NEW_ANIMATIONS_PER_POLL = 3

const EMPTY_REASONS: Record<string, string> = {
  no_qualifying_session: 'No tracked stream has a qualifying breakout in the last 30 minutes.',
  store_unavailable: 'Analytics storage is unavailable. Live breakouts will return after recovery.',
  stream_unavailable: 'The selected live stream could not be loaded.',
  rollup_unavailable: 'Minute activity is still warming up for the tracking pool.',
  insufficient_peaks: 'Activity is flowing, but no qualifying breakout occurred in the last 30 minutes.',
}

export interface HubLiveWireFeedProps {
  hub: PublicHub
  feed: LivePulseMomentsResult
  activityWindow?: string
  loading?: boolean
  hubEndpointOk?: boolean
  loadSource?: PublicHubLoadSource
  layout?: 'lane' | 'rail'
  titleId?: string
  pollSequence?: number
  selectedMomentKey?: string | null
  /** Select the corresponding Global Activity bucket without nesting links. */
  onSelectMoment?: (moment: FigmaMomentRow) => void
  /** Fail-closed proof that this real moment resolves to a currently loaded chart bucket. */
  canSelectMoment?: (moment: FigmaMomentRow) => boolean
}

function kindMeta(kind: string | undefined): { label: string; icon: ReactNode; preferred: 'chat' | 'emotes' } {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'chat_spike') {
    return { label: 'Chat breakout', icon: <MessageSquare aria-hidden="true" />, preferred: 'chat' }
  }
  if (
    normalized === 'emotes' || normalized === 'emote' ||
    normalized === 'emote_spike' || normalized === 'seventv'
  ) {
    return { label: 'Emote breakout', icon: <TrendingUp aria-hidden="true" />, preferred: 'emotes' }
  }
  return { label: 'Activity breakout', icon: <Activity aria-hidden="true" />, preferred: 'emotes' }
}

function relativeTime(at: number | undefined, now: number): string {
  if (at == null || !Number.isFinite(at) || at <= 0) return ''
  const ms = at > 1e12 ? at : at * 1000
  const deltaSec = Math.max(0, Math.round((now - ms) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  return `${Math.round(deltaSec / 60)}m ago`
}

function strengthLabel(score: number | undefined): string | null {
  if (score == null || !Number.isFinite(score) || score <= 0) return null
  const bounded = Math.round(Math.max(0, Math.min(100, score)))
  const label = bounded >= 75 ? 'Strong' : bounded >= 50 ? 'Notable' : 'Emerging'
  return `${label} · ${bounded}/100`
}

function metricFact(label: string, metric: LiveWireMetricComparison | undefined): string | null {
  if (!metric) return null
  const current = metric.currentPerMin
  if (metric.state === 'new_activity' && current != null) {
    return `${label} ${compact(current)}/min · new from a zero earlier baseline`
  }
  if (metric.state !== 'ready' || current == null) return null
  if (metric.multiplier != null) {
    const multiplier = metric.multiplier.toFixed(metric.multiplier >= 10 ? 0 : 1)
    return `${label} ${compact(current)}/min · ${multiplier}× this stream's earlier average`
  }
  if (metric.changePct != null) {
    return `${label} ${compact(current)}/min · ${metric.changePct > 0 ? '+' : ''}${Math.round(metric.changePct)}% versus earlier`
  }
  if (metric.absoluteDeltaPerMin != null) {
    return `${label} ${compact(current)}/min · ${metric.absoluteDeltaPerMin > 0 ? '+' : ''}${compact(metric.absoluteDeltaPerMin)}/min versus earlier`
  }
  return `${label} ${compact(current)}/min`
}

function observedMetricFact(
  label: 'Chat' | 'Emotes',
  observedPerMin: number | undefined,
  metric: LiveWireMetricComparison | undefined,
): string | null {
  const comparisonFact = metricFact(label, metric)
  if (comparisonFact) return comparisonFact
  if (observedPerMin == null || !Number.isFinite(observedPerMin) || observedPerMin <= 0) return null
  const reason = metric?.state === 'warming'
    ? 'earlier baseline warming'
    : metric?.state === 'partial'
      ? 'earlier baseline partial'
      : 'earlier comparison unavailable'
  return `${label} ${compact(observedPerMin)}/min · ${reason}`
}

function observedFacts(moment: FigmaMomentRow, preferred: 'chat' | 'emotes'): string[] {
  const comparison = moment.comparison
  const facts = {
    chat: observedMetricFact('Chat', moment.chatPerMin, comparison?.chat),
    emotes: observedMetricFact('Emotes', moment.emotesPerMin, comparison?.emotes),
  }
  const ordered = preferred === 'emotes' ? [facts.emotes, facts.chat] : [facts.chat, facts.emotes]
  const present = ordered.filter((fact): fact is string => Boolean(fact))
  return present.length > 0 ? present : ['Activity observed · earlier comparison unavailable']
}

function evidenceLabel(moment: FigmaMomentRow): string {
  const comparison = moment.comparison
  if (!comparison) return moment.source === 'live_irc' ? 'IRC measured · comparison unavailable' : 'Comparison unavailable'
  const evidence = comparison.evidence
  return `Earlier baseline ${evidence.baselineMeasuredMinutes}/${evidence.baselineExpectedMinutes} min · ${Math.round(evidence.baselineCoveragePct)}% coverage`
}

function LiveWireScroller({
  children,
  ariaLabel = 'Live breakouts from the last 30 minutes',
}: {
  children: ReactNode
  ariaLabel?: string
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const updateButtons = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setCanPrev(viewport.scrollLeft > 2)
    setCanNext(viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth - 2)
  }, [])

  const step = useCallback((multiplier: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const card = viewport.querySelector<HTMLElement>('.hub-live-wire__event-card')
    viewport.scrollBy({
      left: (card ? card.getBoundingClientRect().width + 8 : 280) * multiplier,
      behavior: 'smooth',
    })
  }, [])

  useEffect(() => updateButtons(), [children, updateButtons])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateButtons)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [updateButtons])

  return (
    <div className="hub-live-wire__ticker-scroller">
      <button type="button" className="hub-live-wire__ticker-nav" aria-label="Scroll Live Wire left" disabled={!canPrev} onClick={() => step(-1)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div
        className="hub-live-wire__ticker-viewport"
        ref={viewportRef}
        onScroll={updateButtons}
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
      >
        <div className="hub-live-wire__ticker-track">{children}</div>
      </div>
      <button type="button" className="hub-live-wire__ticker-nav" aria-label="Scroll Live Wire right" disabled={!canNext} onClick={() => step(1)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function HubLiveWireFeed({
  hub,
  feed,
  loading = false,
  hubEndpointOk,
  loadSource,
  layout = 'lane',
  titleId = 'hub-live-wire-title',
  pollSequence = 0,
  selectedMomentKey = null,
  onSelectMoment,
  canSelectMoment,
}: HubLiveWireFeedProps) {
  const { animateEnterHorizontal } = useAnalyticsMotion()
  const hubDegraded = isHubNetworkDegraded(loadSource, hubEndpointOk)
  const isLiveNetwork = feed.source === 'network' && !hubDegraded
  const healthyFullNetwork = feed.source === 'network' && loadSource === 'full' && hubEndpointOk === true
  const [now, setNow] = useState(() => Date.now())
  const [activeNewKeys, setActiveNewKeys] = useState<Set<string>>(new Set())

  const profileImageByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const channel of hub.liveChannels) {
      if (channel.profileImageUrl) map.set(channel.login.toLowerCase(), channel.profileImageUrl)
    }
    return map
  }, [hub.liveChannels])

  const categoryByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const channel of hub.liveChannels) {
      const category = channel.category?.trim()
      if (category) map.set(channel.login.toLowerCase(), category)
    }
    return map
  }, [hub.liveChannels])

  const candidates = useMemo(() => {
    const peakOnly = feed.moments.filter((moment) => !isLifecycleMomentKind(moment.kind))
    return enrichPulseMomentRows(peakOnly, { liveChannels: hub.liveChannels, categoryByLogin })
  }, [categoryByLogin, feed.moments, hub.liveChannels])

  const momentWindow = useMemo(
    () => partitionMomentWindow(candidates, now, LIVE_WINDOW_MS),
    [candidates, now],
  )

  const liveMoments = useMemo(() => {
    return dedupeMomentsByLogin(
      [...momentWindow.live].sort(compareMomentsChronologically),
      VISIBLE_CAP_LIVE,
      DEDUPE_WINDOW_MS,
    )
  }, [momentWindow.live])

  const latestVerifiedMoment = useMemo(() => {
    if (!healthyFullNetwork || liveMoments.length > 0) return null
    return [...momentWindow.older]
      .filter((moment) => {
        const at = resolveMomentAtMs(moment.at)
        return at != null && now - at <= LATEST_VERIFIED_WINDOW_MS
      })
      .sort(compareMomentsChronologically)[0] ?? null
  }, [healthyFullNetwork, liveMoments.length, momentWindow.older, now])

  const emoteLookup = useMemo(
    () => buildEmoteLookupFromMoments(
      latestVerifiedMoment ? [...liveMoments, latestVerifiedMoment] : liveMoments,
      hub.topEmotes,
    ),
    [hub.topEmotes, latestVerifiedMoment, liveMoments],
  )

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

  useLayoutEffect(() => {
    const moments = liveMomentsRef.current
    const liveKeys = moments.map(momentRowKey)
    if (!healthyFullNetwork) {
      liveKeys.forEach((key) => prevSeenRef.current.add(key))
      setActiveNewKeys(new Set())
      return
    }
    if (!hasBaselinedRef.current) {
      hasBaselinedRef.current = true
      liveKeys.forEach((key) => prevSeenRef.current.add(key))
      setActiveNewKeys(new Set())
      return
    }
    const freshUnseen = moments.filter(
      (moment) => !prevSeenRef.current.has(momentRowKey(moment)) &&
        classifyMomentWindow(moment.at, nowRef.current, LIVE_WINDOW_MS) === 'live',
    )
    const animationKeys = capNewKeysPerPoll(
      prevSeenRef.current,
      moments.map((moment) => ({ key: momentRowKey(moment), at: moment.at })),
      nowRef.current,
      LIVE_WINDOW_MS,
      MAX_NEW_ANIMATIONS_PER_POLL,
    )
    newKeysRef.current = new Set([...newKeysRef.current, ...freshUnseen.map(momentRowKey)])
    setActiveNewKeys(animationKeys)
    liveKeys.forEach((key) => prevSeenRef.current.add(key))
    for (const key of animationKeys) {
      const element = rowRefs.current.get(key)
      if (element) animateEnterHorizontal(element, { from: 'left' })
    }
  }, [animateEnterHorizontal, healthyFullNetwork, pollSequence])

  const metaLabel = isLiveNetwork
    ? 'last 30m · compared with earlier in each stream'
    : hubDegraded
      ? 'live network feed paused'
      : 'snapshot · not live network cadence'
  const emptyReason = hubDegraded
    ? 'Live comparisons need a healthy hub connection. The chart remains available from the last truthful snapshot.'
    : (feed.reason && EMPTY_REASONS[feed.reason]) || 'No qualifying breakout occurred in the last 30 minutes.'

  const renderCard = (moment: FigmaMomentRow, historical = false) => {
    const key = momentRowKey(moment)
    const login = moment.login ?? ''
    const name = displayName(login, moment.displayName)
    const kind = kindMeta(moment.kind)
    const timeLabel = relativeTime(moment.at, now)
    const facts = observedFacts(moment, kind.preferred)
    const strength = strengthLabel(moment.score)
    const category = moment.category?.trim() || categoryByLogin.get(login.toLowerCase())
    const profileImageUrl = moment.profileImageUrl ?? profileImageByLogin.get(login.toLowerCase())
    const isSelected = selectedMomentKey === key
    const isNew = !historical && healthyFullNetwork && newKeysRef.current.has(key) &&
      classifyMomentWindow(moment.at, now, LIVE_WINDOW_MS) === 'live'
    const isEntering = !historical && activeNewKeys.has(key)
    const href = moment.href ?? (login
      ? `/analytics/${encodeURIComponent(login)}${moment.streamId ? `/${encodeURIComponent(moment.streamId)}` : ''}`
      : '/analytics')
    const topEmote = moment.topEmotes?.[0]
    const resolvedEmote = topEmote
      ? resolveMomentEmote({ ...moment, topEmotes: [topEmote] }, emoteLookup)
      : null
    const ref = (element: HTMLElement | null) => {
      if (element) rowRefs.current.set(key, element)
      else rowRefs.current.delete(key)
    }
    const content = (
      <>
        <span className="hub-live-wire__event-head">
          <Avatar login={login} src={profileImageUrl} alt="" className="hub-live-wire__event-avatar" />
          <span className="hub-live-wire__event-identity"><strong>{name}</strong><small>{category || 'Live stream'}</small></span>
          {timeLabel ? <time className="hub-live-wire__event-time">{timeLabel}</time> : null}
        </span>
        <span className="hub-live-wire__event-body">
          <span className="hub-live-wire__event-kind">
            {kind.icon}{historical ? 'Latest verified · ' : ''}{kind.label}
          </span>
          <span className="hub-live-wire__event-metrics">
            {facts.map((fact) => <span key={fact} className="hub-live-wire__event-fact">{fact}</span>)}
          </span>
        </span>
        <span className="hub-live-wire__event-foot">
          <span className="hub-live-wire__event-evidence">{evidenceLabel(moment)}</span>
          {topEmote ? (
            <span className="hub-live-wire__event-emote" aria-label={`Top emote ${topEmote.name}`}>
              <EmoteImg src={resolvedEmote?.imageUrl ?? topEmote.imageUrl} name={topEmote.name ?? '?'} />
              <span>{topEmote.name}</span>
            </span>
          ) : null}
          {strength ? (
            <span className="hub-live-wire__event-strength" title="Backend-weighted breakout strength. This is not a probability, viewer count, or quality rating.">
              {strength}
            </span>
          ) : null}
          {isNew ? <span className="hub-live-wire__event-new">NEW</span> : null}
        </span>
      </>
    )
    const className = `hub-live-wire__event-card${historical ? ' is-historical' : ''}${isSelected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${isEntering ? ' is-entering' : ''}`
    const ariaLabel = `${historical ? 'Latest verified historical detection. ' : ''}${name}, ${kind.label}, ${facts.join('. ')}${timeLabel ? `, ${timeLabel}` : ''}. ${evidenceLabel(moment)}`
    // A chart-selection button is only truthful when the page owner proves
    // that this exact moment resolves to a bucket in the currently rendered
    // activity model. Otherwise use the canonical analytics destination; a
    // highlighted button that cannot move the chart is misleading.
    const canInspect = Boolean(onSelectMoment && canSelectMoment?.(moment) === true)
    return canInspect ? (
      <button
        key={key}
        type="button"
        className={className}
        aria-label={`${ariaLabel}. Show this minute on the activity chart.`}
        aria-pressed={isSelected}
        ref={ref}
        onClick={() => onSelectMoment?.(moment)}
      >
        {content}
      </button>
    ) : (
      <Link key={key} to={href} className={className} aria-label={`${ariaLabel}. Open analytics.`} ref={ref}>{content}</Link>
    )
  }

  const cards = liveMoments.map((moment) => renderCard(moment))
  const historicalCard = latestVerifiedMoment ? renderCard(latestVerifiedMoment, true) : null
  const feedBody = loading && liveMoments.length === 0 && !historicalCard ? (
    layout === 'rail'
      ? <div className="hub-live-wire__rail-list">{Array.from({ length: 3 }).map((_, index) => <span key={index} className="hub-live-wire__event-card is-skeleton" aria-hidden="true" />)}</div>
      : <LiveWireScroller>{Array.from({ length: 3 }).map((_, index) => <span key={index} className="hub-live-wire__event-card is-skeleton" aria-hidden="true" />)}</LiveWireScroller>
  ) : liveMoments.length === 0 && historicalCard ? (
    <div className={`hub-live-wire__quiet hub-live-wire__quiet--${layout}`}>
      <div className="hub-live-wire__quiet-status" role="status">
        <Activity aria-hidden="true" />
        <span><strong>Quiet now</strong><small>{emptyReason}</small></span>
      </div>
      {layout === 'rail'
        ? <div className="hub-live-wire__rail-list">{historicalCard}</div>
        : <LiveWireScroller ariaLabel="Latest verified historical detection">{historicalCard}</LiveWireScroller>}
    </div>
  ) : liveMoments.length === 0 ? (
    <div className={`hub-live-wire__empty hub-live-wire__empty--${layout}`} role="status"><Activity aria-hidden="true" /><span>{emptyReason}</span></div>
  ) : layout === 'rail' ? (
    <div className="hub-live-wire__rail-list">{cards.slice(0, 3)}</div>
  ) : (
    <LiveWireScroller>{cards}</LiveWireScroller>
  )

  return (
    <section className={`hub-live-wire hub-live-wire--${layout}`} aria-labelledby={titleId} aria-busy={loading || undefined}>
      <header className="hub-live-wire__head">
        <h2 id={titleId} className="hub-live-wire__title"><Radio aria-hidden="true" />Live Wire</h2>
        <span className="hub-live-wire__meta">{metaLabel}</span>
      </header>
      {hubDegraded ? <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">{emptyReason}</p> : null}
      {!hubDegraded && !isLiveNetwork && feed.banner ? <p className="hub-live-wire__banner" role="status">{feed.banner}</p> : null}
      {feedBody}
      <p className="hub-live-wire__explain">
        Live Wire compares a detected minute with measured history earlier in the same broadcast. Missing comparison evidence is labeled—not estimated in the browser.
      </p>
    </section>
  )
}
