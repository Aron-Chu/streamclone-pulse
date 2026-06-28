import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAnalyticsHubData } from '../../hooks/useAnalyticsHubData'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { normalizePublicHub } from '../../lib/publicHub'
import '../../ui/tokens.css'
import '../../ui/components/analytics/analytics-hub-home.css'
import '../../ui/components/analytics/analytics-dashboard.css'
import { CorpusPipelineCard } from '../../ui/components/analytics/CorpusPipelineCard'
import { CorpusSummaryCards } from '../../ui/components/analytics/CorpusSummaryCards'
import { EmoteEconomyCard } from '../../ui/components/analytics/EmoteEconomyCard'
import { EmoteIntelKpis } from '../../ui/components/analytics/EmoteIntelKpis'
import { GlobalActivityChart } from '../../ui/components/analytics/GlobalActivityChart'
import { HubChannelSearch } from '../../ui/components/analytics/HubChannelSearch'
import { HubLiveCarousel } from '../../ui/components/analytics/HubLiveCarousel'
import { HubSessionsTable } from '../../ui/components/analytics/HubSessionsTable'
import { LiveMatrixTable } from '../../ui/components/analytics/LiveMatrixTable'
import { MomentsFeed } from '../../ui/components/analytics/MomentsFeed'
import { TopEmotesGrid } from '../../ui/components/analytics/TopEmotesGrid'

export default function DashboardHome() {
  const analytics = useAnalyticsHubData()
  const hub = usePublicHubData({ enabled: true })
  const data = normalizePublicHub(hub.data)
  const liveChannels = data.liveChannels
  const suggestions = useMemo(
    () =>
      liveChannels.slice(0, 8).map((channel) => ({
        login: channel.login,
        displayName: channel.displayName,
        category: channel.category,
        viewers: channel.viewers,
        profileImageUrl: channel.profileImageUrl,
        live: true,
      })),
    [liveChannels],
  )
  const topEmoteName = data.topEmotes[0]?.name
  const peakLogin = data.topMovers[0]?.login
  const updatedLabel = hub.lastUpdated ? `Updated ${new Date(hub.lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined

  return (
    <main className="sp-hub" id="analytics-main" aria-label="StreamPulse analytics hub">
      <header className="hub-brand">
        <span className="hub-brand__logo" aria-hidden="true">SP</span>
        <p className="hub-brand__nm">Stream<b>Pulse</b></p>
        <span className="hub-brand__tag">Analytics Hub</span>
      </header>

      <section className="hub-hero" aria-labelledby="analytics-hub-title">
        <p className="hub-recent__lbl">Search-first gateway</p>
        <h1 id="analytics-hub-title" className="sr-only">StreamPulse analytics</h1>
        <p className="hub-sec-head__desc">
          Search any Twitch login to open the full Streamclone analytics console. Live rails and corpus cards are shortcuts, not the destination.
        </p>
      </section>
      <HubChannelSearch variant="hub" suggestions={[]} />
      {suggestions.length > 0 ? (
        <div className="hub-recent" aria-label="Suggested live channels">
          <span className="hub-recent__lbl">Live shortcuts</span>
          <div className="hub-chiprow">
            {suggestions.map((channel) => (
              <Link key={channel.login} to={`/analytics/${encodeURIComponent(channel.login.toLowerCase())}`} className="hub-chip is-live">
                <span className="hub-chip__av" aria-hidden="true" />
                {channel.displayName ?? channel.login}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {hub.error ? <p className="hub-searcherr" role="status">Live hub data is degraded: {hub.error}</p> : null}

      <section className="hub-sec" aria-labelledby="hub-live-title">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h2 id="hub-live-title">Live now</h2>
            <span className="hub-sec-head__desc">Links open the full analytics console.</span>
          </div>
          {updatedLabel ? <span className="hub-sec-head__desc">{updatedLabel}</span> : null}
        </div>
        <HubLiveCarousel channels={liveChannels} loading={hub.loading} />
      </section>

      <section className="hub-sec" aria-labelledby="hub-corpus-title">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h2 id="hub-corpus-title">Corpus snapshot</h2>
            <span className="hub-sec-head__desc">Public aggregate counts from the backend.</span>
          </div>
        </div>
        <CorpusSummaryCards corpus={data.corpus} loading={hub.loading && !hub.data} />
      </section>

      <section className="hub-sec" aria-labelledby="hub-activity-title">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h2 id="hub-activity-title">Global activity</h2>
            <span className="hub-sec-head__desc">Viewers, chat, and emotes across tracked live rooms.</span>
          </div>
        </div>
        <GlobalActivityChart
          points={data.activity.points}
          windowMinutes={data.activity.windowMinutes}
          channelCount={data.activity.channelCount}
          loading={hub.loading && !hub.data}
        />
      </section>

      <section className="hub-sec" aria-labelledby="hub-emote-title">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h2 id="hub-emote-title">Emote signal</h2>
            <span className="hub-sec-head__desc">Provider mix and the top aggregate emotes.</span>
          </div>
        </div>
        <EmoteIntelKpis intel={data.emoteIntel} topEmoteName={topEmoteName} peakLogin={peakLogin} loading={hub.loading && !hub.data} />
        <div style={{ height: '0.8rem' }} />
        <TopEmotesGrid emotes={data.topEmotes} loading={hub.loading && !hub.data} />
      </section>

      <section className="hub-sec dash-grid2" aria-label="Live matrix and emote economy">
        <LiveMatrixTable channels={liveChannels} loading={hub.loading && !hub.data} updatedLabel="Live tracked channels" />
        <EmoteEconomyCard intel={data.emoteIntel} topEmotes={data.topEmotes} loading={hub.loading && !hub.data} />
      </section>

      <section className="hub-sec" aria-labelledby="hub-sessions-title">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h2 id="hub-sessions-title">Recent sessions</h2>
            <span className="hub-sec-head__desc">Personal shortcuts when history is available.</span>
          </div>
        </div>
        <HubSessionsTable rows={analytics.recentSessions} loading={analytics.loading} historyUnavailable={analytics.historyUnavailable} />
      </section>

      <section className="hub-sec dash-grid2" aria-label="Pipeline and moments">
        <CorpusPipelineCard pipeline={data.corpusPipeline} loading={hub.loading && !hub.data} />
        <MomentsFeed moments={data.moments} loading={hub.loading && !hub.data} />
      </section>

      <footer className="hub-footer">
        Public aggregate hub<span className="dot" />Search opens Streamclone analytics parity<span className="dot" />No client-side scoring
      </footer>
    </main>
  )
}