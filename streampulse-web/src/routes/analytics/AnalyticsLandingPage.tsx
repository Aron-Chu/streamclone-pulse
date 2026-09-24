import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { optionsForBoundedActivityFallback } from "../../lib/activityRangeCapabilities";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useHubRecentLogins } from "../../hooks/useHubRecentLogins";
import { usePublicHubData } from "../../hooks/usePublicHubData";
import { usePoolWireEvents } from "../../hooks/usePoolWireEvents";
import { useMomentProfiles } from "../../hooks/useMomentProfiles";
import { getBackendUrl } from "../../lib/apiClient";
import {
  resolveBackendSource,
  backendSourceLabel,
} from "../../lib/backendSource";
import { HubBackendSourceBanner } from "../../ui/components/analytics/HubBackendSourceBanner";
import { HubDataHealthBanner } from "../../ui/components/hub/HubDataHealthBanner";
import { resolveLivePulseMoments, mapHubPulseMoment, momentRowKey } from "../../lib/figmaSessionAnalytics";
import {
  summarizeActivity,
  activityBucketKey,
  formatActivityWindowLabel,
} from "../../lib/hubActivitySummary";
import {
  isHubActivityLivePoolFallback,
  resolveHubActivityChartWindowMinutes,
} from "../../lib/hubActivityHonesty";
import {
  deriveHubChartActivityModel,
  selectHubChartActivityInputs,
} from "../../lib/hubChartActivityModel";
import {
  aggregateEmotesFromMoments,
  rankLiveChannelsByActivity,
} from "../../ui/components/analytics/activityBucketInspectorUtils";
import type { FigmaMomentRow } from "../../lib/figmaSessionAnalytics";
import { filterMomentsByBucket } from "../../lib/pulseMomentsUtils";
import { hasBucketMomentsCache, readBucketMomentsCache } from "../../lib/bucketMomentsCache";

import {
  HUB_TOP_MOVERS_CAP,
  normalizePublicHub,
  resolveHubTopMovers,
  type PublicHubActivityWindow,
} from "../../lib/publicHub";
import { resolveHubStatus, resolveHubUiState } from "../../lib/hubUiState";
import { isLifecycleMomentKind } from "../../lib/poolWireReducer";
import type { HubActivityRangeOption } from "../../ui/components/hub/HubActivityChart";
import { AnalyticsFigmaShell } from "../../ui/components/analytics/AnalyticsFigmaShell";
import { FigmaEmoteSignalBlock } from "../../ui/components/analytics/FigmaEmoteSignalBlock";
import {
  ChartSourceBanner,
  FigmaGlobalActivityPanel,
} from "../../ui/components/analytics/FigmaGlobalActivityPanel";
import { HubLiveWireFeed } from "../../ui/components/analytics/HubLiveWireFeed";
import { FigmaLiveChannelRail } from "../../ui/components/analytics/FigmaLiveChannelRail";
import { HubCommandHeader } from "../../ui/components/analytics/HubCommandHeader";
import { HubCoverageTrustStrip } from "../../ui/components/analytics/HubCoverageTrustStrip";
import { LiveChannelsMatrix } from "../../ui/components/analytics/LiveChannelsMatrix";
import { PulseMomentsLivePanel } from "../../ui/components/analytics/PulseMomentsLivePanel";
import { TopClipsShelf } from "../../ui/components/analytics/TopClipsShelf";
import { HubSearch, type HubSuggestion } from "../../ui/components/hub/HubSearch";
import type { HubSidebarSection } from "../../ui/components/analytics/AnalyticsHubSidebar";
import { compact } from "../../ui/components/analytics/hubFormat";
import { useCommandCenterLabels } from "../../ui/providers/AnalyticsThemeProvider";
import { SectionReveal } from "../../ui/motion/useAnalyticsMotion";
import "../../ui/components/analytics/figma-analytics.css";
import "../../ui/components/newsroom/newsroom.css";
import "../../ui/components/analytics/discovery-layout.css";
import "../../ui/components/analytics/analytics-interaction.css";

const FALLBACK_SUGGESTIONS: HubSuggestion[] = [
  { login: "xqc", displayName: "xQc", category: "Just Chatting" },
  { login: "caseoh_", displayName: "caseoh_", category: "Just Chatting" },
  { login: "sodapoppin", displayName: "sodapoppin", category: "Variety" },
  { login: "jynxzi", displayName: "Jynxzi", category: "Rainbow Six Siege" },
];

const ACTIVITY_WINDOW_OPTIONS: HubActivityRangeOption[] = [
  { key: "30m", label: "30m" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "1m", label: "1mo" },
  { key: "3m", label: "3mo" },
  { key: "1y", label: "1 year" },
];

const ACTIVITY_WINDOW_MINUTES: Record<string, number> = {
  "30m": 30,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
  "1m": 30 * 24 * 60,
  "3m": 3 * 30 * 24 * 60,
  "1y": 365 * 24 * 60,
};

function compactWindowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return formatActivityWindowLabel(minutes);
}


function formatUpdatedAgo(ts: number | null, nowMs: number): string | undefined {
  if (!ts) return undefined;
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

/** Public `/analytics` command-center landing. */
function AnalyticsLandingContent() {
  const labels = useCommandCenterLabels();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hash } = useLocation();
  const rawWindow = searchParams.get("window") || searchParams.get("activityWindow");
  const activityWindow: PublicHubActivityWindow = (rawWindow && rawWindow in ACTIVITY_WINDOW_MINUTES)
    ? (rawWindow as PublicHubActivityWindow)
    : "24h";
  const [selectedBucketT, setSelectedBucketT] = useState<number | null>(null);
  const [hoverBucketT, setHoverBucketT] = useState<number | null>(null);
  const [selectedMomentKey, setSelectedMomentKey] = useState<string | null>(null);
  const [bucketMoments, setBucketMoments] = useState<FigmaMomentRow[]>([]);
  const [bucketMomentsLoading, setBucketMomentsLoading] = useState(false);
  const [hoverBucketMoments, setHoverBucketMoments] = useState<FigmaMomentRow[]>([]);
  const [hoverBucketMomentsLoading, setHoverBucketMomentsLoading] = useState(false);
  const [poolMoments, setPoolMoments] = useState<FigmaMomentRow[]>([]);
  const [wireSelectionActive, setWireSelectionActive] = useState(false);
  const [freshnessNowMs, setFreshnessNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setFreshnessNowMs(Date.now());
    }, 10_000);
    const updateOnReturn = () => {
      if (!document.hidden) setFreshnessNowMs(Date.now());
    };
    document.addEventListener("visibilitychange", updateOnReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateOnReturn);
    };
  }, []);
  const hub = usePublicHubData({ enabled: true, activityWindow });
  const recentLogins = useHubRecentLogins();
  const data = useMemo(() => normalizePublicHub(hub.data), [hub.data]);
  // Requested range drives the endpoint/range tab; served range owns all bucket
  // geometry so a bounded fallback cannot select or prefetch invented history.
  const servedActivityWindowMinutes = resolveHubActivityChartWindowMinutes(data.activity);
  // Live Wire and Newsroom may only claim an in-place chart selection when the
  // exact bucket survived the same bounding, alignment, and open-tip filtering
  // used by FigmaGlobalActivityPanel. Raw activity rows are not sufficient:
  // legacy payloads can contain rows that the truthful chart model omits.
  const selectableActivityBucketTs = useMemo(() => {
    const model = deriveHubChartActivityModel(selectHubChartActivityInputs(data));
    return new Set(model.chartPoints.map((point) => point.t));
  }, [data]);
  const activityRangeOptions = useMemo(
    () => {
      const fallback = isHubActivityLivePoolFallback(data.activity);
      const supportedOptions = fallback
        ? optionsForBoundedActivityFallback(ACTIVITY_WINDOW_OPTIONS, activityWindow, "30m")
        : ACTIVITY_WINDOW_OPTIONS;
      return supportedOptions.map((option) => {
        const requestedMinutes = ACTIVITY_WINDOW_MINUTES[option.key] ?? servedActivityWindowMinutes;
        // A healthy 24h response does not prove that a 7d projection is
        // unavailable. Only annotate longer options while the current payload
        // is explicitly the bounded live-pool fallback; the next selection
        // fetches and proves its own requested window.
        if (
          !isHubActivityLivePoolFallback(data.activity) ||
          servedActivityWindowMinutes >= requestedMinutes ||
          option.key === "30m"
        ) {
          return option;
        }
        const servedLabel = compactWindowLabel(servedActivityWindowMinutes);
        return {
          ...option,
          label: `${option.label} · ${servedLabel} available`,
          description: `${option.label} requested; only ${formatActivityWindowLabel(servedActivityWindowMinutes)} is currently available`,
        };
      });
    },
    [activityWindow, data.activity, servedActivityWindowMinutes],
  );
  const loadingInitial = hub.loading && !hub.data;
  const measurementAvailable = Boolean(hub.data && hub.loadSource !== 'stats-fallback');
  const measurementsUnavailable = !loadingInitial && !measurementAvailable;
  const hubUiState = resolveHubUiState({
    loading: hub.loading,
    data: hub.data,
    error: hub.error,
    hubEndpointOk: hub.hubEndpointOk,
    loadSource: hub.loadSource,
  });
  const updatedAgo = formatUpdatedAgo(hub.lastUpdated, freshnessNowMs);
  const chartLoading = loadingInitial || hub.activityRefreshing;

  const poolWire = usePoolWireEvents({
    hub: hub.data ? data : null,
    pollSequence: hub.pollSequence,
    lastSuccessfulPollAt: hub.lastSuccessfulPollAt,
    hubEndpointOk: hub.hubEndpointOk,
    // A cache hydrate is a truthful snapshot for the page, but it is not a
    // live observation. Keep lifecycle membership uninitialized until a full
    // network poll proves the current pool, otherwise cached openings/joins
    // can be presented as current transitions after recovery.
    healthy: (hubUiState === "ready" || hubUiState === "empty") && hub.loadSource === "full",
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

  const rawPulseFeed = useMemo(() => resolveLivePulseMoments(data), [data]);
  const profileMoments = useMomentProfiles(rawPulseFeed.moments);
  const livePulseFeed = useMemo(() => ({ ...rawPulseFeed, moments: profileMoments }), [rawPulseFeed, profileMoments]);
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
        servedActivityWindowMinutes,
        data.liveChannels,
      ),
    [data.liveChannels, poolMoments, servedActivityWindowMinutes],
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
    setHoverBucketMomentsLoading(false);
  }, [
    activityWindow,
    servedActivityWindowMinutes,
    hoverBucketT,
    optimisticBucketMoments,
    selectedBucketT,
  ]);

  const handleClearBucketFilter = useCallback(() => {
    setWireSelectionActive(false);
    setSelectedBucketT(null);
    setHoverBucketT(null);
    setSelectedMomentKey(null);
  }, []);

  const handleBucketSelect = useCallback((bucketT: number | null) => {
    setWireSelectionActive(false);
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
      servedActivityWindowMinutes,
      data.liveChannels,
    );
    const interim = cached.length > 0 ? cached : optimistic;
    setBucketMoments(interim);
    setBucketMomentsLoading(interim.length === 0);
  }, [
    activityWindow,
    data.liveChannels,
    poolMoments,
    servedActivityWindowMinutes,
  ]);

  const activitySummary = useMemo(
    () =>
      summarizeActivity(
        data.activity.points,
        servedActivityWindowMinutes,
        data.poolSize,
      ),
    [
      data.poolSize,
      data.activity.points,
      servedActivityWindowMinutes,
      data.activity.availableWindowMinutes,
      data.activity.state,
      data.activity.source,
      data.activity.reason,
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
  const measurementStatus = resolveHubStatus(hub);
  const showTrackedTable = data.liveChannels.length > 0;
  const featuredChannels = useMemo(
    () => rankLiveChannelsByActivity(data.liveChannels, 12),
    [data.liveChannels],
  );
  const sidebarSections = useMemo<HubSidebarSection[]>(
    () => [
      { id: "section-overview", label: labels.overview },
      { id: "section-live-rail", label: "Hottest Live" },
      { id: "section-pulse-moments", label: "Moments" },
      { id: "section-emote-signal", label: "Emotes" },
      { id: "section-tracked", label: "Channels", hidden: !showTrackedTable },
    ],
    [labels, showTrackedTable],
  );

  const topMovers = useMemo(
    () => resolveHubTopMovers(data.topMovers, data.liveChannels),
    [data.topMovers, data.liveChannels],
  );

  const liveWireFeedProps = {
    hub: data,
    feed: liveWireFeed,
    loading: loadingInitial || hubUiState === "loading",
    hubEndpointOk: hub.hubEndpointOk,
    // Do not default to "full" — that made pending hubEndpointOk=false look like a confirmed outage.
    loadSource: hub.loadSource ?? undefined,
    pollSequence: hub.pollSequence,
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
    const bucketT = activityBucketKey(selectedMoment.at, servedActivityWindowMinutes);
    return selectableActivityBucketTs.has(bucketT) ? bucketT : null;
  }, [selectedMoment, servedActivityWindowMinutes, selectableActivityBucketTs]);

  const handleSelectMoment = useCallback((moment: FigmaMomentRow) => {
    setWireSelectionActive(false);
    const key = momentRowKey(moment);
    setSelectedMomentKey(key);
    // Selecting a row must not replace its collection with a bucket fetch.
    // The chart accents the selected moment independently via accentBucketT.
    setHoverBucketT(null);
  }, []);

  const handleSelectLiveWireMoment = useCallback((moment: FigmaMomentRow) => {
    handleSelectMoment(moment);
    setWireSelectionActive(true);
    setBucketMoments([moment]);
    setBucketMomentsLoading(false);
  }, [handleSelectMoment]);

  useEffect(() => {
    if (selectedBucketT == null && selectedMomentKey == null) return;
    const dismiss = () => {
      setSelectedBucketT(null);
      setSelectedMomentKey(null);
      setHoverBucketT(null);
      setWireSelectionActive(false);
    };
    const clickAway = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Finish the click before collapsing. Selection controls and inspector
      // actions keep their target in place through pointer-up.
      if (target.closest('.figma-global-activity__chart-col, .figma-global-activity__inspector, .pulse-moments-live, .hub-live-wire')) return;
      dismiss();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('click', clickAway);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', clickAway);
      document.removeEventListener('keydown', escape);
    };
  }, [selectedBucketT, selectedMomentKey]);

  // Exact stream-minute identity, not a public ID, is what the chart needs: the
  // hub payload does not always supply `publicMomentId`, and requiring one left
  // every real row unselectable. `momentRowKey` is login:streamId:offsetSeconds,
  // so this stays fail-closed — a row still has to match a loaded moment and
  // resolve to a bucket the truthful chart model actually rendered.
  const canSelectLiveWireMoment = useCallback((moment: FigmaMomentRow) => {
    if (!chartBucketSelectEnabled || !moment.login?.trim() || !moment.streamId || moment.at == null || !Number.isFinite(moment.at)) {
      return false;
    }
    const loadedMoment = momentLookupPool.get(momentRowKey(moment));
    if (!loadedMoment || loadedMoment.streamId !== moment.streamId) return false;
    // When both sides name a public moment they must agree; a mismatch is a
    // different detection wearing the same minute.
    if (moment.publicMomentId && loadedMoment.publicMomentId && loadedMoment.publicMomentId !== moment.publicMomentId) return false;
    const bucketT = activityBucketKey(moment.at, servedActivityWindowMinutes);
    return selectableActivityBucketTs.has(bucketT);
  }, [
    chartBucketSelectEnabled,
    momentLookupPool,
    selectableActivityBucketTs,
    servedActivityWindowMinutes,
  ]);

  return (
    <AnalyticsFigmaShell
      backendStatus={
        isHostedBackend
          ? {
              label: "Status",
              value: measurementStatus.value,
              tone: measurementStatus.tone,
            }
          : {
              label: "API",
              value: backendSourceLabel(backendSource),
              tone: measurementStatus.tone,
            }
      }
      sidebarStatusLabel={
        isHostedBackend
          ? measurementStatus.value
          : backendSourceLabel(backendSource)
      }
      sidebarSections={sidebarSections}
      rightRail={
        <div className="analytics-discovery-layout__wire" id="section-live-wire">
          <HubLiveWireFeed
            {...liveWireFeedProps}
            selectedMomentKey={selectedMomentKey}
            onSelectMoment={chartBucketSelectEnabled ? handleSelectLiveWireMoment : undefined}
            canSelectMoment={canSelectLiveWireMoment}
            footer={<Link className="analytics-discovery-layout__moments-link" to="/analytics/moments">Browse all moments & saved →</Link>}
          />
        </div>
      }
    >
      <main
        className="figma-analytics__main"
        aria-label="StreamPulse analytics"
        data-hub-state={hubUiState}
      >
        <div id="analytics-main" tabIndex={-1} className="analytics-focus-target">Analytics content</div>
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

        <nav className="hub-mobile-sections" aria-label="Analytics sections">
          {sidebarSections.filter(section => !section.hidden).map(section => <a key={section.id} href={`#${section.id}`} aria-current={(hash || '#section-overview') === `#${section.id}` ? 'location' : undefined}>{section.label}</a>)}
        </nav>

        <SectionReveal id="section-overview">
          <HubCommandHeader
            hub={data}
            measurementAvailable={measurementAvailable}
            loading={loadingInitial || hubUiState === "loading"}
            lastSuccessfulPollAt={hub.lastSuccessfulPollAt}
            hubEndpointOk={hub.hubEndpointOk}
            loadSource={hub.loadSource}
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

        <SectionReveal id="section-live-rail" className="hub-live-rail-section">
          <div className="hub-live-rail-section__head">
            <h2 className="hub-live-rail-section__title">Hottest Live</h2>
            <span className="hub-live-rail-section__meta">Channel discovery · not a clip-quality ranking</span>
          </div>
          <p className="muted">Top {featuredChannels.length} supplied channels by recent chat or emote rate. Tracking does not confirm current live presence.</p>
          {measurementsUnavailable ? (
            <p role="status" className="muted">Channel activity unavailable. Search still opens channel analytics.</p>
          ) : (
            <FigmaLiveChannelRail channels={featuredChannels} loading={loadingInitial} />
          )}
        </SectionReveal>

        <SectionReveal id="section-network">
          <div className="figma-activity-hub">
            {hub.error && measurementAvailable && ACTIVITY_WINDOW_MINUTES[activityWindow] !== (data.activity.requestedWindowMinutes ?? data.activity.windowMinutes) ? (
              <p className="figma-hub-fallback-banner" role="status">
                Could not load {activityWindow} activity. Retaining the last {formatActivityWindowLabel(servedActivityWindowMinutes)} snapshot.
              </p>
            ) : null}
            <a className="analytics-discovery__jump" href="#section-live-wire">Jump to Live Wire</a>
            <div className="analytics-discovery-layout">
            <div className="analytics-discovery-layout__chart">
            <FigmaGlobalActivityPanel
              unavailable={measurementsUnavailable}
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
                options: activityRangeOptions,
                onSelect: (key) => {
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("window", key);
                      return next;
                    },
                    { replace: true },
                  );
                  setWireSelectionActive(false);
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
              selectedMomentKey={selectedMomentKey}
              onSelectMoment={handleSelectMoment}
            />
            </div>
            <div className="analytics-discovery-layout__secondary">
            {measurementsUnavailable ? <section id="section-pulse-moments" role="status"><h2>Moments unavailable</h2><p>No measured hub snapshot is available. Retry the hub request to check for moments.</p></section> : <PulseMomentsLivePanel
              hub={data}
              feed={livePulseFeed}
              topEmotes={data.topEmotes}
              loading={loadingInitial}
              layout="embedded"
              requireExplicitSelection
              selectedBucketT={chartBucketSelectEnabled && !wireSelectionActive ? selectedBucketT : null}
              hoverBucketT={chartBucketSelectEnabled && !wireSelectionActive ? hoverBucketT : null}
              onClearBucketFilter={
                chartBucketSelectEnabled ? handleClearBucketFilter : undefined
              }
              onBucketMomentsChange={chartBucketSelectEnabled && !wireSelectionActive ? setBucketMoments : undefined}
              onBucketLoadingChange={
                chartBucketSelectEnabled && !wireSelectionActive ? setBucketMomentsLoading : undefined
              }
              onPoolMomentsChange={chartBucketSelectEnabled ? setPoolMoments : undefined}
              activityWindow={activityWindow}
              activityWindowMinutes={servedActivityWindowMinutes}
              updatedAgo={updatedAgo}
              selectedMomentKey={selectedMomentKey}
              onSelectMoment={handleSelectMoment}
            />}
            </div>
            </div>
          </div>
        </SectionReveal>

        <SectionReveal id="section-emote-signal">
          {measurementsUnavailable ? <section role="status"><h2>Emote measurements unavailable</h2><p>No measured hub snapshot is available; missing data does not mean zero emote traffic.</p></section> : <FigmaEmoteSignalBlock
            intel={data.emoteIntel}
            topEmotes={data.topEmotes}
            topMovers={topMovers}
            loading={loadingInitial}
            corpusPipeline={data.corpusPipeline}
            poolSize={data.poolSize}
            windowMinutes={data.activity.windowMinutes}
            emoteMarket={data.emoteMarket}
          />}
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
              rosterLive={data.coverage.liveChannels}
            />
          </SectionReveal>
        ) : null}

        <details className="hub-audit-disclosure" data-collection-diagnostics>
          <summary>Collection diagnostics and source details</summary>
        {measurementsUnavailable ? <p role="status">Collection measurements and their source window are unavailable. No coverage or capacity values can be inferred from a failed request.</p> : <>
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
        </>}
        </details>
      </main>
    </AnalyticsFigmaShell>
  );
}

export default function AnalyticsLandingPage() {
  return <AnalyticsLandingContent />;
}
