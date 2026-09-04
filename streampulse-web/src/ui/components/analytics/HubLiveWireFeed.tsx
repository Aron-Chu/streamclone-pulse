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
import { Activity, ChevronDown, ChevronLeft, ChevronRight, MessageSquare, Radio, TrendingUp } from 'lucide-react'
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
import {
  buildLiveWireExplorerView,
  type LiveWireExplorerScope,
  type LiveWireExplorerSignal,
  type LiveWireExplorerSort,
} from '../../../lib/liveWireExplorer'
import { resolveMomentEmote } from '../../../lib/pulseMomentsUtils'
import { formatStreamOffset } from '../../../lib/streamcloneAnalytics'
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
  /** Soft-preview the matching chart bucket without locking selection. */
  onPreviewMoment?: (moment: FigmaMomentRow | null) => void
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

function metricPresentation(moment: FigmaMomentRow, preferred: 'chat' | 'emotes') {
  const comparison = preferred === 'chat' ? moment.comparison?.chat : moment.comparison?.emotes
  const current = comparison?.currentPerMin ?? (preferred === 'chat' ? moment.chatPerMin : moment.emotesPerMin)
  const value = current != null && Number.isFinite(current) && current >= 0 ? compact(current) : null
  let comparisonLabel: string | null = null
  if (comparison?.state === 'ready' && comparison.changePct != null && Number.isFinite(comparison.changePct)) {
    const direction = comparison.changePct >= 0 ? '▲' : '▼'
    comparisonLabel = `${direction} ${Math.abs(Math.round(comparison.changePct))}% vs avg`
  } else if (comparison?.state === 'ready' && comparison.multiplier != null && Number.isFinite(comparison.multiplier)) {
    const direction = comparison.multiplier >= 1 ? '▲' : '▼'
    comparisonLabel = `${direction} ${comparison.multiplier.toFixed(comparison.multiplier >= 10 ? 0 : 1)}× vs avg`
  } else if (comparison?.state === 'new_activity') {
    comparisonLabel = 'new activity'
  } else {
    comparisonLabel = 'no baseline'
  }
  return {
    value,
    unit: '/min',
    comparisonLabel,
    hasBaseline: comparison?.state === 'ready',
  }
}

function kindClass(kind: string | undefined): 'emote' | 'chat' | 'viewer' {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'chat_spike') return 'chat'
  if (normalized === 'viewer' || normalized === 'viewer_spike' || normalized === 'viewers') return 'viewer'
  return 'emote'
}

function strengthTier(score: number | undefined): 'strong' | 'notable' | 'emerging' {
  if (score != null && Number.isFinite(score) && score >= 75) return 'strong'
  if (score != null && Number.isFinite(score) && score >= 50) return 'notable'
  return 'emerging'
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
  onPreviewMoment,
}: HubLiveWireFeedProps) {
  const { animateEnterHorizontal } = useAnalyticsMotion()
  const hubDegraded = isHubNetworkDegraded(loadSource, hubEndpointOk)
  const isLiveNetwork = feed.source === 'network' && !hubDegraded
  const healthyFullNetwork = feed.source === 'network' && loadSource === 'full' && hubEndpointOk === true
  const [now, setNow] = useState(() => Date.now())
  const [activeNewKeys, setActiveNewKeys] = useState<Set<string>>(new Set())
  const [explorerScope, setExplorerScope] = useState<LiveWireExplorerScope>('broadcast')
  const [explorerSignal, setExplorerSignal] = useState<LiveWireExplorerSignal>('all')
  const [explorerCategory, setExplorerCategory] = useState('all')
  const [explorerSort, setExplorerSort] = useState<LiveWireExplorerSort>('newest')

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

  const titleByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const channel of hub.liveChannels) {
      const title = channel.title?.trim()
      if (title) map.set(channel.login.toLowerCase(), title)
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

  const broadcastMoments = useMemo(() => {
    return dedupeMomentsByLogin(
      [...momentWindow.live, ...momentWindow.older].sort(compareMomentsChronologically),
      VISIBLE_CAP_LIVE,
      DEDUPE_WINDOW_MS,
    )
  }, [momentWindow.live, momentWindow.older])

  const explorerBaseMoments = explorerScope === 'fresh' ? liveMoments : broadcastMoments
  const explorerView = useMemo(
    () => buildLiveWireExplorerView(explorerBaseMoments, {
      signal: explorerSignal,
      category: explorerCategory,
      sort: explorerSort,
    }),
    [explorerBaseMoments, explorerCategory, explorerSignal, explorerSort],
  )

  useEffect(() => {
    if (
      explorerCategory !== 'all' &&
      !explorerView.categories.some((category) => category.key === explorerCategory)
    ) setExplorerCategory('all')
  }, [explorerCategory, explorerView.categories])

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

  const metaLabel = layout === 'rail'
    ? explorerScope === 'fresh'
      ? 'last 30m · verified breakouts'
      : 'current streams · top detected moments'
    : isLiveNetwork
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
    const normalizedLogin = login.toLowerCase()
    const category = moment.category?.trim() || categoryByLogin.get(normalizedLogin)
    const streamTitle = titleByLogin.get(normalizedLogin)
    const profileImageUrl = moment.profileImageUrl ?? profileImageByLogin.get(normalizedLogin)
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
    const primaryMetric = metricPresentation(moment, kind.preferred)
    const secondaryMetric = metricPresentation(moment, kind.preferred === 'chat' ? 'emotes' : 'chat')
    const tier = strengthTier(moment.score)
    const historicalPrefix = layout === 'rail' ? 'Earlier in stream' : 'Latest verified'
    const scoreWidth = moment.score != null && Number.isFinite(moment.score)
      ? `${Math.max(0, Math.min(100, Math.round(moment.score)))}%`
      : '0%'
    const emotes = (moment.topEmotes ?? []).filter((emote) => emote.name).slice(0, 3)
    const canInspect = Boolean(onSelectMoment && canSelectMoment?.(moment) === true)
    const content = (
      <>
        <span className="hub-live-wire__event-header">
          <Avatar login={login} src={profileImageUrl} alt="" className="hub-live-wire__event-avatar" />
          <span className="hub-live-wire__event-identity">
            <span className="hub-live-wire__event-name">{name}</span>
            <span className="hub-live-wire__event-context">
              {category ? <span className="hub-live-wire__event-category">{category}</span> : null}
              {moment.viewers != null && Number.isFinite(moment.viewers) ? (
                <span className="hub-live-wire__event-viewers">{compact(moment.viewers)} viewers</span>
              ) : null}
            </span>
            {streamTitle ? <span className="hub-live-wire__event-title" title={streamTitle}>{streamTitle}</span> : null}
          </span>
          <span className="hub-live-wire__event-header-badges">
            {isNew ? <span className="hub-live-wire__event-new">NEW</span> : null}
          </span>
          <span className="hub-live-wire__event-time">
            {timeLabel ? <time className="hub-live-wire__event-time-ago">{timeLabel}</time> : null}
            {Number.isFinite(moment.offsetSeconds) ? <span className="hub-live-wire__event-offset">{formatStreamOffset(moment.offsetSeconds)}</span> : null}
          </span>
        </span>
        <span className="hub-live-wire__event-kind-row">
          <span className={`hub-live-wire__event-kind hub-live-wire__event-kind--${kindClass(moment.kind)}`}>
            {historical ? `${historicalPrefix} · ` : ''}{kind.label}
          </span>
          {strength ? (
            <span className={`hub-live-wire__event-score hub-live-wire__event-strength-label--${tier}`}>
              {strength}
            </span>
          ) : null}
        </span>
        <span className={`hub-live-wire__event-metrics hub-live-wire__event-metrics--${kindClass(moment.kind)}`}>
          {primaryMetric.value ? <span className="hub-live-wire__event-metric-value">{primaryMetric.value}</span> : null}
          {primaryMetric.value ? <span className="hub-live-wire__event-metric-unit">{primaryMetric.unit}</span> : null}
          <span className={`hub-live-wire__event-metric-comparison${primaryMetric.hasBaseline ? '' : ' hub-live-wire__event-metric-comparison--no-baseline'}`}>
            {primaryMetric.comparisonLabel}
          </span>
          {moment.confidence != null && Number.isFinite(moment.confidence) ? (
            <span className="hub-live-wire__event-metric-confidence">{Math.round(moment.confidence)}% conf</span>
          ) : null}
          {secondaryMetric.value ? <span className="hub-live-wire__event-metric-secondary">{secondaryMetric.value} {secondaryMetric.unit} {secondaryMetric.comparisonLabel}</span> : null}
        </span>
        {emotes.length > 0 ? (
          <span className="hub-live-wire__event-emotes" aria-label="Top emotes">
            {emotes.map((emote, index) => (
              <span key={`${emote.name}-${index}`} className="hub-live-wire__event-emote" aria-label={`${emote.name}${emote.count != null ? `, ${emote.count} uses` : ''}`}>
                <span className="hub-live-wire__event-emote-image">
                  <EmoteImg src={index === 0 ? (resolvedEmote?.imageUrl ?? emote.imageUrl) : emote.imageUrl} name={emote.name} />
                </span>
                <span className="hub-live-wire__event-emote-name">{emote.name}</span>
                {emote.count != null && Number.isFinite(emote.count) ? <span className="hub-live-wire__event-emote-count">{compact(emote.count)}</span> : null}
              </span>
            ))}
          </span>
        ) : null}
        <span className="hub-live-wire__event-footer">
          <span className={`hub-live-wire__event-strength-label hub-live-wire__event-strength-label--${tier}`}>
            {strength ? strength.split(' · ')[0] : 'Emerging'}
          </span>
          <span className="hub-live-wire__event-strength-bar" aria-hidden="true">
            <span className="hub-live-wire__event-strength-fill" style={{ width: scoreWidth }} />
          </span>
        </span>
        {layout === 'rail' ? (
          <span className={`hub-live-wire__event-inspector-status${canInspect ? '' : ' is-pending'}`} aria-hidden="true">
            {canInspect ? 'Inspect minute' : 'Waiting for chart bucket'}
            <span>{canInspect ? '↗' : '—'}</span>
          </span>
        ) : null}
      </>
    )
    const accent = kindClass(moment.kind)
    const className = `hub-live-wire__event-card hub-live-wire__event-card--${accent}${tier === 'emerging' ? ' hub-live-wire__event-card--emerging' : ''}${historical ? ' is-historical' : ''}${isSelected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${isEntering ? ' is-entering' : ''}`
    const ariaLabel = `${historical ? `${historicalPrefix} historical detection. ` : ''}${name}, ${kind.label}, ${facts.join('. ')}${timeLabel ? `, ${timeLabel}` : ''}. ${evidenceLabel(moment)}`
    // The activity rail is an inspector surface, never a disguised navigation
    // link. Fresh detections may resolve to the nearest completed chart bucket;
    // when no truthful bucket exists yet, keep the story visibly unavailable
    // instead of sending the user to a different page.
    if (layout === 'rail') {
      return (
        <button
          key={key}
          type="button"
          className={`${className}${canInspect ? '' : ' is-inspector-pending'}`}
          aria-label={`${ariaLabel}. ${canInspect ? 'Inspect this activity bucket.' : 'Activity bucket is not available yet.'}`}
          aria-pressed={canInspect ? isSelected : undefined}
          aria-disabled={canInspect ? undefined : true}
          disabled={!canInspect}
          title={canInspect ? 'Inspect this activity bucket' : 'Waiting for a completed activity bucket'}
          ref={ref}
          onClick={() => onSelectMoment?.(moment)}
          onMouseEnter={() => canInspect && onPreviewMoment?.(moment)}
          onMouseLeave={() => canInspect && onPreviewMoment?.(null)}
          onFocus={() => canInspect && onPreviewMoment?.(moment)}
          onBlur={() => canInspect && onPreviewMoment?.(null)}
        >
          {content}
        </button>
      )
    }
    return canInspect ? (
      <button
        key={key}
        type="button"
        className={className}
        aria-label={`${ariaLabel}. Show this minute on the activity chart.`}
        aria-pressed={isSelected}
        ref={ref}
        onClick={() => onSelectMoment?.(moment)}
        onMouseEnter={() => onPreviewMoment?.(moment)}
        onMouseLeave={() => onPreviewMoment?.(null)}
        onFocus={() => onPreviewMoment?.(moment)}
        onBlur={() => onPreviewMoment?.(null)}
      >
        {content}
      </button>
    ) : (
      <Link
        key={key}
        to={href}
        className={className}
        aria-label={`${ariaLabel}. Open analytics.`}
        ref={ref}
      >
        {content}
      </Link>
    )
  }

  const cards = liveMoments.map((moment) => renderCard(moment))
  const explorerCards = explorerView.moments.map((moment) => renderCard(
    moment,
    classifyMomentWindow(moment.at, now, LIVE_WINDOW_MS) === 'older',
  ))
  const historicalCard = latestVerifiedMoment ? renderCard(latestVerifiedMoment, true) : null
  const explorerControls = layout === 'rail' ? (
    <div className="hub-live-wire__explorer-controls" role="toolbar" aria-label="Live Wire controls">
      <div className="hub-live-wire__explorer-field">
        <span className="hub-live-wire__explorer-label" id="live-wire-scope-label">Scope</span>
        <div className="hub-live-wire__explorer-control-group" role="group" aria-labelledby="live-wire-scope-label">
          <button
            type="button"
            className={explorerScope === 'broadcast' ? 'is-active' : ''}
            aria-pressed={explorerScope === 'broadcast'}
            aria-label="Current streams"
            onClick={() => setExplorerScope('broadcast')}
          >
            Current
          </button>
          <button
            type="button"
            className={explorerScope === 'fresh' ? 'is-active' : ''}
            aria-pressed={explorerScope === 'fresh'}
            onClick={() => setExplorerScope('fresh')}
          >
            Last 30m
          </button>
        </div>
      </div>
      <div className="hub-live-wire__explorer-field">
        <span className="hub-live-wire__explorer-label" id="live-wire-signal-label">Signal</span>
        <div className="hub-live-wire__explorer-control-group" role="group" aria-labelledby="live-wire-signal-label">
          {([
            ['all', 'All'],
            ['chat', 'Chat'],
            ['emotes', 'Emotes'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={explorerSignal === value ? 'is-active' : ''}
              aria-pressed={explorerSignal === value}
              onClick={() => setExplorerSignal(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="hub-live-wire__explorer-select">
        <span className="hub-live-wire__explorer-label">Category</span>
        <span className="hub-live-wire__explorer-select-shell">
          <select
            aria-label="Live Wire category"
            value={explorerCategory}
            onChange={(event) => setExplorerCategory(event.target.value)}
          >
            <option value="all">All categories</option>
            {explorerView.categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label} ({category.momentCount})
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </span>
      </label>
      <label className="hub-live-wire__explorer-select">
        <span className="hub-live-wire__explorer-label">Sort</span>
        <span className="hub-live-wire__explorer-select-shell">
          <select
            aria-label="Live Wire order"
            value={explorerSort}
            onChange={(event) => setExplorerSort(event.target.value as LiveWireExplorerSort)}
          >
            <option value="newest">Newest first</option>
            <option value="strongest">Strongest first</option>
            <option value="category">Category groups</option>
          </select>
          <ChevronDown aria-hidden="true" />
        </span>
      </label>
    </div>
  ) : null
  const explorerSummary = layout === 'rail' ? (
    <div className="hub-live-wire__explorer-summary" aria-live="polite">
      <span><strong>{explorerView.moments.length}</strong> moments</span>
      <span><strong>{explorerView.channelCount}</strong> channels</span>
      <span><strong>{explorerView.groups.length}</strong> categories</span>
      <span>Backend-scored snapshot</span>
    </div>
  ) : null
  const explorerBody = layout === 'rail' ? (
    loading && explorerBaseMoments.length === 0 ? (
      <div className="hub-live-wire__explorer-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="hub-live-wire__event-card is-skeleton" aria-hidden="true" />
        ))}
      </div>
    ) : explorerView.moments.length === 0 ? (
      <div className="hub-live-wire__empty hub-live-wire__empty--rail" role="status">
        <Activity aria-hidden="true" />
        <span>
          {explorerScope === 'fresh' && broadcastMoments.length > 0
            ? 'No matching breakout landed in the last 30 minutes. Current streams still have verified earlier moments.'
            : 'No moments match these Live Wire filters.'}
        </span>
      </div>
    ) : explorerSort === 'category' ? (
      <div className="hub-live-wire__category-groups">
        {explorerView.groups.map((group) => (
          <section key={group.key} className="hub-live-wire__category-group" aria-labelledby={`live-wire-category-${group.key.replace(/[^a-z0-9]+/g, '-')}`}>
            <header>
              <h3 id={`live-wire-category-${group.key.replace(/[^a-z0-9]+/g, '-')}`}>{group.label}</h3>
              <span>{group.moments.length} moment{group.moments.length === 1 ? '' : 's'} · {group.channelCount} channel{group.channelCount === 1 ? '' : 's'}</span>
            </header>
            <div className="hub-live-wire__explorer-grid">
              {group.moments.map((moment) => renderCard(
                moment,
                classifyMomentWindow(moment.at, now, LIVE_WINDOW_MS) === 'older',
              ))}
            </div>
          </section>
        ))}
      </div>
    ) : (
      <div className="hub-live-wire__explorer-grid">{explorerCards}</div>
    )
  ) : null
  const feedBody = layout === 'rail' ? (
    <>
      {explorerControls}
      {explorerSummary}
      {explorerBody}
    </>
  ) : loading && liveMoments.length === 0 && !historicalCard ? (
    <LiveWireScroller>{Array.from({ length: 3 }).map((_, index) => <span key={index} className="hub-live-wire__event-card is-skeleton" aria-hidden="true" />)}</LiveWireScroller>
  ) : liveMoments.length === 0 && historicalCard ? (
    <div className={`hub-live-wire__quiet hub-live-wire__quiet--${layout}`}>
      <div className="hub-live-wire__quiet-status" role="status">
        <Activity aria-hidden="true" />
        <span><strong>Quiet now</strong><small>{emptyReason}</small></span>
      </div>
      <LiveWireScroller ariaLabel="Latest verified historical detection">{historicalCard}</LiveWireScroller>
    </div>
  ) : liveMoments.length === 0 ? (
    <div className={`hub-live-wire__empty hub-live-wire__empty--${layout}`} role="status"><Activity aria-hidden="true" /><span>{emptyReason}</span></div>
  ) : (
    <LiveWireScroller>{cards}</LiveWireScroller>
  )

  return (
    <section className={`hub-live-wire hub-live-wire--${layout}`} aria-labelledby={titleId} aria-busy={loading || undefined}>
      <header className="hub-live-wire__head">
        <h2 id={titleId} className="hub-live-wire__title"><Radio aria-hidden="true" />Live Wire</h2>
        <span className="hub-live-wire__head-actions">
          <span className="hub-live-wire__meta">{metaLabel}</span>
          <Link className="hub-live-wire__newsroom-link" to="/analytics/explore">
            Pulse Explorer <span aria-hidden="true">→</span>
          </Link>
        </span>
      </header>
      {hubDegraded ? <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">{emptyReason}</p> : null}
      {!hubDegraded && !isLiveNetwork && feed.banner ? <p className="hub-live-wire__banner" role="status">{feed.banner}</p> : null}
      {feedBody}
      <p className="hub-live-wire__explain">
        {layout === 'rail'
          ? 'Live Wire compares each detected minute with measured history from the same broadcast. Category groups use the strongest and freshest backend-scored moments; missing evidence is labeled, never estimated in the browser.'
          : 'Live Wire compares a detected minute with measured history earlier in the same broadcast. Missing comparison evidence is labeled—not estimated in the browser.'}
      </p>
    </section>
  )
}
