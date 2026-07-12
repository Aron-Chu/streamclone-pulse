import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHubRecentLogins } from "../../hooks/useHubRecentLogins";
import { usePublicHubData } from "../../hooks/usePublicHubData";
import { usePoolWireEvents } from "../../hooks/usePoolWireEvents";
import { getBackendUrl } from "../../lib/apiClient";
import {
  resolveBackendSource,
  backendSourceLabel,
} from "../../lib/backendSource";
import { HubBackendSourceBanner } from "../../ui/components/analytics/HubBackendSourceBanner";
import { HubDataHealthBanner } from "../../ui/components/hub/HubDataHealthBanner";
import { resolveLivePulseMoments, mapHubPulseMoment, momentRowKey } from "../../lib/figmaSessionAnalytics";
import { summarizeActivity, activityBucketKey } from "../../lib/hubActivitySummary";
import {
  aggregateEmotesFromMoments,
  rankLiveChannelsByActivity,
} from "../../ui/components/analytics/activityBucketInspectorUtils";
import type { FigmaMomentRow } from "../../lib/figmaSessionAnalytics";
import { filterMomentsByBucket } from "../../lib/pulseMomentsUtils";
import { hasBucketMomentsCache, readBucketMomentsCache } from "../../lib/bucketMomentsCache";
import { requestHubBucketMoments } from "../../lib/prefetchHubBucketMoments";
import {
  HUB_TOP_MOVERS_CAP,
  normalizePublicHub,
  resolveHubTopMovers,
  type PublicHubActivityWindow,
} from "../../lib/publicHub";
import { resolveHubUiState } from "../../lib/hubUiState";
import { isLifecycleMomentKind } from "../../lib/poolWireReducer";
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
import { isLiveWireEventFresh } from "../../ui/components/analytics/HubLiveWireFeed";
import { FigmaLiveChannelRail } from "../../ui/components/analytics/FigmaLiveChannelRail";
import { PulseMomentsLivePanel } from "../../ui/components/analytics/PulseMomentsLivePanel";
import { TopClipsShelf } from "../../ui/components/analytics/TopClipsShelf";
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
  const [selectedMomentKey, setSelectedMomentKey] = useState<string | null>(null);
  const [bucketMoments, setBucketMoments] = useState<FigmaMomentRow[]>([]);
  const [bucketMomentsLoading, setBucketMomentsLoading] = useState(false);
  const [hoverBucketMoments, setHoverBucketMoments] = useState<FigmaMomentRow[]>([]);
  const [hoverBucketMomentsLoading, setHoverBucketMomentsLoading] = useState(false);
  const [poolMoments, setPoolMoments] = useState<FigmaMomentRow[]>([]);
  const hub = usePublicHubData({ enabled: true, activityWindow });
  const recentLogins = useHubRecentLogins();
  const data = useMemo(() => normalizePublicHub(hub.data), [hub.data]);
  const loadingInitial = hub.loading && !hub.data;
  const hubUiState = resolveHubUiState({
    loading: hub.loading,
    data: hub.data,
    error: hub.error,
    hubEndpointOk: hub.hubEndpointOk,
    loadSource: hub.loadSource,
  });
  const updatedAgo = formatUpdatedAgo(hub.lastUpdated);
  const chartLoading = loadingInitial || hub.activityRefreshing;

  const poolWire = usePoolWireEvents({
    hub: hub.data ? data : null,
    pollSequence: hub.pollSequence,
    lastSuccessfulPollAt: hub.lastSuccessfulPollAt,
    hubEndpointOk: hub.hubEndpointOk,
    healthy: hubUiState === "ready" || hubUiState === "empty",
  });

  const [pulseLiveChannels, setPulseLiveChannels] = useState(false);
  const seenWentLiveRef = useRef<Set<string>>(new Set());
  const poolWireSeededRef = useRef(false);
  useEffect(() => {
    const wentLive = poolWire.events.filter((e) => e.kind === "went_live");
    if (!poolWire.initialized) return;
    if (!poolWireSeededRef.current) {
      poolWireSeededRef.current = true;
      for (const event of wentLive) seenWentLiveRef.current.add(event.id);
      return;
    }
    let newest = false;
    for (const event of wentLive) {
      if (!seenWentLiveRef.current.has(event.id)) {
        seenWentLiveRef.current.add(event.id);
        newest = true;
      }
    }
    if (!newest) return;
    setPulseLiveChannels(true);
    const t = window.setTimeout(() => setPulseLiveChannels(false), 700);
    return () => window.clearTimeout(t);
  }, [poolWire.events, poolWire.initialized]);

  const livePulseFeed = useMemo(() => resolveLivePulseMoments(data), [data]);
  /** Live Wire is peaks/momentum only — lifecycle belongs in Pool Wire. */
  const liveWireFeed = useMemo(
    () => ({
      ...livePulseFeed,
      moments: livePulseFeed.moments.filter((m) => !isLifecycleMomentKind(m.kind)),
    }),
    [livePulseFeed],
  );
  const chartBucketSelectEnabled = livePulseFeed.source === "network";

  const optimisticBucketMoments = useCallback(
    (bucketT: number) =>
      filterMomentsByBucket(
        poolMoments,
        bucketT,
        data.activity.windowMinutes,
        data.liveChannels,
      ),
    [data.activity.windowMinutes, data.liveChannels, poolMoments],
  );

  const activeBucketMoments = useMemo(() => {
    if (!chartBucketSelectEnabled) return [];
    if (selectedBucketT != null) {
      if (bucketMoments.length > 0) return bucketMoments;
      const cached = readBucketMomentsCache(selectedBucketT, activityWindow) ?? [];
      if (cached.length > 0) return cached;
      return optimisticBucketMoments(selectedBucketT);
    }
    if (hoverBucketT != null) {
      if (hoverBucketMoments.length > 0) return hoverBucketMoments;
      const cached = readBucketMomentsCache(hoverBucketT, activityWindow) ?? [];
      if (cached.length > 0) return cached;
      return optimisticBucketMoments(hoverBucketT);
    }
    return [];
  }, [
    activityWindow,
    bucketMoments,
    chartBucketSelectEnabled,
    hoverBucketMoments,
    hoverBucketT,
    optimisticBucketMoments,
    selectedBucketT,
  ]);

  const bucketMomentEmotes = useMemo(() => {
    if (!chartBucketSelectEnabled || activeBucketMoments.length === 0) return [];
    return aggregateEmotesFromMoments(activeBucketMoments);
  }, [activeBucketMoments, chartBucketSelectEnabled]);

  const inspectorBucketMomentsLoading =
    selectedBucketT != null
      ? bucketMomentsLoading
      : hoverBucketT != null
        ? hoverBucketMomentsLoading
        : false;

  useEffect(() => {
    if (hoverBucketT == null || selectedBucketT != null) {
      setHoverBucketMoments([]);
      setHoverBucketMomentsLoading(false);
      return;
    }

    if (hasBucketMomentsCache(hoverBucketT, activityWindow)) {
      const rows = readBucketMomentsCache(hoverBucketT, activityWindow) ?? [];
      setHoverBucketMoments(rows);
      setHoverBucketMomentsLoading(false);
      return;
    }

    const optimistic = optimisticBucketMoments(hoverBucketT);
    if (optimistic.length > 0) {
      setHoverBucketMoments(optimistic);
      setHoverBucketMomentsLoading(false);
      return;
    }

    setHoverBucketMoments([]);
    setHoverBucketMomentsLoading(true);

    const controller = new AbortController();
    requestHubBucketMoments({
      bucketT: hoverBucketT,
      activityWindow,
      activityWindowMinutes: data.activity.windowMinutes,
      signal: controller.signal,
      includeAdjacent: true,
    })
      .then(() => {
        const rows = readBucketMomentsCache(hoverBucketT, activityWindow) ?? [];
        setHoverBucketMoments(rows);
        setHoverBucketMomentsLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHoverBucketMomentsLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activityWindow,
    data.activity.windowMinutes,
    hoverBucketT,
    optimisticBucketMoments,
    selectedBucketT,
  ]);

  const handleClearBucketFilter = useCallback(() => {
    setSelectedBucketT(null);
    setHoverBucketT(null);
    setSelectedMomentKey(null);
  }, []);

  const handleBucketSelect = useCallback((bucketT: number | null) => {
    setSelectedBucketT(bucketT);
    setHoverBucketT(null);
    setSelectedMomentKey(null);
    if (bucketT == null) {
      setBucketMoments([]);
      setBucketMomentsLoading(false);
      return;
    }
    const cached = readBucketMomentsCache(bucketT, activityWindow) ?? [];
    const optimistic = filterMomentsByBucket(
      poolMoments,
      bucketT,
      data.activity.windowMinutes,
      data.liveChannels,
    );
    const interim = cached.length > 0 ? cached : optimistic;
    setBucketMoments(interim);
    setBucketMomentsLoading(interim.length === 0);
  }, [
    activityWindow,
    data.activity.windowMinutes,
    data.liveChannels,
    poolMoments,
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
  const isHostedBackend = backendSource === "hosted";
  const hubUnavailable = hubUiState === "error";
  const showTrackedTable = data.liveChannels.length > 0;
  const featuredChannels = rankLiveChannelsByActivity(data.liveChannels, 12);
  const sidebarSections = useMemo<HubSidebarSection[]>(
    () => [
      { id: "section-overview", label: labels.overview },
      { id: "section-live-rail", label: labels.liveRail, hidden: featuredChannels.length === 0 },
      { id: "section-live-wire", label: "Live Wire" },
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

  const liveWireFeedProps = {
    hub: data,
    feed: liveWireFeed,
    activityWindow,
    loading: loadingInitial || hubUiState === "loading",
    hubEndpointOk: hub.hubEndpointOk,
    // Do not default to "full" — that made pending hubEndpointOk=false look like a confirmed outage.
    loadSource: hub.loadSource ?? undefined,
  };

  const momentLookupPool = useMemo(() => {
    const byKey = new Map<string, FigmaMomentRow>();
    for (const moment of [...poolMoments, ...bucketMoments, ...liveWireFeed.moments]) {
      byKey.set(momentRowKey(moment), moment);
    }
    return byKey;
  }, [bucketMoments, liveWireFeed.moments, poolMoments]);

  const selectedMoment = useMemo(() => {
    if (!selectedMomentKey) return null;
    return momentLookupPool.get(selectedMomentKey) ?? null;
  }, [momentLookupPool, selectedMomentKey]);

  const accentBucketT = useMemo(() => {
    if (!selectedMoment?.at) return null;
    return activityBucketKey(selectedMoment.at, data.activity.windowMinutes);
  }, [data.activity.windowMinutes, selectedMoment]);

  const handleSelectMoment = useCallback((moment: FigmaMomentRow) => {
    const key = momentRowKey(moment);
    setSelectedMomentKey(key);
    if (moment.at != null && Number.isFinite(moment.at)) {
      setSelectedBucketT(null);
      setHoverBucketT(null);
    }
  }, []);

  const momentMarkers = useMemo(() => {
    const now = Date.now();
    const markers: { key: string; bucketT: number; kind?: string }[] = [];
    for (const moment of liveWireFeed.moments) {
      if (!isLiveWireEventFresh(moment.at, now)) continue;
      if (moment.at == null || !Number.isFinite(moment.at)) continue;
      const key = momentRowKey(moment);
      markers.push({
        key,
        bucketT: activityBucketKey(moment.at, data.activity.windowMinutes),
        kind: moment.kind,
      });
      if (markers.length >= 12) break;
    }
    return markers;
  }, [data.activity.windowMinutes, liveWireFeed.moments]);

  return (
    <AnalyticsFigmaShell
      backendStatus={
        isHostedBackend
          ? {
              label: "Status",
              value: hubUnavailable ? "Unavailable" : "Live",
              tone: hubUnavailable ? "offline" : "ready",
            }
          : {
              label: "API",
              value: backendSourceLabel(backendSource),
              tone: hubUnavailable ? "offline" : "ready",
            }
      }
      sidebarStatusLabel={
        isHostedBackend
          ? hubUnavailable
            ? "Unavailable"
            : "Live"
          : backendSourceLabel(backendSource)
      }
      sidebarSections={sidebarSections}
    >
      <main
        className="figma-analytics__main"
        id="analytics-main"
        aria-label="StreamPulse analytics"
        data-hub-state={hubUiState}
      >
        {hub.loadSource === "cache" && hub.refreshing ? (
          <div
            className="figma-hub-fallback-banner figma-hub-fallback-banner--info"
            role="status"
          >
            Cached snapshot - refreshing...
          </div>
        ) : null}
        <HubDataHealthBanner
          loadSource={hub.loadSource}
          hubEndpointOk={hub.hubEndpointOk}
          activitySummary={activitySummary}
          pipeline={data.corpusPipeline}
          liveRosterCount={data.coverage.liveChannels}
          error={hub.error}
          backendUrl={getBackendUrl()}
          loading={loadingInitial || hubUiState === "loading"}
        />
        <HubBackendSourceBanner />

        <SectionReveal id="section-overview">
          <HubCommandHeader
            hub={data}
            loading={loadingInitial || hubUiState === "loading"}
            lastSuccessfulPollAt={hub.lastSuccessfulPollAt}
            hubEndpointOk={hub.hubEndpointOk}
            error={hub.error}
            poolWireEvents={poolWire.events}
            poolWireInitialized={poolWire.initialized}
            pulseLiveChannels={pulseLiveChannels}
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
                Showing top {featuredChannels.length} by activity of{" "}
                {compact(data.liveChannels.length)} in pool
              </span>
            </div>
            <FigmaLiveChannelRail
              channels={featuredChannels}
              colors={RAIL_COLORS}
              loading={loadingInitial}
            />
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
                chartBucketSelectEnabled ? handleBucketSelect : undefined
              }
              onBucketHover={
                chartBucketSelectEnabled ? setHoverBucketT : undefined
              }
              rangeControl={{
                active: activityWindow,
                options: ACTIVITY_WINDOW_OPTIONS,
                onSelect: (key) => {
                  setActivityWindow(key as PublicHubActivityWindow);
                  setSelectedBucketT(null);
                  setHoverBucketT(null);
                  setSelectedMomentKey(null);
                },
              }}
              showSearch={false}
              activityWindowKey={activityWindow}
              bucketMomentEmotes={bucketMomentEmotes}
              bucketMoments={activeBucketMoments}
              bucketMomentsLoading={inspectorBucketMomentsLoading}
              liveChannels={data.liveChannels}
              linkedMoment={
                selectedMoment?.login
                  ? {
                      login: selectedMoment.login,
                      displayName: selectedMoment.displayName,
                      label: selectedMoment.label,
                    }
                  : null
              }
              onClearLinkedMoment={() => setSelectedMomentKey(null)}
              accentBucketT={accentBucketT}
              momentMarkers={momentMarkers}
              selectedMomentKey={selectedMomentKey}
              onSelectMoment={handleSelectMoment}
              onSelectMomentKey={(key) => {
                const moment = momentLookupPool.get(key);
                if (moment) handleSelectMoment(moment);
              }}
              annotationFeed={liveWireFeed}
              annotationLoading={liveWireFeedProps.loading}
              annotationHubEndpointOk={hub.hubEndpointOk}
              annotationLoadSource={hub.loadSource ?? undefined}
              annotationActivityWindow={activityWindow}
            />
            <PulseMomentsLivePanel
              hub={data}
              feed={livePulseFeed}
              topEmotes={data.topEmotes}
              loading={loadingInitial}
              layout="embedded"
              selectedBucketT={chartBucketSelectEnabled ? selectedBucketT : null}
              hoverBucketT={chartBucketSelectEnabled ? hoverBucketT : null}
              onClearBucketFilter={
                chartBucketSelectEnabled ? handleClearBucketFilter : undefined
              }
              onBucketMomentsChange={chartBucketSelectEnabled ? setBucketMoments : undefined}
              onBucketLoadingChange={
                chartBucketSelectEnabled ? setBucketMomentsLoading : undefined
              }
              onPoolMomentsChange={chartBucketSelectEnabled ? setPoolMoments : undefined}
              activityWindow={activityWindow}
              activityWindowMinutes={data.activity.windowMinutes}
              updatedAgo={updatedAgo}
              selectedMomentKey={selectedMomentKey}
              onSelectMoment={handleSelectMoment}
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
            emoteMarket={data.emoteMarket}
          />
        </SectionReveal>

        {(data.publicClips?.length ?? 0) > 0 ? (
          <SectionReveal id="section-top-clips">
            <TopClipsShelf clips={data.publicClips ?? []} loading={loadingInitial} />
          </SectionReveal>
        ) : null}

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
            ingest={data.ingest}
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
