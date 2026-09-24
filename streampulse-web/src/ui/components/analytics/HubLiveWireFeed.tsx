import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatCoveragePercent } from '@streampulse/pulse-core'
import { Activity, Radio } from 'lucide-react'
import {
  compareMomentsChronologically,
  momentRowKey,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from '../../../lib/figmaSessionAnalytics'
import { buildEmoteLookupFromMoments, enrichPulseMomentRows } from '../../../lib/pulseMomentRow'
import {
  formatMomentDateTime,
  partitionMomentWindow,
  classifyMomentWindow,
  resolveMomentAtMs,
} from '../../../lib/liveWire'
import { momentComparisonBadge, momentReactionSignal } from '../../../lib/momentComparison'
import { resolveMomentEmote } from '../../../lib/pulseMomentsUtils'
import { discoveryAnalyticsHref, discoveryMomentHref, fromHubMoment } from '../../../lib/discoveryMoments'
import { formatStreamOffset } from '../../../lib/formatStreamOffset'
import type { PublicHub, PublicHubLoadSource } from '../../../lib/publicHub'
import { isHubNetworkDegraded } from '../../../lib/hubUiState'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { displayName, compact } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { Avatar } from '../hub/primitives'
import { isLifecycleMomentKind } from '../../../lib/poolWireReducer'
import { SaveMomentButton } from '../moments/SaveMomentButton'
import { useSavedMoments } from '../../../lib/savedDiscoveryMoments'
import './live-wire-refinement.css'

const LIVE_WINDOW_MS = 30 * 60 * 1000
const VISIBLE_CAP_LIVE = 10
const VISIBLE_CAP_OLDER = 12
/** The rail is an arrivals ticker; the Moments table owns depth. */
const SHOWN_LIVE = 5
const SHOWN_OLDER = 2
const MAX_NEW_ANIMATIONS_PER_POLL = 3
const MAX_SEEN_IDENTITIES = 1000
const MAX_QUEUED_MOMENTS = 20
const MAX_DISPLAYED_MOMENTS = VISIBLE_CAP_LIVE + VISIBLE_CAP_OLDER

type WireMoment = FigmaMomentRow
function liveWireIdentity(moment: WireMoment): string {
  const discoveryMoment = fromHubMoment(moment)
  if (discoveryMoment) return discoveryMoment.key
  return `legacy:${momentRowKey(moment)}`
}

function mergeWireMoments(current: WireMoment[], retained: WireMoment[], cap: number, now: number): WireMoment[] {
  const unique = new Map<string, WireMoment>()
  // The latest response wins revisions; displaced arrivals live only for the live window.
  for (const moment of [...current, ...retained.filter(row => classifyMomentWindow(row.at, now, LIVE_WINDOW_MS) === 'live')]) {
    const key = liveWireIdentity(moment)
    if (!unique.has(key)) unique.set(key, moment)
  }
  return [...unique.values()].sort(compareMomentsChronologically).slice(0, cap)
}

const EMPTY_REASONS: Record<string, string> = {
  no_qualifying_session: 'No qualifying detections were returned for the loaded tracking sample.',
  store_unavailable: 'Analytics storage is unavailable. Live breakouts will return after recovery.',
  stream_unavailable: 'The selected live stream could not be loaded.',
  rollup_unavailable: 'Minute activity is still warming up for the tracking pool.',
  insufficient_peaks: 'Activity is flowing, but no qualifying detections were returned in this sample.',
}

export interface HubLiveWireFeedProps {
  hub: PublicHub
  feed: LivePulseMomentsResult
  loading?: boolean
  hubEndpointOk?: boolean
  loadSource?: PublicHubLoadSource
  titleId?: string
  pollSequence?: number
  selectedMomentKey?: string | null
  /** Select the corresponding Global Activity bucket without nesting links. */
  onSelectMoment?: (moment: FigmaMomentRow) => void
  /** Fail-closed proof that this real moment resolves to a currently loaded chart bucket. */
  canSelectMoment?: (moment: FigmaMomentRow) => boolean
  /** Rendered beside the comparison disclosure so the rail ends in one footer. */
  footer?: ReactNode
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

function evidenceLabel(moment: FigmaMomentRow): string {
  const comparison = moment.comparison
  if (!comparison) return moment.source === 'live_irc' ? 'IRC measured · comparison unavailable' : 'Comparison unavailable'
  const evidence = comparison.evidence
  return `Earlier baseline ${evidence.baselineMeasuredMinutes}/${evidence.baselineExpectedMinutes} min · ${formatCoveragePercent(evidence.baselineCoveragePct)} coverage`
}

export function HubLiveWireFeed({
  hub,
  feed,
  loading = false,
  hubEndpointOk,
  loadSource,
  titleId = 'hub-live-wire-title',
  pollSequence = 0,
  selectedMomentKey = null,
  onSelectMoment,
  canSelectMoment,
  footer,
}: HubLiveWireFeedProps) {
  const { warning: savedWarning } = useSavedMoments()
  const { animateEnterHorizontal } = useAnalyticsMotion()
  const hubDegraded = isHubNetworkDegraded(loadSource, hubEndpointOk)
  // A cache hydrate preserves a truthful snapshot, but it is not evidence of
  // a currently healthy network cadence. Only a successful full hub read may
  // label the rail as live; cache and stats fallback stay explicitly snapshot.
  const isLiveNetwork = feed.source === 'network' && loadSource === 'full' && !hubDegraded
  const healthyFullNetwork = feed.source === 'network' && loadSource === 'full' && hubEndpointOk === true
  const [now, setNow] = useState(() => Date.now())
  const [activeNewKeys, setActiveNewKeys] = useState<Set<string>>(new Set())
  const [focusWithin, setFocusWithin] = useState(false)
  const [pointerWithin, setPointerWithin] = useState(false)
  const [paused, setPaused] = useState(false)
  const [showAllLoaded, setShowAllLoaded] = useState(false)
  const [atNewest, setAtNewest] = useState(true)
  const [announcement, setAnnouncement] = useState('')
  const sectionRef = useRef<HTMLElement>(null)
  const scrollRootRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let ancestor: HTMLElement | null = null
    let root: HTMLElement | Window = window
    const update = () => {
      const rect = section.getBoundingClientRect()
      setAtNewest(ancestor ? ancestor.scrollTop <= 8 : rect.height === 0 || rect.top >= 64)
    }
    const attach = () => {
      root.removeEventListener('scroll', update)
      ancestor = section.parentElement
      while (ancestor && !/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY)) ancestor = ancestor.parentElement
      scrollRootRef.current = ancestor
      root = ancestor ?? window
      root.addEventListener('scroll', update, { passive: true })
      update()
    }
    attach()
    window.addEventListener('resize', attach)
    return () => { root.removeEventListener('scroll', update); window.removeEventListener('resize', attach) }
  }, [])
  const [displayedMoments, setDisplayedMoments] = useState<WireMoment[]>([])
  const [queuedMoments, setQueuedMoments] = useState<FigmaMomentRow[]>([])
  const displayedMomentsRef = useRef(displayedMoments)
  const queuedMomentsRef = useRef(queuedMoments)
  displayedMomentsRef.current = displayedMoments
  queuedMomentsRef.current = queuedMoments

  const profileImageByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const channel of hub.liveChannels) {
      if (channel.profileImageUrl) map.set(channel.login.toLowerCase(), channel.profileImageUrl)
    }
    return map
  }, [hub.liveChannels])

  const liveChannelsWithoutCategory = useMemo(() => hub.liveChannels.map((channel) => ({
    ...channel,
    category: undefined,
  })), [hub.liveChannels])

  /**
   * Peaks and momentum only. Lifecycle belongs to Pool Wire in the command
   * header, which already names every confirmed transition; a second list of
   * the same events here only competed with the arrivals this rail exists for.
   */
  const candidates = useMemo(() => {
    const peakOnly = feed.moments.filter((moment) => !isLifecycleMomentKind(moment.kind))
    // Current channel category is not evidence of the detection's category,
    // especially for older moments after a game change. Keep other cosmetic
    // live-channel enrichment, but leave missing moment category unavailable.
    return enrichPulseMomentRows(peakOnly, { liveChannels: liveChannelsWithoutCategory }) as WireMoment[]
  }, [feed.moments, liveChannelsWithoutCategory])

  const displayInitializedRef = useRef(false)
  const resumedMomentsRef = useRef<WireMoment[]>([])
  const holdingUpdates = paused || focusWithin || pointerWithin || !atNewest

  useEffect(() => {
    const currentTime = Date.now()
    const boundedCandidates = mergeWireMoments(candidates, [], MAX_DISPLAYED_MOMENTS, currentTime)
    if (!displayInitializedRef.current) {
      displayInitializedRef.current = true
      setDisplayedMoments(boundedCandidates)
      return
    }

    if (hubDegraded) return
    const latestByKey = new Map(boundedCandidates.map(moment => [liveWireIdentity(moment), moment]))
    // Refresh the retained copy too, so a later omission cannot restore old measurements.
    resumedMomentsRef.current = mergeWireMoments([], resumedMomentsRef.current.map(moment =>
      latestByKey.get(liveWireIdentity(moment)) ?? moment,
    ), MAX_QUEUED_MOMENTS, currentTime)
    const visibleKeys = new Set(displayedMomentsRef.current.map(liveWireIdentity))
    const arrivals = boundedCandidates.filter((moment) => {
      const key = liveWireIdentity(moment)
      return !visibleKeys.has(key)
    })
    if (holdingUpdates) {
      setQueuedMoments(mergeWireMoments(arrivals, queuedMomentsRef.current, MAX_QUEUED_MOMENTS, currentTime))
      return
    }
    if (!holdingUpdates) {
      resumedMomentsRef.current = mergeWireMoments([], [...queuedMomentsRef.current, ...resumedMomentsRef.current], MAX_QUEUED_MOMENTS, currentTime)
      setDisplayedMoments(mergeWireMoments(boundedCandidates, resumedMomentsRef.current, MAX_DISPLAYED_MOMENTS, currentTime))
      setQueuedMoments([])
    }
  }, [candidates, holdingUpdates, hubDegraded])

  const revealQueuedMoments = () => {
    setPaused(false)
    setAtNewest(true)
    setFocusWithin(false)
    setPointerWithin(false)
    // Focus scrolling would center the header; position it explicitly below.
    sectionRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    const root = scrollRootRef.current
    const section = sectionRef.current
    if (root) root.scrollTo?.({ top: 0 })
    else if (section) {
      // Land the header below the sticky analytics nav (two rows on phones), which
      // also clears the reading threshold so arrivals keep flowing.
      const stickyHeader = document.querySelector<HTMLElement>('.analytics-topnav')?.getBoundingClientRect().height ?? 0
      const clearance = Math.max(stickyHeader, 64) + 8
      const rect = section.getBoundingClientRect()
      if (rect.height > 0 && rect.top < clearance) window.scrollTo?.({ top: Math.max(0, window.scrollY + rect.top - clearance) })
    }
    const currentTime = Date.now()
    resumedMomentsRef.current = mergeWireMoments([], [...queuedMomentsRef.current, ...resumedMomentsRef.current], MAX_QUEUED_MOMENTS, currentTime)
    setDisplayedMoments(mergeWireMoments(candidates, resumedMomentsRef.current, MAX_DISPLAYED_MOMENTS, currentTime))
    setQueuedMoments([])
  }

  const orderedMoments = useMemo(
    () => [...displayedMoments].sort(compareMomentsChronologically),
    [displayedMoments],
  )

  const heldClassificationNowRef = useRef(now)
  if (!holdingUpdates) heldClassificationNowRef.current = now
  const classificationNow = holdingUpdates ? heldClassificationNowRef.current : now

  const momentWindow = useMemo(
    () => partitionMomentWindow(orderedMoments, classificationNow, LIVE_WINDOW_MS),
    [classificationNow, orderedMoments],
  )

  const retainMoments = (moments: WireMoment[], cap: number) => {
    const unique = new Map<string, WireMoment>()
    for (const moment of moments) {
      const key = liveWireIdentity(moment)
      if (!unique.has(key)) unique.set(key, moment)
    }
    return [...unique.values()].slice(0, cap)
  }

  const liveMoments = useMemo(
    () => retainMoments(momentWindow.live, VISIBLE_CAP_LIVE),
    [momentWindow.live],
  )
  const olderMoments = useMemo(
    () => retainMoments(momentWindow.older, VISIBLE_CAP_OLDER),
    [momentWindow.older],
  )
  const loadedCount = liveMoments.length + olderMoments.length
  const previewCount = Math.min(liveMoments.length, SHOWN_LIVE) + Math.min(olderMoments.length, SHOWN_OLDER)
  const hasHiddenMoments = loadedCount > previewCount
  const shownCount = showAllLoaded ? loadedCount : previewCount

  const emoteLookup = useMemo(
    () => buildEmoteLookupFromMoments([...liveMoments, ...olderMoments], hub.topEmotes),
    [hub.topEmotes, liveMoments, olderMoments],
  )

  const committedKeys = useRef<Set<string> | null>(null)
  const seenCommittedKeys = useRef(new Set<string>())
  useLayoutEffect(() => setActiveNewKeys(new Set()), [pollSequence])
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  useEffect(() => {
    // Relative ages tick every second while visible; a hidden tab does no work.
    let id: number | undefined
    const stop = () => { if (id !== undefined) { window.clearInterval(id); id = undefined } }
    const sync = () => {
      if (document.visibilityState === 'hidden') return stop()
      if (id !== undefined) return
      setNow(Date.now())
      id = window.setInterval(() => setNow(Date.now()), 1000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => { stop(); document.removeEventListener('visibilitychange', sync) }
  }, [])
  useLayoutEffect(() => {
    // The first usable snapshot establishes a baseline, including cache hydration.
    if (committedKeys.current === null && displayedMoments.length === 0) return
    const keys = new Set(displayedMoments.map(liveWireIdentity))
    const added = committedKeys.current ? [...keys].filter(key => !seenCommittedKeys.current.has(key)) : []
    for (const key of keys) seenCommittedKeys.current.add(key)
    while (seenCommittedKeys.current.size > MAX_SEEN_IDENTITIES) seenCommittedKeys.current.delete(seenCommittedKeys.current.values().next().value!)
    committedKeys.current = keys
    if (!healthyFullNetwork || added.length === 0) return
    setAnnouncement(added.length + ' new live entries')
    setActiveNewKeys(new Set(added.slice(0, MAX_NEW_ANIMATIONS_PER_POLL)))
    for (const key of added.slice(0, MAX_NEW_ANIMATIONS_PER_POLL)) {
      const element = rowRefs.current.get(key)
      if (element) animateEnterHorizontal(element, { from: 'left' })
    }
  }, [displayedMoments, healthyFullNetwork, animateEnterHorizontal])

  const metaLabel = isLiveNetwork
    ? 'Loaded detections'
    : hubDegraded
      ? 'live network feed paused'
      : 'snapshot · not live network cadence'
  const emptyReason = hubDegraded
    ? 'Live comparisons need a healthy hub connection. The chart remains available from the last truthful snapshot.'
    : (feed.reason && EMPTY_REASONS[feed.reason]) || 'No qualifying detections were returned in this sample.'

  const renderCard = (moment: WireMoment) => {
    const key = liveWireIdentity(moment)
    const externalKey = momentRowKey(moment)
    const login = moment.login ?? ''
    const name = displayName(login, moment.displayName)
    const timeLabel = relativeTime(moment.at, now)
    const discoveryMoment = fromHubMoment(moment)
    const comparison = discoveryMoment?.comparison
    const chatPerMin = discoveryMoment?.chatPerMin ?? moment.chatPerMin
    const emotesPerMin = discoveryMoment?.emotesPerMin ?? moment.emotesPerMin
    /**
     * The magnitude is the headline, not a sentence. `momentComparisonBadge`
     * refuses to compress a percentage or absolute-delta fallback, and a row
     * with no ready comparison says so plainly rather than borrowing the
     * emphasis of a measured breakout.
     */
    const badge = momentComparisonBadge(comparison, momentReactionSignal(moment.kind))
    const category = moment.category?.trim()
    const profileImageUrl = moment.profileImageUrl ?? profileImageByLogin.get(login.toLowerCase())
    const canInspect = Boolean(onSelectMoment && canSelectMoment?.(moment) === true)
    const isSelected = canInspect && selectedMomentKey === externalKey
    const isNew = healthyFullNetwork && activeNewKeys.has(key) &&
      classifyMomentWindow(moment.at, now, LIVE_WINDOW_MS) === 'live'
    const isEntering = activeNewKeys.has(key)
    const actionContext = `${name} ${moment.label?.trim() || 'activity moment'} at ${formatStreamOffset(moment.offsetSeconds)}`
    const ref = (element: HTMLElement | null) => {
      if (element) rowRefs.current.set(key, element)
      else rowRefs.current.delete(key)
    }
    const className = `hub-live-wire__rail-card hub-live-wire__event-card${isSelected ? ' is-selected' : ''}${isNew ? ' hub-live-wire__card--new' : ''}${isEntering ? ' is-entering' : ''}${canInspect ? ' is-inspectable' : ''}`
    return (
      <li role="listitem" key={key}>
      <article
        className={className}
        ref={ref}
        aria-label={actionContext}
        data-public-moment-id={moment.publicMomentId}
        data-stream-id={moment.streamId}
        onClick={canInspect ? (event) => {
          // Links and controls inside the row keep their own behaviour; the
          // remaining surface is the same "open this on the chart" target the
          // explicit action provides.
          if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, summary')) return
          onSelectMoment?.(moment)
        } : undefined}
      >
        <div className="hub-live-wire__rail-head">
          <Avatar login={login} src={profileImageUrl} alt="" className="hub-live-wire__rail-av" profileSize={70} />
          <span className="hub-live-wire__rail-names">
            <strong className="hub-live-wire__rail-name">{name}</strong>
            <small className="hub-live-wire__rail-category">{category || 'Category unavailable'}</small>
          </span>
          <span className="hub-live-wire__rail-timing">
            <time className="hub-live-wire__rail-age" dateTime={formatMomentDateTime(moment.at)}>{timeLabel || 'Time unavailable'}</time>
            {isNew ? <span className="hub-live-wire__rail-new">NEW</span> : null}
          </span>
        </div>
        <div className="hub-live-wire__rail-signal" aria-label="Detected event">
          {badge ? (
            <span
              className="hub-live-wire__magnitude"
              data-below={badge.belowBaseline ? 'true' : undefined}
              title={badge.long}
            >{badge.short}</span>
          ) : null}
          <strong className="hub-live-wire__rail-label" title={evidenceLabel(moment)}>{moment.label?.trim() || 'Activity moment'}</strong>
          <span className="hub-live-wire__rail-metrics" aria-label="Measured rates">
            {([['Chat', chatPerMin], ['Emotes', emotesPerMin]] as const).map(([label, value]) => (
              <span className="hub-live-wire__metric" key={label}>
                <span>{label}</span> <strong>{value != null && Number.isFinite(value) ? `${compact(value)}/m` : '—'}</strong>
              </span>
            ))}
          </span>
        </div>
        {/* The baseline evidence already titles the label above; saying the
            comparison is unavailable needs no second copy of it. */}
        {badge ? null : (
          <p className="hub-live-wire__rail-comparison">Comparison unavailable</p>
        )}
        {(moment.topEmotes?.length ?? 0) > 0 ? <div className="hub-live-wire__rail-emotes" aria-label="Top emotes">
          {(moment.topEmotes ?? []).slice(0, 3).map((emote, index) => {
            const resolved = resolveMomentEmote({ ...moment, topEmotes: [emote] }, emoteLookup)
            const emoteName = emote.name?.trim() || 'Emote'
            const emoteCount = emote.count != null && Number.isFinite(emote.count) ? compact(emote.count) : null
            return <span className="hub-live-wire__rail-emote" title={emote.name ?? undefined} key={`${emote.name}-${index}`}>
              <EmoteImg src={resolved?.imageUrl ?? emote.imageUrl} name={emoteName} />
              {/* The name may truncate; the count is the evidence and always stays visible. */}
              <span className="hub-live-wire__rail-emote-label">{emoteName}</span>
              {emoteCount ? <span className="hub-live-wire__rail-emote-count">{emoteCount}</span> : null}
            </span>
          })}
        </div> : null}
        {/* The primary action keeps its own slot across the bottom of the card;
            the repeated secondary actions sit to its right. */}
        <div className="hub-live-wire__rail-footer" role="group" aria-label={`Actions for ${actionContext}`}>
          {discoveryMoment ? (
            <Link className="hub-live-wire__action hub-live-wire__action--primary" aria-label={`Open moment for ${actionContext}`} to={discoveryMomentHref(discoveryMoment)} state={{ hubMoment: moment }}>
              <span>Open moment</span><span aria-hidden="true">→</span>
            </Link>
          ) : <span className="hub-live-wire__identity-note">Moment identity unavailable</span>}
          {discoveryMoment || canInspect ? <div className="hub-live-wire__rail-actions" aria-label="Moment actions">
            {discoveryMoment ? <SaveMomentButton moment={discoveryMoment} contextLabel={actionContext} /> : null}
            {discoveryMoment ? <Link className="hub-live-wire__stream-link" aria-label={`Stream analytics for ${actionContext}`} to={discoveryAnalyticsHref(discoveryMoment)}>Analytics</Link> : null}
            {canInspect ? <button type="button" className="hub-live-wire__action hub-live-wire__action--secondary" aria-label={`Show ${actionContext} on chart`} aria-pressed={isSelected} onClick={() => onSelectMoment?.(moment)}>Chart</button>
              // Keep the action slot stable across cards; say why it is unavailable.
              : onSelectMoment ? <button type="button" className="hub-live-wire__action hub-live-wire__action--secondary" disabled aria-label={`Chart not available for ${actionContext}`} title="Not on the current chart: the bucket may still be filling or outside the loaded range">Chart</button>
              : null}
          </div> : null}
        </div>
      </article>
      </li>
    )
  }

  const listProps = {
    role: 'list',
    className: 'hub-live-wire__rail-list',
    onPointerEnter: () => setPointerWithin(true),
    onPointerLeave: () => setPointerWithin(false),
  } as const

  const feedBody = loading && liveMoments.length === 0 ? (
    <ul {...listProps}>{Array.from({ length: 3 }).map((_, index) => <li key={index}><span className="hub-live-wire__rail-card hub-live-wire__card--skeleton" aria-hidden="true" /></li>)}</ul>
  ) : liveMoments.length === 0 && olderMoments.length === 0 ? (
    <div className="hub-live-wire__empty hub-live-wire__empty--rail" role="status"><Activity aria-hidden="true" /><span>{emptyReason}</span></div>
  ) : (
    <>
      {liveMoments.length > 0
        ? <><h3 className="hub-live-wire__rail-tier">{isLiveNetwork ? 'Last 30 minutes' : 'Snapshot detections'}</h3><ul {...listProps}>{(showAllLoaded ? liveMoments : liveMoments.slice(0, SHOWN_LIVE)).map(renderCard)}</ul></>
        : <p className="hub-live-wire__quiet" role="status">No loaded detections in the last 30 minutes. Earlier moments are below.</p>}
      {olderMoments.length > 0 ? <><h3 className="hub-live-wire__rail-tier">Earlier detections</h3><ul {...listProps}>{(showAllLoaded ? olderMoments : olderMoments.slice(0, SHOWN_OLDER)).map(renderCard)}</ul></> : null}
    </>
  )

  return (
    <section ref={sectionRef} className="hub-live-wire hub-live-wire--rail" aria-labelledby={titleId} aria-busy={loading || undefined} onFocusCapture={event => setFocusWithin(Boolean((event.target as HTMLElement).closest('button, a, select, input')))} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false)
    }}>
      <header className="hub-live-wire__head">
        <h2 id={titleId} tabIndex={-1} className="hub-live-wire__title"><Radio aria-hidden="true" />Live Wire</h2>
        <span className="hub-live-wire__meta">{metaLabel}</span>
      </header>
      {savedWarning ? <p role="status" className="moments-notice">{savedWarning}</p> : null}
      <p className="hub-live-wire__announcement" role="status" aria-live="polite">{announcement}</p>
      {/* One state, one control: the label never contradicts the button beside it.
          Reading (pointer, focus or scroll) only holds arrivals; "Paused" is reserved
          for an explicit Pause, and Resume appears only when it would change something. */}
      <div className="hub-live-wire__follow-controls">
        <span>{!holdingUpdates ? 'Following newest' : paused ? 'Paused' : 'Holding updates while you read'}</span>
        {paused || (holdingUpdates && queuedMoments.length > 0)
          ? <button type="button" onClick={revealQueuedMoments}>Resume live{queuedMoments.length > 0 ? ' · ' + queuedMoments.length + ' new' : ''}</button>
          : <button type="button" onClick={() => setPaused(true)}>Pause</button>}
      </div>
      {hubDegraded ? <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">{emptyReason}</p> : null}
      {!hubDegraded && !isLiveNetwork && feed.banner ? <p className="hub-live-wire__banner" role="status">{feed.banner}</p> : null}
      {loadedCount > 0 ? <div className="hub-live-wire__display-count">
        <span>Showing {shownCount} of {loadedCount} loaded detections</span>
        {hasHiddenMoments ? <button type="button" aria-expanded={showAllLoaded} aria-controls={`${titleId}-detections`} onClick={() => setShowAllLoaded(value => !value)}>{showAllLoaded ? 'Show preview' : `Show all ${loadedCount}`}</button> : null}
      </div> : null}
      <div id={`${titleId}-detections`} className="hub-live-wire__detections">{feedBody}
        {/* Scrolled into the feed, the header's Resume is off-screen; keep arrivals reachable where the reader is. */}
        {!atNewest && queuedMoments.length > 0
          ? <button type="button" className="hub-live-wire__arrivals" onClick={revealQueuedMoments}>Show {queuedMoments.length} new detection{queuedMoments.length === 1 ? '' : 's'} ↑</button>
          : null}
      </div>
      <div className="hub-live-wire__rail-footer-row">
        <details className="hub-live-wire__about">
          <summary>About comparisons</summary>
          <p>A detected minute is compared with measured history earlier in the same broadcast. Missing evidence is labeled, not estimated in the browser. Opening a row uses its exact stream and minute; no media preview loads in this feed.</p>
        </details>
        {footer}
      </div>
    </section>
  )
}
