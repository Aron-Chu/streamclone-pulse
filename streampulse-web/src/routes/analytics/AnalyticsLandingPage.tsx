import { useMemo, useState } from "react";
import { useHubRecentLogins } from "../../hooks/useHubRecentLogins";
import { usePublicHubData } from "../../hooks/usePublicHubData";
import { getBackendUrl } from "../../lib/apiClient";
import {
  resolveBackendSource,
  backendSourceLabel,
} from "../../lib/backendSource";
import { HubBackendSourceBanner } from "../../ui/components/analytics/HubBackendSourceBanner";
import { resolveLivePulseMoments } from "../../lib/figmaSessionAnalytics";
import { summarizeActivity } from "../../lib/hubActivitySummary";
import { aggregateEmotesFromMoments } from "../../ui/components/analytics/activityBucketInspectorUtils";
import type { FigmaMomentRow } from "../../lib/figmaSessionAnalytics";
import { filterMomentsByBucket } from "../../lib/pulseMomentsUtils";
import {
  HUB_TOP_MOVERS_CAP,
  normalizePublicHub,
  resolveHubTopMovers,
  type PublicHubActivityWindow,
} from "../../lib/publicHub";
import type { HubActivityRangeOption } from "../../ui/components/hub/HubActivityChart";
import { AnalyticsFigmaShell } from "../../ui/components/analytics/AnalyticsFigmaShell";
import { FigmaEmoteSignalBlock } from "../../ui/components/analytics/FigmaEmoteSignalBlock";
import {
  ChartSourceBanner,
  FigmaGlobalActivityPanel,
} from "../../ui/components/analytics/FigmaGlobalActivityPanel";
import { HubCommandHeader } from "../../ui/components/analytics/HubCommandHeader";
import { HubCoverageTrustStrip } from "../../ui/components/analytics/HubCoverageTrustStrip";
import { LiveChannelsMatrix } from "../../ui/components/analytics/LiveChannelsMatrix";
import { HubLiveRailMoversStrip } from "../../ui/components/analytics/HubLiveRailMoversStrip";
import { FigmaLiveChannelRail } from "../../ui/components/analytics/FigmaLiveChannelRail";
import { PulseMomentsLivePanel } from "../../ui/components/analytics/PulseMomentsLivePanel";
import { HubSearch, type HubSuggestion } from "../../ui/components/hub/HubSearch";
import type { HubSidebarSection } from "../../ui/components/analytics/AnalyticsHubSidebar";
import { compact } from "../../ui/components/analytics/hubFormat";
import { useCommandCenterLabels } from "../../ui/providers/AnalyticsThemeProvider";
import { SectionReveal } from "../../ui/motion/useAnalyticsMotion";
import "../../ui/components/analytics/figma-analytics.css";

const FALLBACK_SUGGESTIONS: HubSuggestion[] = [
  { login: "xqc", displayName: "xQc", category: "Just Chatting" },
  { login: "caseoh_", displayName: "caseoh_", category: "Just Chatting" },
  { login: "sodapoppin", displayName: "sodapoppin", category: "Variety" },
  { login: "jynxzi", displayName: "Jynxzi", category: "Rainbow Six Siege" },
];

const ACTIVITY_WINDOW_OPTIONS: HubActivityRangeOption[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "1m", label: "1mo" },
  { key: "3m", label: "3mo" },
  { key: "6m", label: "6mo" },
  { key: "1y", label: "1 year" },
];

const RAIL_COLORS = ["#1e3a5f", "#1a3d2b", "#2d1b4e", "#3d2a1b", "#1b3d3d"];

function formatUpdatedAgo(ts: number | null): string | undefined {
  if (!ts) return undefined;
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

/** Public `/analytics` command-center landing. */
function AnalyticsLandingContent() {
  const labels = useCommandCenterLabels();
  const [activityWindow, setActivityWindow] =
    useState<PublicHubActivityWindow>("24h");
  const [selectedBucketT, setSelectedBucketT] = useState<number | null>(null);
  const [hoverBucketT, setHoverBucketT] = useState<number | null>(null);
  const [bucketMoments, setBucketMoments] = useState<FigmaMomentRow[]>([]);
  const [poolMoments, setPoolMoments] = useState<FigmaMomentRow[]>([]);
  const hub = usePublicHubData({ enabled: true, activityWindow });
  const recentLogins = useHubRecentLogins();
  const data = useMemo(() => normalizePublicHub(hub.data), [hub.data]);
  const loadingInitial = hub.loading && !hub.data;
  const updatedAgo = formatUpdatedAgo(hub.lastUpdated);
  const chartLoading = loadingInitial || hub.activityRefreshing;

  const livePulseFeed = useMemo(() => resolveLivePulseMoments(data), [data]);
  const chartBucketSelectEnabled = livePulseFeed.source === "network";

  const bucketMomentEmotes = useMemo(() => {
    if (!chartBucketSelectEnabled) return [];
    if (selectedBucketT != null) {
      return aggregateEmotesFromMoments(bucketMoments);
    }
    if (hoverBucketT != null) {
      const hovered = filterMomentsByBucket(
        poolMoments,
        hoverBucketT,
        data.activity.windowMinutes,
        data.liveChannels,
      );
      return aggregateEmotesFromMoments(hovered);
    }
    return [];
  }, [
    bucketMoments,
    chartBucketSelectEnabled,
    data.activity.windowMinutes,
    data.liveChannels,
    hoverBucketT,
    poolMoments,
    selectedBucketT,
  ]);

  const activitySummary = useMemo(
    () =>
      summarizeActivity(
        data.activity.points,
        data.activity.windowMinutes,
        data.poolSize,
      ),
    [
      data.poolSize,
      data.activity.points,
      data.activity.windowMinutes,
    ],
  );

  const suggestions = useMemo<HubSuggestion[]>(() => {
    const seen = new Set<string>();
    const rows: HubSuggestion[] = [];
    const add = (item: HubSuggestion) => {
      const login = item.login.trim().toLowerCase();
      if (!login || seen.has(login)) return;
      seen.add(login);
      rows.push({ ...item, login });
    };
    data.liveChannels.forEach((channel) =>
      add({
        login: channel.login,
        displayName: channel.displayName,
        category: channel.category,
        viewers: channel.viewers,
        profileImageUrl: channel.profileImageUrl,
        live: true,
      }),
    );
    data.topMovers.slice(0, HUB_TOP_MOVERS_CAP).forEach((mover) =>
      add({
        login: mover.login,
        displayName: mover.displayName,
        category: mover.category,
        viewers: mover.viewers,
        profileImageUrl: mover.profileImageUrl,
        live: data.liveChannels.some(
          (ch) => ch.login.toLowerCase() === mover.login.toLowerCase(),
        ),
      }),
    );
    recentLogins.forEach(({ login }) =>
      add({
        login,
        live: data.liveChannels.some(
          (ch) => ch.login.toLowerCase() === login.toLowerCase(),
        ),
      }),
    );
    FALLBACK_SUGGESTIONS.forEach((item) =>
      add({
        ...item,
        live: data.liveChannels.some(
          (ch) => ch.login.toLowerCase() === item.login.toLowerCase(),
        ),
      }),
    );
    return rows;
  }, [data.liveChannels, data.topMovers, recentLogins]);

  const backendSource = resolveBackendSource(getBackendUrl());
  const localHubUnavailable =
    backendSource === "local" && !hub.hubEndpointOk && Boolean(hub.error);
  const showTrackedTable = data.liveChannels.length > 0;
  const featuredChannels = data.liveChannels.slice(0, 12);
  const sidebarSections = useMemo<HubSidebarSection[]>(
    () => [
      { id: "section-overview", label: labels.overview },
      { id: "section-live-rail", label: labels.liveRail, hidden: featuredChannels.length === 0 },
      { id: "section-network", label: labels.liveActivity },
      { id: "section-pulse-moments", label: labels.pulseMoments },
      { id: "section-emote-signal", label: labels.emoteSignal },
      { id: "section-tracked", label: labels.trackedChannels, hidden: !showTrackedTable },
      { id: "section-coverage", label: labels.coverage },
    ],
    [featuredChannels.length, labels, showTrackedTable],
  );

  const topMovers = useMemo(
    () => resolveHubTopMovers(data.topMovers, data.liveChannels),
    [data.topMovers, data.liveChannels],
  );

  return (
    <AnalyticsFigmaShell
      backendStatus={{
        label: "API",
        value: backendSourceLabel(backendSource),
        tone:
          hub.error && !hub.data
            ? "offline"
            : backendSource === "local" && !hub.hubEndpointOk
              ? "degraded"
              : backendSource === "local"
                ? "degraded"
                : "ready",
      }}
      sidebarStatusLabel={backendSourceLabel(backendSource)}
      sidebarSections={sidebarSections}
    >
      <main
        className="figma-analytics__main"
        id="analytics-main"
        aria-label="StreamPulse analytics"
      >
        {localHubUnavailable ? (
          <div className="figma-hub-fallback-banner" role="status">
            Local API selected - <code>/v1/public/hub</code> unavailable -
            rebuild analytics and restart <code>local-proxy</code>, or switch to
            hosted API.
          </div>
        ) : null}
        {hub.loadSource === "cache" && hub.refreshing ? (
          <div
            className="figma-hub-fallback-banner figma-hub-fallback-banner--info"
            role="status"
          >
            Cached snapshot - refreshing...
          </div>
        ) : null}
        {(data.coverage.state === "critical" || data.corpusPipeline.state === "critical") ? (
          <div
            className="figma-hub-fallback-banner figma-hub-fallback-banner--warn"
            role="status"
          >
            Partial live IRC coverage — collector admission is limited. Charts and moments
            reflect tracked channels only; backfill may still fill historical gaps.
          </div>
        ) : null}
        <HubBackendSourceBanner />

        <SectionReveal id="section-overview">
          <HubCommandHeader
            hub={data}
            activitySummary={activitySummary}
            loading={loadingInitial}
          />
          <div className="hub-command-search" role="search" aria-label="Channel search">
            <HubSearch
              suggestions={suggestions}
              placeholder={labels.searchPlaceholder}
              showKbd
              showOpenButton
              validateChannel={false}
              maxOptions={12}
            />
          </div>
        </SectionReveal>

        {featuredChannels.length > 0 ? (
          <SectionReveal
            as="section"
            id="section-live-rail"
            className="hub-live-rail-section"
          >
            <div className="hub-live-rail-section__head">
              <h2 className="hub-live-rail-section__title">{labels.liveRail}</h2>
              <span className="hub-live-rail-section__meta">
                Showing {featuredChannels.length} of {compact(data.liveChannels.length)} in pool
              </span>
            </div>
            <FigmaLiveChannelRail
              channels={featuredChannels}
              colors={RAIL_COLORS}
              loading={loadingInitial}
            />
            {topMovers.length > 0 ? (
              <HubLiveRailMoversStrip movers={topMovers.slice(0, 6)} loading={loadingInitial} />
            ) : null}
          </SectionReveal>
        ) : null}

        <SectionReveal id="section-network">
          <div className="figma-activity-hub">
            <FigmaGlobalActivityPanel
              hub={data}
              activitySummary={activitySummary}
              suggestions={suggestions}
              topEmotes={data.topEmotes}
              loading={chartLoading}
              activityRefreshing={hub.activityRefreshing}
              updatedAgo={updatedAgo}
              livePulseSource={livePulseFeed.source}
              chartBucketSelectEnabled={chartBucketSelectEnabled}
              selectedBucketT={chartBucketSelectEnabled ? selectedBucketT : null}
              onBucketSelect={
                chartBucketSelectEnabled
                  ? (bucketT) => {
                      setSelectedBucketT(bucketT);
                      setHoverBucketT(null);
                    }
                  : undefined
              }
              onBucketHover={chartBucketSelectEnabled ? setHoverBucketT : undefined}
              rangeControl={{
                active: activityWindow,
                options: ACTIVITY_WINDOW_OPTIONS,
                onSelect: (key) => {
                  setActivityWindow(key as PublicHubActivityWindow);
                  setSelectedBucketT(null);
                  setHoverBucketT(null);
                },
              }}
              showSearch={false}
              activityWindowKey={activityWindow}
              bucketMomentEmotes={bucketMomentEmotes}
            />
            <PulseMomentsLivePanel
              hub={data}
              feed={livePulseFeed}
              topEmotes={data.topEmotes}
              loading={loadingInitial}
              layout="embedded"
              selectedBucketT={chartBucketSelectEnabled ? selectedBucketT : null}
              onClearBucketFilter={
                chartBucketSelectEnabled ? () => setSelectedBucketT(null) : undefined
              }
              onBucketMomentsChange={chartBucketSelectEnabled ? setBucketMoments : undefined}
              onPoolMomentsChange={chartBucketSelectEnabled ? setPoolMoments : undefined}
              activityWindow={activityWindow}
              activityWindowMinutes={data.activity.windowMinutes}
              updatedAgo={updatedAgo}
            />
          </div>
        </SectionReveal>

        <SectionReveal id="section-emote-signal">
          <FigmaEmoteSignalBlock
            intel={data.emoteIntel}
            topEmotes={data.topEmotes}
            topMovers={topMovers}
            loading={loadingInitial}
            corpusPipeline={data.corpusPipeline}
            poolSize={data.poolSize}
            windowMinutes={data.activity.windowMinutes}
          />
        </SectionReveal>

        {showTrackedTable ? (
          <SectionReveal>
            <LiveChannelsMatrix
              channels={data.liveChannels}
              loading={loadingInitial}
              updatedAgo={updatedAgo}
              poolSize={data.poolSize}
              ircActive={data.corpusPipeline.collectorActive}
              rosterLive={data.corpusPipeline.roster?.live}
            />
          </SectionReveal>
        ) : null}

        <SectionReveal>
          <HubCoverageTrustStrip
            pipeline={data.corpusPipeline}
            loading={loadingInitial}
            updatedAgo={updatedAgo}
          />
        </SectionReveal>

        <ChartSourceBanner
          hub={data}
          activitySummary={activitySummary}
          className="figma-analytics__source-footer"
        />
      </main>
    </AnalyticsFigmaShell>
  );
}

export default function AnalyticsLandingPage() {
  return <AnalyticsLandingContent />;
}
