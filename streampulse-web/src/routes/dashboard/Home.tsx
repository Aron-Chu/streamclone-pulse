import { useMemo, useState } from 'react'
import { Activity, Radio, Search, Smile, Zap } from 'lucide-react'
import { useHubRecentLogins } from '../../hooks/useHubRecentLogins'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { buildAnalyticsHref } from '../../lib/analyticsLinks'
import { featuredSessionFromPublicHub } from '../../lib/figmaSessionAnalytics'
import { getBackendUrl } from '../../lib/apiClient'
import { resolveBackendSource } from '../../lib/backendSource'
import { summarizeActivity } from '../../lib/hubActivitySummary'
import { HUB_TOP_MOVERS_CAP, normalizePublicHub, resolveHubTopMovers, type PublicHubActivityWindow } from '../../lib/publicHub'
import type { RecentSessionRow } from '../../hooks/useAnalyticsHubData'
import '../../ui/components/hub/hub.css'
import {
  Card,
  CardContent,
  CardHeader,
  CorpusPipelineCard,
  CoverageHealthList,
  EmoteSignalSection,
  GlobalEmotesList,
  HubActivityChart,
  HubDataHealthBanner,
  HubLiveTable,
  HubSearch,
  HubSidebar,
  HubSubbar,
  MomentsFeedList,
  RecentSessionsPanel,
  TopMoversList,
  TopStreamersRail,
  compact,
  type HubSuggestion,
} from '../../ui/components/hub'
import { FigmaSessionDashboard } from '../../ui/components/analytics/FigmaSessionDashboard'
import '../../ui/components/analytics/figma-analytics.css'

const FALLBACK_SUGGESTIONS: HubSuggestion[] = [
  { login: 'xqc', displayName: 'xQc', category: 'Just Chatting' },
  { login: 'caseoh_', displayName: 'caseoh_', category: 'Just Chatting' },
  { login: 'sodapoppin', displayName: 'sodapoppin', category: 'Variety' },
  { login: 'jynxzi', displayName: 'Jynxzi', category: 'Rainbow Six Siege' },
]

const CORPUS_STRIP: Array<{
  label: string
  key: 'streamsTracked' | 'emotesIndexed' | 'chatMessagesProcessed' | 'vodsAnalyzed'
  accent: string
  hint: string
}> = [
  {
    label: 'Channels tracked',
    key: 'streamsTracked',
    accent: 'var(--hx-accent-text)',
    hint: 'Channels indexed in the public corpus',
  },
  {
    label: 'Total emotes',
    key: 'emotesIndexed',
    accent: 'hsl(var(--chart-3))',
    hint: 'Distinct emotes seen across all providers',
  },
  {
    label: 'Chat processed',
    key: 'chatMessagesProcessed',
    accent: 'hsl(var(--chart-1))',
    hint: 'Aggregate chat messages in the corpus',
  },
  {
    label: 'Streams indexed',
    key: 'vodsAnalyzed',
    accent: 'hsl(var(--chart-4))',
    hint: 'Imported VOD and legacy sessions indexed',
  },
]

const ACTIVITY_WINDOWS: Array<{ label: string; value: PublicHubActivityWindow }> = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '1mo', value: '1m' },
  { label: '1 year', value: '1y' },
]

export default function DashboardHome() {
  const [navOpen, setNavOpen] = useState(false)
  const [activityWindow, setActivityWindow] = useState<PublicHubActivityWindow>('24h')
  const recentLogins = useHubRecentLogins()
  const hub = usePublicHubData({ enabled: true, activityWindow })
  const data = normalizePublicHub(hub.data)
  const liveChannels = data.liveChannels
  const backendUrl = getBackendUrl()
  const backendSource = resolveBackendSource(backendUrl)
  const updatedLabel = hub.lastUpdated
    ? `Updated ${new Date(hub.lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'Waiting for data'
  const activitySummary = useMemo(
    () => summarizeActivity(data.activity.points, data.activity.windowMinutes, data.poolSize),
    [data.poolSize, data.activity.points, data.activity.windowMinutes],
  )
  const suggestions = useMemo<HubSuggestion[]>(() => {
    const seen = new Set<string>()
    const rows: HubSuggestion[] = []
    const add = (item: HubSuggestion) => {
      const login = item.login.trim().toLowerCase()
      if (!login || seen.has(login)) return
      seen.add(login)
      rows.push({ ...item, login })
    }
    liveChannels.forEach((channel) =>
      add({
        login: channel.login,
        displayName: channel.displayName,
        category: channel.category,
        viewers: channel.viewers,
        profileImageUrl: channel.profileImageUrl,
        live: true,
      }),
    )
    data.topMovers.slice(0, HUB_TOP_MOVERS_CAP).forEach((mover) =>
      add({
        login: mover.login,
        displayName: mover.displayName,
        category: mover.category,
        viewers: mover.viewers,
        profileImageUrl: mover.profileImageUrl,
        live: liveChannels.some((channel) => channel.login.toLowerCase() === mover.login.toLowerCase()),
      }),
    )
    recentLogins.forEach(({ login }) =>
      add({
        login,
        live: liveChannels.some((channel) => channel.login.toLowerCase() === login.toLowerCase()),
      }),
    )
    FALLBACK_SUGGESTIONS.forEach((item) =>
      add({
        ...item,
        live: liveChannels.some((channel) => channel.login.toLowerCase() === item.login.toLowerCase()),
      }),
    )
    return rows
  }, [data.topMovers, liveChannels, recentLogins])
  const topMovers = useMemo(
    () => resolveHubTopMovers(data.topMovers, liveChannels),
    [data.topMovers, liveChannels],
  )
  const recentSessions = useMemo<RecentSessionRow[]>(() => {
    const imageByLogin = new Map<string, string>()
    const nameByLogin = new Map<string, string>()
    for (const channel of liveChannels) {
      const key = channel.login.toLowerCase()
      if (channel.profileImageUrl) imageByLogin.set(key, channel.profileImageUrl)
      if (channel.displayName?.trim()) nameByLogin.set(key, channel.displayName.trim())
    }
    for (const mover of data.topMovers) {
      const key = mover.login.toLowerCase()
      if (mover.profileImageUrl && !imageByLogin.has(key)) imageByLogin.set(key, mover.profileImageUrl)
      if (mover.displayName?.trim() && !nameByLogin.has(key)) nameByLogin.set(key, mover.displayName.trim())
    }
    return recentLogins.map((entry) => {
      const key = entry.login.toLowerCase()
      return {
        login: entry.login,
        streamId: '',
        title: nameByLogin.get(key) ?? entry.login,
        startedAt: entry.openedAt,
        profileImageUrl: imageByLogin.get(key),
        syncBadge: 'Stats only',
      }
    })
  }, [recentLogins, liveChannels, data.topMovers])
  const spark = data.activity.points.slice(-18).map((point) => Math.max(point.chat, point.seventv, point.emotes ?? 0))
  const loadingInitial = hub.loading && !hub.data
  const pipelineState = data.corpusPipeline.state
  const collectorExpected = data.corpusPipeline.roster.expectedCollectorRows
    || Math.min(data.corpusPipeline.roster.live, data.corpusPipeline.collectorMax || data.corpusPipeline.roster.live)
  const collectorStatus = data.corpusPipeline.state === 'critical'
    ? `IRC critical: ${compact(data.corpusPipeline.roster.collectorTracking)} / ${compact(collectorExpected)} tracked · ${compact(data.corpusPipeline.roster.metadataStale)} stale · ${compact(data.corpusPipeline.roster.admissionDisabled)} admission off`
    : data.corpusPipeline.state === 'degraded'
      ? `IRC degraded: ${compact(data.corpusPipeline.roster.collectorTracking)} / ${compact(collectorExpected)} tracked · ${compact(data.corpusPipeline.roster.liveCollectorDeficitRows)} uncovered`
      : 'Collector health is normal. Coverage and peaks come from the backend.'
  const coveragePctLabel =
    data.coverage.state === 'operational' ? '100%' : data.coverage.state === 'degraded' ? 'Degraded' : 'Critical'
  const featuredSession = useMemo(() => featuredSessionFromPublicHub(data), [data])

  return (
    <div className="hubx" data-nav-open={navOpen ? 'true' : undefined}>
      <a href="#analytics-main" className="hx-skip">Skip to analytics</a>
      <HubSidebar
        liveCount={data.coverage.liveChannels}
        emotesIndexed={data.coverage.emotesIndexed || data.corpus.emotesIndexed}
        streamsTracked={data.corpus.streamsTracked}
        onNavigate={() => setNavOpen(false)}
      />
      <div className="hx-main-col">
        <HubSubbar
          crumbTrail="StreamPulse"
          crumbCurrent="Analytics"
          statusLabel={hub.error ? 'Degraded' : hub.refreshing ? 'Refreshing' : 'Live'}
          statusTone={hub.error && !hub.data ? 'down' : 'live'}
          updatedLabel={updatedLabel}
          refreshing={hub.refreshing}
          onRefresh={hub.refresh}
          onMenu={() => setNavOpen(true)}
          backendSource={backendSource}
          search={
            <div className="hx-subbar__search">
              <HubSearch suggestions={suggestions} size="sm" placeholder="Jump to a channel" />
            </div>
          }
        />

        <main className="hx-content" id="analytics-main" aria-label="StreamPulse analytics hub">
          <HubDataHealthBanner
            loadSource={hub.loadSource ?? 'full'}
            hubEndpointOk={hub.hubEndpointOk}
            activitySummary={activitySummary}
            pipeline={data.corpusPipeline}
            liveRosterCount={data.coverage.liveChannels}
            error={hub.error}
            backendUrl={backendUrl}
          />

          <section className="hx-hero" aria-labelledby="analytics-hub-title">
            <div className="hx-hero-grid">
              <aside className="hx-hero-aside" aria-label="Command center">
                <div className="hx-hero-aside__eyebrow">Command center</div>
                <p className="hx-hero-aside__desc">Tracks aggregate stats for the tracked channel set.</p>
                {[
                  { label: 'Live channels', value: compact(data.coverage.liveChannels), color: 'var(--hx-accent-text)' },
                  { label: 'Rollup coverage', value: activitySummary.coveragePct > 0 ? `${Math.round(activitySummary.coveragePct)}%` : '—', color: 'hsl(var(--chart-3))' },
                  { label: 'Emote economy', value: data.emoteIntel.emotesPerMin > 0 ? `${compact(data.emoteIntel.emotesPerMin)}/m` : '—', color: 'hsl(var(--chart-1))' },
                  { label: 'Recent streams', value: compact(data.corpus.streamsTracked), color: 'hsl(var(--muted-foreground))' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="hx-hero-stat">
                    <span>{label}</span>
                    <b style={{ color }}>{value}</b>
                  </div>
                ))}
              </aside>

              <div className="hx-hero-main">
                <div className="eyebrow">
                  <span className="hx-badge hx-badge--live"><span className="dot" />Public aggregate hub</span>
                </div>
                <h1 id="analytics-hub-title">
                  Stream intelligence
                  <br />
                  command center
                </h1>
                <p>
                  Track live Twitch rooms, find spikes, and see live IRC + Helix coverage across the tracked network.
                  Search any login to open channel analytics.
                </p>
                <div className="hx-herosearch" role="search" aria-label="Channel search">
                  <span className="hx-herosearch__cap"><Search aria-hidden="true" />Open analytics console</span>
                  <HubSearch suggestions={suggestions} showKbd showOpenButton placeholder="Search channels…" />
                  {suggestions.length > 0 ? (
                    <div className="hx-herosearch__picks">
                      <span className="lbl">Recent picks</span>
                      {suggestions.slice(0, 5).map((channel) => (
                        <a key={channel.login} href={buildAnalyticsHref({ login: channel.login })} className="hx-pick">
                          {channel.displayName?.trim() || channel.login}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1.1rem', marginBottom: '0.55rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="hx-badge hx-badge--live"><span className="dot" /></span>
                    <strong style={{ fontSize: '0.82rem' }}>Live channels</strong>
                  </div>
                  <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>
                    Loaded {Math.min(liveChannels.length, 20)} / {compact(data.coverage.liveChannels)} live
                  </span>
                </div>
                <TopStreamersRail channels={liveChannels} loading={loadingInitial} />
              </div>

              <aside className="hx-hero-aside hx-hero-aside--end" aria-label="Quick status">
                <div className="hx-status-card">
                  <div className="hx-status-card__lbl">Coverage</div>
                  <div className="hx-status-card__val" style={{ color: 'hsl(var(--chart-3))' }}>{coveragePctLabel}</div>
                  <div className="hx-status-card__sub">Live frontline {data.coverage.state}</div>
                </div>
                <div className="hx-status-card">
                  <div className="hx-status-card__lbl">Collector</div>
                  <div className="hx-status-card__val" style={{ color: pipelineState === 'critical' ? 'hsl(var(--chart-5))' : 'var(--hx-accent-text)' }}>
                    {pipelineState}
                  </div>
                  <div className="hx-status-card__sub">
                    {data.corpusPipeline.collectorActive > 0
                      ? `${compact(data.corpusPipeline.collectorActive)}/${compact(data.corpusPipeline.collectorMax)} IRC slots active`
                      : 'Collector health from backend'}
                  </div>
                </div>
                <div className="hx-status-card" style={{ flex: 1 }}>
                  <div className="hx-status-card__lbl">Quick status</div>
                  <div className="hx-status-card__sub" style={{ marginTop: 0 }}>
                    {hub.error && !hub.data
                      ? 'Hub endpoint degraded — showing fallback counts if available.'
                      : collectorStatus}
                  </div>
                </div>
              </aside>
            </div>

            <div className="hx-corpus-strip" aria-label="Network snapshot">
              <span className="hx-corpus-strip__lbl">Network snapshot</span>
              {CORPUS_STRIP.map(({ label, key, accent, hint }) => (
                <div key={key} className="hx-corpus-strip__item" title={hint}>
                  <small>{label}</small>
                  <strong style={{ color: accent }}>{compact(data.corpus[key])}{key === 'streamsTracked' || key === 'emotesIndexed' ? '+' : ''}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="hx-moment-band" aria-labelledby="hub-moments-title">
            <Card ariaLabelledby="hub-moments-title">
              <CardHeader
                title="Moment feed"
                titleId="hub-moments-title"
                desc="Live spikes, go-live events, and backfill activity with emote context from the recent window."
              />
              <CardContent>
                <MomentsFeedList moments={data.moments} loading={loadingInitial} />
              </CardContent>
            </Card>
          </section>

          <FigmaSessionDashboard model={featuredSession} />

          <Card id="hx-command" ariaLabelledby="hub-activity-title">
            <CardHeader
              row
              title="Global activity"
              titleId="hub-activity-title"
              desc="Viewer line, chat-volume bars, and emote-provider velocity. Live rollups break out 7TV; other providers appear when per-emote rollups exist."
              action={
                <div className="hx-chart-card-actions">
                  <div className="hx-range-tabs" role="group" aria-label="Activity window">
                    {ACTIVITY_WINDOWS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={activityWindow === option.value ? 'is-active' : undefined}
                        aria-pressed={activityWindow === option.value}
                        onClick={() => setActivityWindow(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <span className="hx-badge hx-badge--outline">{activitySummary.footnote}</span>
                </div>
              }
            />
            <CardContent>
              <HubActivityChart
                points={data.activity.points}
                windowMinutes={data.activity.windowMinutes}
                channelCount={data.activity.channelCount}
                poolSize={data.poolSize}
                expectedBuckets={activitySummary.expectedBuckets}
                missingBuckets={activitySummary.missingBuckets}
                coveragePct={activitySummary.coveragePct}
                loading={loadingInitial}
              />
            </CardContent>
          </Card>

          <EmoteSignalSection
            intel={data.emoteIntel}
            topEmotes={data.topEmotes}
            spark={spark}
            loading={loadingInitial}
            kpiIcons={{ emotes: <Smile />, unique: <Zap />, seventv: <Activity />, peak: <Radio /> }}
            kpiValues={{
              emotesPerMin: compact(data.emoteIntel.emotesPerMin),
              uniqueEmotes: compact(data.emoteIntel.uniqueEmotes),
              seventvShare: `${Math.round(data.emoteIntel.seventvSharePct)}%`,
              biggestPeak: `${compact(data.emoteIntel.biggestPeakPerMin)}/m`,
            }}
          />

          <section className="hx-cols" aria-label="Live analytics directory">
            <div className="hx-cols__main">
              <Card id="hx-live" ariaLabelledby="hub-live-table-title">
                <HubLiveTable channels={liveChannels} loading={loadingInitial} />
              </Card>
            </div>

            <aside className="hx-rail" aria-label="Analytics rail">
              <Card ariaLabelledby="hub-movers-title">
                <CardHeader title="Top movers" titleId="hub-movers-title" desc="Channels with the strongest current emote velocity." />
                <CardContent>
                  <TopMoversList
                    movers={topMovers}
                    loading={loadingInitial}
                    honesty={{
                      rosterLive: data.corpusPipeline.roster.live,
                      collectorTracking: data.corpusPipeline.roster.collectorTracking,
                      poolSize: data.poolSize,
                      windowMinutes: data.activity.windowMinutes,
                    }}
                  />
                </CardContent>
              </Card>
              <Card ariaLabelledby="hub-emotes-rail-title">
                <CardHeader title="Global emotes" titleId="hub-emotes-rail-title" desc="Top aggregate emotes in the live window." />
                <CardContent>
                  <GlobalEmotesList emotes={data.topEmotes} loading={loadingInitial} />
                </CardContent>
              </Card>
              <Card ariaLabelledby="hub-sessions-title">
                <CardHeader title="Recent channels" titleId="hub-sessions-title" desc="Local shortcuts from channels you opened recently." />
                <CardContent>
                  <RecentSessionsPanel sessions={recentSessions} loading={false} historyUnavailable={false} />
                </CardContent>
              </Card>
            </aside>
          </section>

          <section className="hx-diagnostics" aria-label="System diagnostics">
            <CorpusPipelineCard pipeline={data.corpusPipeline} loading={loadingInitial} stripLayout />
            <Card id="hx-coverage" ariaLabelledby="hub-coverage-title">
              <CardHeader title="Coverage health" titleId="hub-coverage-title" desc="IRC, database, and collector queue state." />
              <CardContent>
                <CoverageHealthList coverage={data.coverage} emoteIntel={data.emoteIntel} pipeline={data.corpusPipeline} />
              </CardContent>
            </Card>
          </section>

          <footer className="hx-footer">
            <span>Public aggregate hub</span><span className="dot" /><span>Search opens Streamclone analytics parity</span><span className="dot" /><span>No client-side scoring</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
