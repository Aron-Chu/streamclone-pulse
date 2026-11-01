/**
 * /analytics as the d3-v5 hub. Ported from the approved mockup (d3-v5
 * hub.html): the
 * search hero with the emote conveyor behind it (R5-15 at Soft), Busiest now,
 * the activity chart, Top moments today (D1, 10-30; a "Top today" peek under
 * the hero on phones), Your follows above Busiest now once the viewer shows
 * their Twitch follows (11-01), Top emotes as the emote map (R5-13), Where chat is as
 * the ranked rack (R5-22), Channels and one "How this is measured" disclosure
 * on the d3 grid (one column on phones, the rail beside the page from 1536 px).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { optionsForBoundedActivityFallback } from '../../lib/activityRangeCapabilities'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { getBackendUrl } from '../../lib/apiClient'
import { hubActivityBehindWords } from '../../lib/hubActivityFallbackLine'
import { activityBucketMs, formatActivityWindowLabel, summarizeActivity } from '../../lib/hubActivitySummary'
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
import { HubV5Follows, HubV5FollowsButton } from '../../ui/components/hub/v5/HubV5Follows'
import { HubV5Hero } from '../../ui/components/hub/v5/HubV5Hero'
import { HubV5Icon } from '../../ui/components/hub/v5/HubV5Icon'
import { HubV5MostChat, mostChatModel } from '../../ui/components/hub/v5/HubV5MostChat'
import { HubV5Rack } from '../../ui/components/hub/v5/HubV5Rack'
import { HubV5TopMoments, HubV5TopPeek, useTopToday } from '../../ui/components/hub/v5/HubV5TopMoments'
import { HUB_BUSIEST_COUNT, HUB_RACK_ROWS, hubCategoryArt, hubChatBasis, hubSavedAt, rankBusiest, whereChatIs, type HubChannelSort } from '../../ui/components/hub/v5/hubV5Model'
import { useHashScrollHold } from '../../ui/RouteScrollManager'
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
  const games = useMemo(() => whereChatIs(data.liveChannels, undefined, answerWindow), [data.liveChannels, answerWindow])
  const gameArt = useMemo(() => hubCategoryArt(data.livePulseMoments), [data.livePulseMoments])
  // Top moments today and its phone peek stay in every state: the Moments list, a hub answer or a saved copy (never
  // totals only), waiting on any hub read under way, else unavailable. The list is read with each hub read, answered or not.
  const top = useTopToday({
    hub: hubAnswered || savedAt != null ? hub.data : null,
    savedAt,
    reading: !hubGaveUp,
    attempt: hub.pollAttempt,
    nowMs,
  })
  const avatars = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of data.liveChannels) if (c.profileImageUrl) map.set(c.login, c.profileImageUrl)
    return map
  }, [data.liveChannels])
  // The featured stream (picks I1 and I1b, 10-30) shows on every hub answer that has a ready one: never on a saved copy
  // or totals only, where Busiest now shows no rows. A failed later read keeps it, as Busiest now keeps its rows; the
  // health banner above says the read failed. Its chat/min shows only beside a list on the same rate: Busiest now on
  // recent averages, with the stream one of its rows (reviews 10-30: never beside the 5-minute counts, never a stream
  // Busiest now leaves out). Its name and game come from the stream's live row, the one Busiest now shows when it lists
  // the stream (pick 15B). While Busiest now holds its place for an answer, a grey block holds the card's (pick K1).
  const busiestWaiting = measurementsWaiting || (savedAt != null && !hubGaveUp)
  const mostChatFeatured = hubAnswered ? data.featuredSession : null
  const mostChatLogin = mostChatModel(data.featuredSession)?.login
  const mostChatLive = useMemo(
    () => (mostChatLogin ? data.liveChannels.find((c) => c.login.toLowerCase() === mostChatLogin) ?? null : null),
    [data.liveChannels, mostChatLogin],
  )
  const mostChatRate = useMemo(() => {
    if (!hubAnswered || hubChatBasis(data.liveChannels, answerWindow) !== 'avg_35') return false
    return Boolean(mostChatLogin) && rankBusiest(data.liveChannels, HUB_BUSIEST_COUNT, 'avg_35').rows.some((row) => row.login.toLowerCase() === mostChatLogin)
  }, [hubAnswered, data.liveChannels, mostChatLogin, answerWindow])

  const [game, setGameState] = useState<string | null>(null)
  const channelsRef = useRef<HTMLElement>(null)
  // A game that left the rack (a new poll) drops its filter.
  useEffect(() => {
    if (game && !games.all.slice(0, HUB_RACK_ROWS).some((g) => g.name === game)) setGameState(null)
  }, [game, games])
  const setGame = useCallback((next: string | null) => {
    setGameState(next)
    if (!next) return
    // The filtered table comes into view only when it is off screen.
    const section = channelsRef.current
    if (!section) return
    const top = section.getBoundingClientRect().top
    if (top > window.innerHeight - 160 || top < 0) {
      section.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
  }, [])

  // Picking up's "+N more in Channels": Channels sorted by chat vs own avg, brought into view.
  const [sortRequest, setSortRequest] = useState<{ id: number; sort: HubChannelSort; dir: 1 | -1 } | null>(null)
  const showUpInChannels = useCallback(() => {
    setGameState(null)
    setSortRequest({ id: Date.now(), sort: 'vs', dir: -1 })
    channelsRef.current?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [])

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
    <AnalyticsFigmaShell hideSidebar>
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
          loading={loadingInitial || hubUiState === 'loading'}
          onRetry={hub.retryBlocked ? undefined : hub.refresh}
          retryDisabled={hub.refreshing || hub.hubReadRunning || hub.hubReadPending}
          pending={hub.hubReadPending}
          late={hub.hubReadLate}
        />
        <HubBackendSourceBanner />

        <div className="hub-v5 hub-d3" data-hub-v5-page="">
          <HubV5Hero live={data.liveChannels} poolSize={data.poolSize} points={data.activity.points} foot={<HubV5FollowsButton />} />

          {/* The viewer's own live follows, on Busiest now's live list and rate (Show my Twitch follows, 11-01). */}
          <HubV5Follows
            live={savedAt != null ? EMPTY_PUBLIC_HUB.liveChannels : data.liveChannels}
            nowMs={nowMs}
            loading={busiestWaiting}
            unavailable={measurementsUnavailable || (savedAt != null && hubGaveUp)}
            windowKey={answerWindow}
            poolSize={data.poolSize}
          />

          <HubV5TopPeek top={top} nowMs={nowMs} />

          <HubV5Busiest
            live={savedAt != null ? EMPTY_PUBLIC_HUB.liveChannels : data.liveChannels}
            nowMs={nowMs}
            loading={busiestWaiting}
            unavailable={measurementsUnavailable || (savedAt != null && hubGaveUp)}
            windowKey={answerWindow}
          />

          {/* The featured stream (picks I1 and I1b, 10-30): its chat/min only while Busiest now ranks by the same recent average and lists it. */}
          <HubV5MostChat featured={mostChatFeatured} showRate={mostChatRate} live={mostChatLive} avatars={avatars} waiting={busiestWaiting} />

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

          <HubV5TopMoments top={top} nowMs={nowMs} onUpMore={showUpInChannels} />

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
          />

          <HubV5Rack games={games} game={game} onGame={setGame} art={gameArt} avatars={avatars} loading={measurementsWaiting} unavailable={measurementsUnavailable} />

          <HubV5Channels
            ref={channelsRef}
            live={data.liveChannels}
            poolSize={data.poolSize}
            unavailable={measurementsUnavailable}
            loading={measurementsWaiting}
            savedAt={savedAt}
            nowMs={nowMs}
            game={game}
            onClearGame={() => setGameState(null)}
            sortRequest={sortRequest}
            windowKey={answerWindow}
          />

          <details id="measured" className="hv5-sec hv5-dis" ref={measuredRef}>
            <summary><HubV5Icon name="right" />How this is measured</summary>
            <div className="hv5-dis-body" ref={setMeasuredBody} />
          </details>
        </div>
      </main>
    </AnalyticsFigmaShell>
  )
}
