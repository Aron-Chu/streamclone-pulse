/**
 * /analytics as the d3-v5 hub. Ported from the approved mockup (d3-v5
 * hub.html), in H1's reading order (11-19), one answer per block: the search
 * hero with the emote conveyor behind it (R5-15 at Soft), Your follows once the
 * viewer shows their Twitch follows (11-01), Busiest now (who is hot; the
 * featured stream's card folded into it), the Top emotes row, the activity chart
 * and its bar card (when it spiked), Top moments today as a still list of 5
 * (the day's best), Picking up now, then the full lists: the emote map (R5-13),
 * Where chat is (R5-22), Channels and one "How this is measured" disclosure, on
 * the d3 grid (one column on phones, Picking up now beside the page from 1536 px).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import { optionsForBoundedActivityFallback } from '../../lib/activityRangeCapabilities'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { getBackendUrl } from '../../lib/apiClient'
import { hubActivityBehindWords } from '../../lib/hubActivityFallbackLine'
import { activityBucketMs, formatActivityWindowLabel, showsMinutesMissingNote, summarizeActivity } from '../../lib/hubActivitySummary'
import { selectHubChartActivityInputs } from '../../lib/hubChartActivityModel'
import { isHubActivityLivePoolFallback, resolveHubActivityChartWindowMinutes } from '../../lib/hubActivityHonesty'
import { normalizePublicHub, type PublicHubActivityWindow } from '../../lib/publicHub'
import { resolveHubUiState } from '../../lib/hubUiState'
import type { HubActivityRangeOption } from '../../ui/components/hub/HubActivityChart'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { HubActivityPanelV5 } from '../../ui/components/analytics/HubActivityPanelV5'
import { HubBackendSourceBanner } from '../../ui/components/analytics/HubBackendSourceBanner'
import { HubDataHealthBanner } from '../../ui/components/hub/HubDataHealthBanner'
import { hubBucketMinutes, pointSpacingMinutes } from '../../ui/components/hub/hubActivitySpModel'
import { HubV5BarCard } from '../../ui/components/hub/v5/HubV5BarCard'
import { HubV5Busiest } from '../../ui/components/hub/v5/HubV5Busiest'
import { HubV5Channels } from '../../ui/components/hub/v5/HubV5Channels'
import { HubV5EmoteMap } from '../../ui/components/hub/v5/HubV5EmoteMap'
import { animatedFlagsFromKey, animatedFlagsKey } from '../../ui/components/hub/v5/hubV5EmoteMapModel'
import { HubV5EmoteRow } from '../../ui/components/hub/v5/HubV5EmoteRow'
import { HubV5Follows, HubV5FollowsButton } from '../../ui/components/hub/v5/HubV5Follows'
import { HubV5Hero } from '../../ui/components/hub/v5/HubV5Hero'
import { HubV5Icon } from '../../ui/components/hub/v5/HubV5Icon'
import { HubV5PickingUp } from '../../ui/components/hub/v5/HubV5PickingUp'
import { HubV5Rack } from '../../ui/components/hub/v5/HubV5Rack'
import { HubV5TopList, useTopToday } from '../../ui/components/hub/v5/HubV5TopMoments'
import { HubV5BarInstall, HubV5DockSearch } from '../../ui/components/hub/v5/HubV5TopBar'
import { HubV5SearchContext, createHubV5SearchStore } from '../../ui/components/hub/v5/hubV5SearchStore'
import { useHubV5BusiestMoments } from '../../ui/components/hub/v5/useHubV5BusiestMoments'
import { useHubV5LockWarmup } from '../../ui/components/hub/v5/useHubV5LockWarmup'
import { hubCategoryArt, hubSavedAt, hubSearchEmotes, hubSearchGames, screenerDown, whereChatIs } from '../../ui/components/hub/v5/hubV5Model'
import { useHashScrollHold } from '../../ui/RouteScrollManager'
import { StreamerChatStats } from '../../ui/components/StreamerChatStats'
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/hub/d3/hub-d3-tokens.css'
import '../../ui/components/hub/v5/hub-v5.css'

const ACTIVITY_WINDOW_OPTIONS: HubActivityRangeOption[] = [
  { key: '30m', label: '30m' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '1m', label: '1mo' },
  { key: '3m', label: '3mo' },
  { key: '1y', label: '1 year' },
]

const ACTIVITY_WINDOW_MINUTES: Record<string, number> = {
  '30m': 30,
  '24h': 24 * 60,
  '7d': 7 * 24 * 60,
  '1m': 30 * 24 * 60,
  '3m': 3 * 30 * 24 * 60,
  '1y': 365 * 24 * 60,
}

const EMPTY_PUBLIC_HUB = normalizePublicHub(null)

function compactWindowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return formatActivityWindowLabel(minutes)
}

function formatUpdatedAgo(ts: number | null, nowMs: number): string | undefined {
  if (!ts) return undefined
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

/** Save time is not the age of the data inside the saved copy. */
export function formatCachedSnapshotNotice(cachedAt: number, nowMs: number): string {
  return `Cached snapshot · Saved ${hubSavedAt(cachedAt, nowMs)}`
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The reader's place on each Hub history entry (HUB-LIVE-2). */
const hubScroll = new Map<string, number>()
const HUB_RESTORE_FRAMES = 120
const HUB_RESTORE_STOP_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Back from a stream page lands where the reader was (HUB-LIVE-2, 11-13). The
 * browser restores the offset before the Hub has its height, so a short page
 * caps it; this keeps placing it for up to 120 frames, until it holds or the
 * reader scrolls, taps or types. The same way the Moments page brings a reader
 * back to their place. A #section entry stays RouteScrollManager's.
 */
function useHubReturnScroll() {
  const { key, hash } = useLocation()
  const navigationType = useNavigationType()
  // A layout cleanup runs before RouteScrollManager opens the next page at the top, so it records the reader's place, not 0.
  useLayoutEffect(() => () => {
    hubScroll.delete(key)
    hubScroll.set(key, window.scrollY)
    if (hubScroll.size > 40) hubScroll.delete(hubScroll.keys().next().value!)
  }, [key])
  useEffect(() => {
    if (navigationType !== 'POP' || hash) return
    const target = hubScroll.get(key)
    if (target == null || target <= 0) return
    let frame = 0
    let frames = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      for (const type of HUB_RESTORE_STOP_EVENTS) window.removeEventListener(type, stop)
    }
    for (const type of HUB_RESTORE_STOP_EVENTS) window.addEventListener(type, stop, { passive: true })
    const step = () => {
      if (Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target)
      if (++frames < HUB_RESTORE_FRAMES) frame = requestAnimationFrame(step)
      else stop()
    }
    frame = requestAnimationFrame(step)
    return stop
    // Restore once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** The clock the "Live" cues read: every 10 s while the tab is visible, and on return. */
function useFreshnessClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNowMs(Date.now()) }
    const timer = window.setInterval(tick, 10_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return nowMs
}

export default function AnalyticsHubV5Page() {
  const [searchParams, setSearchParams] = useSearchParams()
  // The hero's search and the top bar's share the typed text and the scroll state (HubV5TopBar).
  const [searchStore] = useState(createHubV5SearchStore)
  const rawWindow = searchParams.get('window') || searchParams.get('activityWindow')
  const activityWindow: PublicHubActivityWindow = rawWindow && rawWindow in ACTIVITY_WINDOW_MINUTES
    ? (rawWindow as PublicHubActivityWindow)
    : '24h'
  const nowMs = useFreshnessClock()
  const hub = usePublicHubData({ enabled: true, activityWindow })
  // With no measured reply (still loading, an outage, or the stats-only fallback) the activity card names the range picked, not the empty payload's 30 min.
  const data = useMemo(() => {
    const base = hub.data ?? EMPTY_PUBLIC_HUB
    if (hub.data && hub.loadSource !== 'stats-fallback') return base
    return { ...base, activity: { ...base.activity, windowMinutes: ACTIVITY_WINDOW_MINUTES[activityWindow] ?? base.activity.windowMinutes } }
  }, [hub.data, hub.loadSource, activityWindow])
  // The requested range drives the range tab; the served range owns the bucket geometry.
  const servedActivityWindowMinutes = resolveHubActivityChartWindowMinutes(data.activity)

  const activityRangeOptions = useMemo(() => {
    const fallback = isHubActivityLivePoolFallback(data.activity)
    const supported = fallback
      ? optionsForBoundedActivityFallback(ACTIVITY_WINDOW_OPTIONS, activityWindow, '30m')
      : ACTIVITY_WINDOW_OPTIONS
    return supported.map((option) => {
      const requestedMinutes = ACTIVITY_WINDOW_MINUTES[option.key] ?? servedActivityWindowMinutes
      // Only the bounded live-pool fallback annotates longer options; a healthy reply proves nothing about them.
      if (!fallback || servedActivityWindowMinutes >= requestedMinutes || option.key === '30m') return option
      return {
        ...option,
        label: `${option.label} · ${compactWindowLabel(servedActivityWindowMinutes)} available`,
        description: `${option.label} requested; only ${formatActivityWindowLabel(servedActivityWindowMinutes)} is currently available`,
      }
    })
  }, [activityWindow, data.activity, servedActivityWindowMinutes])

  const loadingInitial = hub.loading && !hub.data
  // A #channels link lands once the sections have their real heights, not on the skeleton.
  useHashScrollHold(loadingInitial)
  useHubReturnScroll()
  const measurementAvailable = Boolean(hub.data && hub.loadSource !== 'stats-fallback')
  // A hub answer is on screen: not totals only, not a saved copy.
  const hubAnswered = measurementAvailable && hub.loadSource !== 'cache'
  // A saved copy can be hours old (S1, 10-28): Busiest now waits for fresh data, the chart says Saved and Channels gives the time.
  const savedAt = hub.data && hub.loadSource === 'cache' ? hub.cachedAt : null
  const hubReading = hub.loading || hub.refreshing || hub.hubReadPending
  // The hub read gave up (or failed) with no hub answer on screen and none under way. Any later read
  // (a poll, Try again, this window picked again) shows loading again while it runs.
  const hubGaveUp = !hubAnswered && !hubReading
  // With nothing measured on screen the cards wait while the hub read runs (to its hard cap), and say
  // "Unavailable right now." only once it gave up.
  const measurementsWaiting = !measurementAvailable && !hubGaveUp
  const measurementsUnavailable = !measurementAvailable && hubGaveUp
  // A read still under way with nothing on screen is loading, not an error.
  const hubUiState = resolveHubUiState({
    loading: hub.loading || hub.hubReadPending,
    data: hub.data,
    error: hub.error,
    hubEndpointOk: hub.hubEndpointOk,
    loadSource: hub.loadSource,
  })
  const activitySummary = useMemo(
    () => summarizeActivity(data.activity.points, servedActivityWindowMinutes, data.poolSize),
    [data.activity.points, data.poolSize, servedActivityWindowMinutes],
  )
  // The health banner and the note under the chart judge "settled" alike: first paint and a read past its deadline are not.
  const hubSettling = loadingInitial || hubUiState === 'loading'
  const minutesMissingNote = showsMinutesMissingNote(activitySummary, !hubSettling && !(hub.hubReadPending && hub.hubReadLate))

  // The bar card reads the points the chart draws, on the chart's bucket grid.
  const chartActivity = useMemo(() => {
    const inputs = selectHubChartActivityInputs(data)
    const ordered = inputs.points.filter((p) => p && Number.isFinite(p.t)).slice().sort((a, b) => a.t - b.t)
    return {
      points: inputs.points,
      bucketMinutes: hubBucketMinutes(inputs.windowMinutes, data.activity.bucketMinutes, pointSpacingMinutes(ordered)),
    }
  }, [data])

  // The window the answer on screen was read for. While a new range loads the old answer stays up, so the chat basis
  // follows the answer, not the tab: a 1y answer's long averages are never called recent (review 10-30).
  const answerWindow = Object.keys(ACTIVITY_WINDOW_MINUTES)
    .find((key) => ACTIVITY_WINDOW_MINUTES[key] === (data.activity.requestedWindowMinutes ?? data.activity.windowMinutes))
  // The emote map's interval read (C1, 10-30) and the bar lock's busiest chats (L1, 11-01) ask on the bucket grid the
  // answer uses: 30m on the live-pool fallback.
  const emoteBucketMinutes = data.activity.bucketMinutes ?? chartActivity.bucketMinutes
  const emoteIntervalWindow = (Object.keys(ACTIVITY_WINDOW_MINUTES) as PublicHubActivityWindow[])
    .find((key) => activityBucketMs(ACTIVITY_WINDOW_MINUTES[key]!) === emoteBucketMinutes * 60_000)
  const historyBehind = hubActivityBehindWords(data.activity)
  // Both locks read before the click (L1, 11-02): a bar the pointer rests on, then the busiest bars and top emotes' spikes.
  useHubV5LockWarmup({
    points: chartActivity.points,
    bucketMinutes: emoteBucketMinutes,
    intervalWindow: emoteIntervalWindow,
    ready: measurementAvailable && savedAt == null,
  })
  const games = useMemo(() => whereChatIs(data.liveChannels, undefined, answerWindow), [data.liveChannels, answerWindow])
  const gameArt = useMemo(() => hubCategoryArt(data.livePulseMoments), [data.livePulseMoments])
  // Top moments today and its phone peek stay in every state: the Moments list, a hub answer or a saved copy (never
  // totals only), waiting on any hub read under way, else unavailable. The list is read with each hub read, answered or not.
  // Under 10 hub rows, the busiest minutes in the locks' reads fill in (board 2A, 11-02).
  const busiest = useHubV5BusiestMoments(emoteIntervalWindow)
  const top = useTopToday({
    hub: hubAnswered || savedAt != null ? hub.data : null,
    savedAt,
    reading: !hubGaveUp,
    attempt: hub.pollAttempt,
    nowMs,
    busiest,
  })
  const avatars = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of data.liveChannels) if (c.profileImageUrl) map.set(c.login, c.profileImageUrl)
    return map
  }, [data.liveChannels])
  // While Busiest now holds its place for an answer, it waits. The featured stream's card under it is folded into it
  // (H1, 11-19): the stream is one of its tiles, and its strongest moment is in Top moments today.
  const busiestWaiting = measurementsWaiting || (savedAt != null && !hubGaveUp)
  // A counts outage on a fresh answer (H1, 11-19): Busiest now says so once, and Picking up now and Where chat is,
  // which rank by the same counts, step aside until they are back.
  const countsDown = hubAnswered && savedAt == null && screenerDown(data.liveChannels)

  // The game filter lives in the link (?game=, 3A), so the front page's search can open the hub on a game; any game a
  // live channel is counted in can be picked from the search, not only the rack's top 16.
  const game = searchParams.get('game') || null
  const channelsRef = useRef<HTMLElement>(null)
  const writeGame = useCallback((next: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (next) params.set('game', next)
      else params.delete('game')
      return params
    }, { replace: true })
  }, [setSearchParams])
  // A game no live channel is counted in any more (a new poll) drops its filter, once there is an answer to judge by.
  useEffect(() => {
    if (game && hubAnswered && !games.all.some((g) => g.name === game)) writeGame(null)
  }, [game, games, hubAnswered, writeGame])
  /** The filtered table comes into view only when it is off screen. */
  const showChannels = useCallback(() => {
    const section = channelsRef.current
    if (!section) return
    const top = section.getBoundingClientRect().top
    if (top > window.innerHeight - 160 || top < 0) {
      section.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
  }, [])
  const setGame = useCallback((next: string | null) => {
    writeGame(next)
    if (next) showChannels()
  }, [writeGame, showChannels])
  // Opened on a game (/analytics?game=…): the table comes into view once the answer has its rows.
  const gameOnOpen = useRef(Boolean(game))
  useEffect(() => {
    if (!gameOnOpen.current || !hubAnswered) return
    gameOnOpen.current = false
    if (game) requestAnimationFrame(showChannels)
  }, [game, hubAnswered, showChannels])

  // What the search offers besides channels (3A): the games the filter can list and the emotes the map has.
  const searchGames = useMemo(() => hubSearchGames(games, gameArt), [games, gameArt])
  const searchEmotes = useMemo(() => hubSearchEmotes(chartActivity.points), [chartActivity.points])
  // the hub's animated top emotes, one set while the flags stay the same: the conveyor asks 7TV for their stills
  const animatedKey = useMemo(() => animatedFlagsKey(data.topEmotes), [data.topEmotes])
  const animatedEmotes = useMemo(() => animatedFlagsFromKey(animatedKey), [animatedKey])
  // A picked emote is found on the map; ?emote= (from the front page's search) asks once, on open.
  const [emoteFind, setEmoteFind] = useState<{ name: string; n: number } | null>(() => {
    const name = searchParams.get('emote')
    return name ? { name, n: 1 } : null
  })
  useEffect(() => {
    const actions = searchStore.actions
    actions.game = setGame
    actions.emote = (name: string) => setEmoteFind((prev) => ({ name, n: (prev?.n ?? 0) + 1 }))
    return () => {
      actions.game = null
      actions.emote = null
    }
  }, [searchStore, setGame])

  const [measuredBody, setMeasuredBody] = useState<HTMLDivElement | null>(null)
  const measuredRef = useRef<HTMLDetailsElement>(null)
  // The chart's (i): open "How this is measured" and bring it into view.
  const openMeasured = useCallback(() => {
    const details = measuredRef.current
    if (!details) return
    details.open = true
    details.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }, [])

  return (
    <HubV5SearchContext.Provider value={searchStore}>
      <AnalyticsFigmaShell hideSidebar topNavDock={<HubV5DockSearch live={data.liveChannels} games={searchGames} emotes={searchEmotes} />} topNavInstall={<HubV5BarInstall />}>
        <main className="figma-analytics__main" aria-label="StreamPulse analytics" data-hub-state={hubUiState}>
          <div id="analytics-main" tabIndex={-1} className="analytics-focus-target">Analytics content</div>
          {/* A saved copy can be hours old: it names its time, and its day when that is not today (N1), for as long as it is on screen, never reading as live. */}
          {hub.loadSource === 'cache' && hub.cachedAt != null ? (
            <div className="figma-hub-fallback-banner figma-hub-fallback-banner--info" role="status">
              {formatCachedSnapshotNotice(hub.cachedAt, nowMs)}{hub.refreshing || hub.hubReadPending ? ' · refreshing...' : ''}
            </div>
          ) : null}
          <HubDataHealthBanner
            loadSource={hub.loadSource}
            hubEndpointOk={hub.hubEndpointOk}
            activitySummary={activitySummary}
            pipeline={data.corpusPipeline}
            coverageState={measurementAvailable ? data.coverage.state : undefined}
            coverageDatabaseOk={measurementAvailable ? data.coverage.databaseOk : undefined}
            liveRosterCount={data.coverage.liveChannels}
            error={hub.error}
            backendUrl={getBackendUrl()}
            loading={hubSettling}
            onRetry={hub.retryBlocked ? undefined : hub.refresh}
            retryDisabled={hub.refreshing || hub.hubReadRunning || hub.hubReadPending}
            pending={hub.hubReadPending}
            late={hub.hubReadLate}
          />
          <HubBackendSourceBanner />

          <div className="hub-v5 hub-d3" data-hub-v5-page="" data-counts-down={countsDown ? '' : undefined}>
            <HubV5Hero live={data.liveChannels} poolSize={data.poolSize} points={data.activity.points} animated={animatedEmotes} foot={<HubV5FollowsButton />} games={searchGames} emotes={searchEmotes} waiting={measurementsWaiting} />
            {/* Without scripts the cards never fill, so the prerendered page names the tracked channels for readers and
                crawlers that do not run them. React renders a noscript's children only on the server. */}
            <noscript>
              <p>Live measurements load when JavaScript is available. Coverage and freshness are shown with the data.</p>
              <StreamerChatStats browse={false} />
            </noscript>

            {/* The viewer's own live follows, on Busiest now's live list and rate (Show my Twitch follows, 11-01). */}
            <HubV5Follows
              live={savedAt != null ? EMPTY_PUBLIC_HUB.liveChannels : data.liveChannels}
              nowMs={nowMs}
              loading={busiestWaiting}
              unavailable={measurementsUnavailable || (savedAt != null && hubGaveUp)}
              windowKey={answerWindow}
              poolSize={data.poolSize}
            />

            <HubV5Busiest
              live={savedAt != null ? EMPTY_PUBLIC_HUB.liveChannels : data.liveChannels}
              nowMs={nowMs}
              loading={busiestWaiting}
              unavailable={measurementsUnavailable || (savedAt != null && hubGaveUp)}
              windowKey={answerWindow}
              countsDown={countsDown}
            />

            {/* Which emotes, before the chart (H1, 11-19): a chip finds its emote on the emote map below. The row is the
                answer's recent emote pool, not the chart's range: it names the window the backend stamps on that
                pool, else "Recent window" (11-19). */}
            <HubV5EmoteRow emotes={data.topEmotes} windowMinutes={data.emoteIntel.windowMinutes} loading={measurementsWaiting} unavailable={measurementsUnavailable} />

            <div id="activity" className="hv5-sec hv5-activity">
              {hub.error && measurementAvailable && ACTIVITY_WINDOW_MINUTES[activityWindow] !== (data.activity.requestedWindowMinutes ?? data.activity.windowMinutes) ? (
                <p className="figma-hub-fallback-banner" role="status">
                  Could not load {activityWindow} activity. Retaining the last {formatActivityWindowLabel(servedActivityWindowMinutes)} snapshot.
                </p>
              ) : null}
              <HubActivityPanelV5
                unavailable={measurementsUnavailable}
                hub={data}
                activitySummary={activitySummary}
                suggestions={[]}
                topEmotes={data.topEmotes}
                loading={measurementsWaiting || hub.activityRefreshing}
                awaitingData={measurementsWaiting}
                activityRefreshing={hub.activityRefreshing}
                updatedAgo={formatUpdatedAgo(hub.dataAsOf, nowMs)}
                lastAppliedAgo={formatUpdatedAgo(hub.displayedSnapshotAt, nowMs)}
                lastAppliedFromCache={hub.loadSource === 'cache'}
                rangeControl={{
                  active: activityWindow,
                  options: activityRangeOptions,
                  onSelect: (key) => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev)
                      next.set('window', key)
                      return next
                    }, { replace: true })
                  },
                }}
                activityWindowKey={activityWindow}
                measuredTarget={measuredBody}
                onOpenMeasured={openMeasured}
                saved={savedAt != null}
                minutesMissingNote={minutesMissingNote}
              />
            </div>

            {/* Mounted while the hub read runs, so its place is kept for the answer. */}
            {measurementsUnavailable ? null : (
              <HubV5BarCard
                points={chartActivity.points}
                bucketMinutes={chartActivity.bucketMinutes}
                moments={data.livePulseMoments}
                avatars={avatars}
                intervalWindow={emoteIntervalWindow}
                intervalBucketMinutes={emoteBucketMinutes}
                historyBehind={historyBehind}
              />
            )}

            {/* The day's best, as a still list of 5 (H1, 11-19: in place of the "Top today" peek and the carousel). */}
            <HubV5TopList top={top} nowMs={nowMs} />

            {/* M1 (11-02): the rail is what is heating up now. It ranks by the 5-minute counts, so it steps aside while they are down. */}
            {countsDown ? null : <HubV5PickingUp top={top} nowMs={nowMs} />}

            <HubV5EmoteMap
              points={chartActivity.points}
              bucketMinutes={emoteBucketMinutes}
              loading={measurementsWaiting}
              unavailable={measurementsUnavailable}
              moments={data.livePulseMoments}
              avatars={avatars}
              nowMs={nowMs}
              intervalWindow={emoteIntervalWindow}
              historyBehind={historyBehind}
              topEmotes={data.topEmotes}
              findRequest={emoteFind}
            />

            {countsDown ? null : <HubV5Rack games={games} game={game} onGame={setGame} art={gameArt} avatars={avatars} loading={measurementsWaiting} unavailable={measurementsUnavailable} />}

            <HubV5Channels
              ref={channelsRef}
              live={data.liveChannels}
              poolSize={data.poolSize}
              unavailable={measurementsUnavailable}
              loading={measurementsWaiting}
              savedAt={savedAt}
              nowMs={nowMs}
              game={game}
              onClearGame={() => writeGame(null)}
              windowKey={answerWindow}
            />

            <details id="measured" className="hv5-sec hv5-dis" ref={measuredRef}>
              <summary><HubV5Icon name="right" />How this is measured</summary>
              <div className="hv5-dis-body" ref={setMeasuredBody} />
            </details>
          </div>
        </main>
      </AnalyticsFigmaShell>
    </HubV5SearchContext.Provider>
  )
}
