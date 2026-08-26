import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronLeft, ChevronRight, MessageSquare, Radio, TrendingUp } from 'lucide-react'
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
import { resolveMomentEmote } from '../../../lib/pulseMomentsUtils'
import type { PublicHub, PublicHubLoadSource } from '../../../lib/publicHub'
import { isHubNetworkDegraded } from '../../../lib/hubUiState'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { displayName, compact } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { Avatar } from '../hub/primitives'
import { isLifecycleMomentKind } from '../../../lib/poolWireReducer'

const LIVE_WINDOW_MS = 30 * 60 * 1000
const VISIBLE_CAP_LIVE = 12
const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const MAX_NEW_ANIMATIONS_PER_POLL = 3
const LIVE_WIRE_QUIET_EMPTY = 'No network breakouts in the last 30m'

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
  layout?: 'lane'
  titleId?: string
  pollSequence?: number
  selectedMomentKey?: string | null
  /** Select the corresponding Global Activity bucket without nesting links. */
  onSelectMoment?: (moment: FigmaMomentRow) => void
}

function kindMeta(kind: string | undefined): { label: string; icon: ReactNode } {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'chat_spike') {
    return { label: 'Chat spike', icon: <MessageSquare aria-hidden="true" /> }
  }
  if (
    normalized === 'emotes' || normalized === 'emote' ||
    normalized === 'emote_spike' || normalized === 'seventv'
  ) {
    return { label: 'Emote spike', icon: <TrendingUp aria-hidden="true" /> }
  }
  return { label: 'Peak', icon: <Activity aria-hidden="true" /> }
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

function strongestMetric(moment: FigmaMomentRow): string | null {
  if (moment.emotesPerMin != null && moment.emotesPerMin > 0) {
    return `${compact(moment.emotesPerMin)} emotes/min`
  }
  if (moment.chatPerMin != null && moment.chatPerMin > 0) {
    return `${compact(moment.chatPerMin)} chat/min`
  }
  return null
}

interface LiveWireScrollerProps {
  children: ReactNode
}

function LiveWireScroller({ children }: LiveWireScrollerProps) {
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
    const chip = viewport.querySelector<HTMLElement>('.hub-live-wire__chip')
    viewport.scrollBy({
      left: (chip ? chip.getBoundingClientRect().width + 8 : 240) * multiplier,
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
      <button type="button" className="hub-live-wire__ticker-nav" aria-label="Scroll Live Wire left" disabled={!canPrev} onClick={() => step(-1.5)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div className="hub-live-wire__ticker-viewport" ref={viewportRef} onScroll={updateButtons} tabIndex={0} role="region" aria-label="Live Wire events">
        <div className="hub-live-wire__ticker-track">{children}</div>
      </div>
      <button type="button" className="hub-live-wire__ticker-nav" aria-label="Scroll Live Wire right" disabled={!canNext} onClick={() => step(1.5)}>
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
}: HubLiveWireFeedProps) {
  const isLane = layout === 'lane'
  const { animateEnterHorizontal, motionEnabled } = useAnalyticsMotion()
  const hubDegraded = isHubNetworkDegraded(loadSource, hubEndpointOk)
  const isLiveNetwork = feed.source === 'network' && !hubDegraded
  /** Hard gate: a moment may only be NEW on a healthy full network feed. */
  const healthyFullNetwork = feed.source === 'network' && loadSource === 'full' && hubEndpointOk === true

  const [now, setNow] = useState(() => Date.now())
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

  // Live Wire is a chart annotation lane, not a second archive. Invalid,
  // future, and older-than-30m moments are excluded from this surface.
  const candidates = useMemo(() => {
    const peakOnly = feed.moments.filter((m) => !isLifecycleMomentKind(m.kind))
    return enrichPulseMomentRows(peakOnly, enrichCtx)
  }, [enrichCtx, feed.moments])

  const liveMoments = useMemo(() => {
    const { live } = partitionMomentWindow(candidates, now, LIVE_WINDOW_MS)
    return dedupeMomentsByLogin(
      [...live].sort(compareMomentsChronologically),
      VISIBLE_CAP_LIVE,
      DEDUPE_WINDOW_MS,
    )
  }, [candidates, now])

  const emoteLookup = useMemo(
    () => buildEmoteLookupFromMoments(liveMoments, hub.topEmotes),
    [hub.topEmotes, liveMoments],
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

    // Animate only the newly introduced chips from the lane's left edge.
    // by the render that produced `moments`.
    for (const key of animationKeys) {
      const el = rowRefs.current.get(key)
      if (el) animateEnterHorizontal(el, { from: 'left' })
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

  const renderChip = (moment: FigmaMomentRow) => {
    const key = momentRowKey(moment)
    const login = moment.login ?? ''
    const name = displayName(login, moment.displayName)
    const meta = kindMeta(moment.kind)
    const comparisonFact = eventComparisonFact(moment)
    const detail = comparisonFact ?? strongestMetric(moment) ?? moment.label?.trim() ?? null
    const timeLabel = relativeTime(moment.at, now)
    const isNew =
      healthyFullNetwork &&
      newKeysRef.current.has(key) &&
      classifyMomentWindow(moment.at, now, LIVE_WINDOW_MS) === 'live'
    const isSelected = selectedMomentKey === key
    const profileImageUrl = moment.profileImageUrl ?? profileImageByLogin.get(login.toLowerCase())
    const href = moment.href ?? (login ? `/analytics/${encodeURIComponent(login)}` : '/analytics')
    const strength = breakoutStrengthLabel(moment.score)
    const ref = (element: HTMLElement | null) => {
      if (element) rowRefs.current.set(key, element)
      else rowRefs.current.delete(key)
    }
    const content = (
      <>
        <span className="hub-live-wire__chip-kind" aria-hidden="true">{meta.icon}</span>
        {timeLabel ? <span className="hub-live-wire__chip-time">{timeLabel}</span> : null}
        <Avatar login={login} src={profileImageUrl} alt="" className="hub-live-wire__chip-av" />
        <span className="hub-live-wire__chip-event">{meta.label}</span>
        <span className="hub-live-wire__chip-sep" aria-hidden="true">·</span>
        <span className="hub-live-wire__chip-name">{name}</span>
        {detail ? (
          <>
            <span className="hub-live-wire__chip-sep" aria-hidden="true">·</span>
            <span className="hub-live-wire__chip-detail">{detail}</span>
          </>
        ) : null}
        {(moment.topEmotes?.length ?? 0) > 0 ? (
          <span className="hub-live-wire__chip-emotes" aria-label="Top emote">
            {(moment.topEmotes ?? []).slice(0, 1).map((emote, index) => {
              const resolved = resolveMomentEmote(
                { ...moment, topEmotes: [emote] },
                emoteLookup,
              )
              return (
                <span className="hub-live-wire__chip-emote" key={`${emote.name}-${index}`}>
                  <EmoteImg src={resolved?.imageUrl ?? emote.imageUrl} name={emote.name ?? '?'} />
                </span>
              )
            })}
          </span>
        ) : null}
        {strength ? (
          <span
            className="hub-live-wire__chip-metric"
            title="Weighted breakout strength from available signals; not a probability or viewer total."
          >
            {strength}
          </span>
        ) : null}
        {moment.comparison ? (
          <span className="visually-hidden">
            Event rollup {moment.comparison.evidence.eventRollupAvailable ? 'available' : 'unavailable'};
            {' '}baseline {moment.comparison.baselineWindow.measuredMinutes}/{moment.comparison.baselineWindow.expectedMinutes} earlier minutes
            {moment.comparison.baselineWindow.coveragePct != null
              ? `; ${Math.round(moment.comparison.baselineWindow.coveragePct)}% coverage`
              : ''}
          </span>
        ) : null}
        {isNew ? <span className="hub-live-wire__chip-new">NEW</span> : null}
      </>
    )
    const className =
      `hub-live-wire__chip${isNew ? ' hub-live-wire__chip--new' : ''}${isSelected ? ' hub-live-wire__chip--selected' : ''}`

    return onSelectMoment ? (
      <button
        key={key}
        type="button"
        className={className}
        aria-pressed={isSelected}
        ref={ref}
        onClick={() => onSelectMoment(moment)}
      >
        {content}
      </button>
    ) : (
      <Link key={key} to={href} className={className} ref={ref}>
        {content}
      </Link>
    )
  }

  const rootClass = `hub-live-wire hub-live-wire--ticker${isLane ? ' hub-live-wire--lane' : ''}`

  if (loading && liveMoments.length === 0) {
    return (
      <section className={rootClass} aria-labelledby={titleId} aria-busy="true">
        <WireHeader titleId={titleId} metaLabel={metaLabel} />
        <LiveWireScroller>
          {Array.from({ length: 5 }).map((_, index) => (
            <span key={index} className="hub-live-wire__chip hub-live-wire__chip--skeleton" aria-hidden="true" />
          ))}
        </LiveWireScroller>
      </section>
    )
  }

  return (
    <section className={rootClass} aria-labelledby={titleId}>
      <WireHeader titleId={titleId} metaLabel={metaLabel} />
      {hubDegraded ? (
        <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">
          Showing aggregate stats only — live network moments will resume when the hub feed recovers.
        </p>
      ) : null}
      {!hubDegraded && !isLiveNetwork && feed.banner ? (
        <p className="hub-live-wire__banner" role="status">{feed.banner}</p>
      ) : null}
      {liveMoments.length === 0 ? (
        <div className="hub-live-wire__empty hub-live-wire__empty--ticker" role="status">
          <Activity aria-hidden="true" />
          <span>{emptyReason}</span>
        </div>
      ) : (
        <LiveWireScroller>{liveMoments.map(renderChip)}</LiveWireScroller>
      )}
    </section>
  )
}
