import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { buildAnalyticsHref, analyticsActionLabel } from "../../../lib/analyticsLinks";
import {
  featuredSessionFromPublicHub,
  mapHubPulseMoment,
  momentRowKey,
  resolveLivePulseMoments,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from "../../../lib/figmaSessionAnalytics";
import {
  buildEmoteLookupFromMoments,
  enrichPulseMomentRows,
} from "../../../lib/pulseMomentRow";
import {
  countIrcRollupChannels,
  filterMomentsByBucket,
  filterPulseMoments,
  momentEmoteRollupsEmptyHint,
  PULSE_MOMENT_FILTER_HINT,
  SCORE_EXPLANATION,
  type PulseMomentFilter,
} from "../../../lib/pulseMomentsUtils";
import { buildPulseMomentsBucketDiagnostics } from "../../../lib/pulseMomentsBucketDiagnostics";
import {
  fetchHistoricalHubMoments,
  type PublicHub,
  type PublicHubActivityWindow,
} from "../../../lib/publicHub";
import {
  readBucketMomentsCache,
  writeBucketMomentsCache,
} from "../../../lib/bucketMomentsCache";
import { FigmaMomentInspector } from "./FigmaMomentInspector";
import { MostReactedMinutesTable } from "./MostReactedMinutesTable";
import { TopEmoteBurstsPanel } from "./TopEmoteBurstsPanel";
import { withComputedBurstShare } from "../../../lib/emoteShare";
import { compact } from "./hubFormat";
import { useCommandCenterLabels } from "../../providers/AnalyticsThemeProvider";
import { useAnalyticsMotion } from "../../motion/useAnalyticsMotion";

const NETWORK_FILTERS: Array<{ key: PulseMomentFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "chat", label: "Chat spikes" },
  { key: "emotes", label: "Emote spikes" },
  { key: "stream_opening", label: "Just went live" },
];

const EMPTY_REASONS: Record<string, string> = {
  no_qualifying_session:
    "No live channel currently qualifies. StreamPulse needs IRC-tracked rooms with minute rollups and detected peaks.",
  store_unavailable:
    "Analytics store unavailable - featured moments need Postgres rollups.",
  stream_unavailable: "The picked live stream could not be loaded.",
  rollup_unavailable:
    "Minute rollups are missing - IRC collector may still be warming up.",
  insufficient_peaks:
    "Rollups exist but no peaks were detected yet. Give the stream a few minutes of chat activity.",
};

export interface PulseMomentsLivePanelProps {
  hub: PublicHub;
  topEmotes: PublicHub["topEmotes"];
  loading?: boolean;
  feed?: LivePulseMomentsResult;
  layout?: "standalone" | "embedded";
  selectedBucketT?: number | null;
  /** Chart hover bucket — prefetch historical peaks for faster lock-on-click. */
  hoverBucketT?: number | null;
  onClearBucketFilter?: () => void;
  activityWindow?: PublicHubActivityWindow;
  activityWindowMinutes?: number;
  updatedAgo?: string;
  /** Fires when bucket-filtered moments change (for chart inspector emote fallback). */
  onBucketMomentsChange?: (moments: FigmaMomentRow[]) => void;
  /** Fires when historical bucket fetch loading state changes. */
  onBucketLoadingChange?: (loading: boolean) => void;
  /** Full enriched live peak pool (for hover-bucket emote aggregation). */
  onPoolMomentsChange?: (moments: FigmaMomentRow[]) => void;
  /** Hub embedded: controlled row selection for chart rail inspector. */
  selectedMomentKey?: string | null;
  onSelectMoment?: (moment: FigmaMomentRow) => void;
}

export function PulseMomentsLivePanel({
  hub,
  topEmotes,
  loading,
  feed: feedProp,
  layout = "standalone",
  selectedBucketT = null,
  hoverBucketT = null,
  onClearBucketFilter,
  activityWindow = "24h",
  activityWindowMinutes = 180,
  updatedAgo,
  onBucketMomentsChange,
  onBucketLoadingChange,
  onPoolMomentsChange,
  selectedMomentKey: selectedMomentKeyProp = null,
  onSelectMoment,
}: PulseMomentsLivePanelProps) {
  const labels = useCommandCenterLabels();
  const isEmbedded = layout === "embedded";
  const isHubControlled = isEmbedded && Boolean(onSelectMoment);
  const featured = useMemo(() => featuredSessionFromPublicHub(hub), [hub]);
  const resolvedFeed = useMemo(() => resolveLivePulseMoments(hub), [hub]);
  const feed = feedProp ?? resolvedFeed;
  const isFallback =
    feed.source === "featured_fallback" || feed.source === "legacy_fallback";
  const [filter, setFilter] = useState<PulseMomentFilter>("all");
  const effectiveFilter: PulseMomentFilter = isFallback ? "all" : filter;
  const categoryByLogin = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of hub.liveChannels) {
      const category = ch.category?.trim();
      if (category) map.set(ch.login.toLowerCase(), category);
    }
    return map;
  }, [hub.liveChannels]);
  const enrichCtx = useMemo(
    () => ({ liveChannels: hub.liveChannels, categoryByLogin }),
    [categoryByLogin, hub.liveChannels],
  );
  const [bucketMoments, setBucketMoments] = useState<
    ReturnType<typeof mapHubPulseMoment>[]
  >([]);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketStatus, setBucketStatus] = useState<
    "idle" | "ready" | "empty" | "error"
  >("idle");
  const [bucketReason, setBucketReason] = useState<string | undefined>();
  const bucketSelected =
    feed.source === "network" && selectedBucketT != null;

  const poolMoments = useMemo(
    () => enrichPulseMomentRows(feed.moments, enrichCtx),
    [enrichCtx, feed.moments],
  );

  const optimisticBucketMoments = useMemo(() => {
    if (!bucketSelected || selectedBucketT == null) return [];
    return filterMomentsByBucket(
      poolMoments,
      selectedBucketT,
      activityWindowMinutes,
      hub.liveChannels,
    );
  }, [
    activityWindowMinutes,
    bucketSelected,
    hub.liveChannels,
    poolMoments,
    selectedBucketT,
  ]);

  useEffect(() => {
    if (
      !bucketSelected ||
      selectedBucketT == null ||
      bucketMoments.length > 0 ||
      !bucketLoading
    ) {
      return;
    }
    if (optimisticBucketMoments.length === 0) return;
    setBucketMoments(optimisticBucketMoments);
    setBucketStatus("ready");
    setBucketLoading(false);
  }, [
    bucketLoading,
    bucketMoments.length,
    bucketSelected,
    optimisticBucketMoments,
    selectedBucketT,
  ]);

  useEffect(() => {
    if (
      feed.source !== "network" ||
      hoverBucketT == null ||
      selectedBucketT != null
    ) {
      return;
    }
    if (readBucketMomentsCache(hoverBucketT, activityWindow)?.length) return;

    const controller = new AbortController();
    fetchHistoricalHubMoments(hoverBucketT, activityWindow, controller.signal)
      .then((response) => {
        const rows = response.moments.map(mapHubPulseMoment);
        writeBucketMomentsCache(hoverBucketT, activityWindow, rows);
      })
      .catch(() => {
        /* ignore prefetch errors */
      });
    return () => controller.abort();
  }, [activityWindow, feed.source, hoverBucketT, selectedBucketT]);

  useEffect(() => {
    if (!bucketSelected || selectedBucketT == null) {
      setBucketMoments([]);
      setBucketStatus("idle");
      setBucketReason(undefined);
      setBucketLoading(false);
      return;
    }
    const cached = readBucketMomentsCache(selectedBucketT, activityWindow) ?? [];
    const interim =
      cached.length > 0 ? cached : filterMomentsByBucket(
        poolMoments,
        selectedBucketT,
        activityWindowMinutes,
        hub.liveChannels,
      );
    setBucketMoments(interim);
    setBucketStatus(interim.length > 0 ? "ready" : "idle");
    setBucketReason(undefined);
    setBucketLoading(interim.length === 0);

    const controller = new AbortController();
    fetchHistoricalHubMoments(
      selectedBucketT,
      activityWindow,
      controller.signal,
    )
      .then((response) => {
        const rows = response.moments.map(mapHubPulseMoment);
        writeBucketMomentsCache(selectedBucketT, activityWindow, rows);
        setBucketMoments(rows);
        setBucketReason(response.reason);
        setBucketStatus(
          response.status === "ready" && rows.length > 0 ? "ready" : "empty",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted && interim.length === 0) {
          setBucketMoments([]);
          setBucketReason(undefined);
          setBucketStatus("error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBucketLoading(false);
        }
      });
    return () => controller.abort();
  }, [activityWindow, bucketSelected, selectedBucketT]);

  const allMoments = useMemo(() => {
    const base = bucketSelected ? bucketMoments : feed.moments;
    return enrichPulseMomentRows(base, enrichCtx);
  }, [bucketMoments, bucketSelected, enrichCtx, feed.moments]);

  useEffect(() => {
    onPoolMomentsChange?.(poolMoments);
  }, [onPoolMomentsChange, poolMoments]);

  useEffect(() => {
    onBucketLoadingChange?.(bucketSelected ? bucketLoading : false);
  }, [bucketLoading, bucketSelected, onBucketLoadingChange]);

  useEffect(() => {
    if (!onBucketMomentsChange) return;
    onBucketMomentsChange(selectedBucketT != null ? allMoments : []);
  }, [allMoments, onBucketMomentsChange, selectedBucketT]);

  const emoteLookup = useMemo(
    () => buildEmoteLookupFromMoments(allMoments, topEmotes),
    [allMoments, topEmotes],
  );
  const ircChannelCount = useMemo(
    () => countIrcRollupChannels(hub.liveChannels),
    [hub.liveChannels],
  );
  const filteredMoments = useMemo(
    () => filterPulseMoments(allMoments, effectiveFilter),
    [allMoments, effectiveFilter],
  );
  const channelCount = useMemo(
    () =>
      new Set(
        filteredMoments.map((m) => m.login?.toLowerCase()).filter(Boolean),
      ).size,
    [filteredMoments],
  );
  const liveLogins = useMemo(
    () => new Set(hub.liveChannels.map((ch) => ch.login.toLowerCase())),
    [hub.liveChannels],
  );
  const [internalSelectedKey, setInternalSelectedKey] = useState<string | undefined>(
    filteredMoments[0] ? momentRowKey(filteredMoments[0]) : undefined,
  );

  const selectedKey = isHubControlled
    ? (selectedMomentKeyProp ?? undefined)
    : internalSelectedKey;

  useEffect(() => {
    if (isHubControlled) return;
    const next = filteredMoments[0]
      ? momentRowKey(filteredMoments[0])
      : undefined;
    setInternalSelectedKey((current) => {
      if (current && filteredMoments.some((m) => momentRowKey(m) === current))
        return current;
      return next;
    });
  }, [filteredMoments, isHubControlled]);

  const handleSelectMoment = (moment: FigmaMomentRow) => {
    if (isHubControlled) {
      onSelectMoment?.(moment);
      return;
    }
    setInternalSelectedKey(momentRowKey(moment));
  };

  const selectedMoment = useMemo(
    () =>
      filteredMoments.find((m) => momentRowKey(m) === selectedKey) ??
      (!isHubControlled ? filteredMoments[0] : null) ??
      null,
    [filteredMoments, isHubControlled, selectedKey],
  );

  const selectedSessionHref = useMemo(() => {
    if (!selectedMoment?.login) return undefined;
    return buildAnalyticsHref({
      login: selectedMoment.login,
      streamId: selectedMoment.streamId,
      offsetSeconds: selectedMoment.offsetSeconds,
    });
  }, [selectedMoment]);

  const selectedBursts = useMemo(() => {
    if (!selectedMoment?.topEmotes?.length) return [];
    return withComputedBurstShare(
      selectedMoment.topEmotes.map((emote) => ({
        code: emote.name,
        provider: emote.provider,
        imageUrl: emote.imageUrl,
        count: emote.count ?? 0,
        sharePct: emote.sharePct,
      })),
    );
  }, [selectedMoment]);

  const bucketDiagnostics = useMemo(() => {
    if (selectedBucketT == null || feed.source !== "network") return null;
    return buildPulseMomentsBucketDiagnostics({
      selectedBucketT,
      activityWindowMinutes,
      activityPoints: hub.activity.points,
      liveMoments: feed.moments,
      liveChannels: hub.liveChannels,
      historicalStatus: bucketStatus,
      historicalReason: bucketReason,
      historicalCount: bucketMoments.length,
      historicalLoading: bucketLoading,
    });
  }, [
    activityWindowMinutes,
    bucketLoading,
    bucketMoments.length,
    bucketReason,
    bucketStatus,
    feed.moments,
    feed.source,
    hub.activity.points,
    hub.liveChannels,
    selectedBucketT,
  ]);

  const bucketSourceActive =
    bucketSelected && bucketStatus === "ready" && bucketMoments.length > 0;
  const hasNetworkMoments = feed.moments.length > 0 || bucketSourceActive;
  const bucketFilterEmpty =
    bucketSelected && !bucketLoading && allMoments.length === 0;
  const ready = hasNetworkMoments || (bucketSelected && bucketLoading);
  const emptyReason =
    featured.state === "ready"
      ? "No backend peaks in the IRC tracking pool yet."
      : (EMPTY_REASONS[featured.reason ?? ""] ??
          EMPTY_REASONS.no_qualifying_session);

  const feedBanner = useMemo(() => {
    if (selectedBucketT != null && feed.source === "network") {
      if (bucketLoading) {
        return "Loading moments for the selected chart bucket…";
      }
      if (bucketSourceActive) {
        return `Showing ${bucketMoments.length} moment${bucketMoments.length === 1 ? "" : "s"} from the selected chart bucket. Click the bucket again to clear.`;
      }
      if (bucketStatus === "empty") {
        return bucketDiagnostics?.historicalReason === "no_corpus_peaks_in_bucket"
          ? "No spikes in this bucket. Clear the selection or try another time."
          : `No stored moments for ${bucketDiagnostics?.bucketLabel ?? "this bucket"}.`;
      }
      if (bucketStatus === "error") {
        return "Could not load moments for this bucket.";
      }
    }
    if (feed.banner) return feed.banner;
    if (
      feed.source === "network" &&
      selectedBucketT == null &&
      activityWindow !== "30m"
    ) {
      return "Click an activity chart bucket to see spikes for that period.";
    }
    if (
      feed.source === "network" &&
      channelCount <= 1 &&
      ircChannelCount <= 1
    ) {
      return "Only one channel has spikes in this window right now.";
    }
    if (feed.source === "network" && channelCount <= 1 && ircChannelCount > 1) {
      return "Multiple channels are tracked, but only one channel produced spikes right now.";
    }
    return undefined;
  }, [
    bucketDiagnostics?.bucketLabel,
    bucketDiagnostics?.historicalReason,
    bucketLoading,
    bucketMoments.length,
    bucketSourceActive,
    bucketStatus,
    channelCount,
    feed.banner,
    feed.source,
    ircChannelCount,
    activityWindow,
    selectedBucketT,
  ]);

  const channelLabel =
    feed.source === "featured_fallback"
      ? "1 channel - featured fallback"
      : feed.source === "legacy_fallback"
        ? "Legacy hub.moments"
        : channelCount > 0
          ? `${channelCount} channel${channelCount === 1 ? "" : "s"}`
          : undefined;

  const sectionClass = `pulse-moments-live${isFallback ? " pulse-moments-live--fallback" : ""}${isEmbedded ? " pulse-moments-live--embedded" : ""}`;
  const filterStaggerKey = effectiveFilter;
  const momentsListRef = useRef<HTMLDivElement>(null);
  const { revealStagger, motionEnabled } = useAnalyticsMotion();

  useEffect(() => {
    if (!motionEnabled) return;
    const container = momentsListRef.current;
    if (!container) return;
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-moment-row]"),
    );
    if (rows.length === 0) return;
    revealStagger(rows);
  }, [filterStaggerKey, motionEnabled, revealStagger]);

  const tableHeaderMeta = useMemo(() => {
    if (!ready) return undefined;
    const parts: string[] = [
      `${compact(filteredMoments.length)} moment${filteredMoments.length === 1 ? "" : "s"}`,
    ];
    if (channelLabel) parts.push(channelLabel);
    if (!isFallback) {
      parts.push(`${compact(hub.coverage.liveChannels)} live`);
    }
    return parts.join(" · ");
  }, [
    channelLabel,
    filteredMoments.length,
    hub.coverage.liveChannels,
    ircChannelCount,
    isFallback,
    ready,
  ]);

  return (
    <section
      className={sectionClass}
      aria-labelledby="pulse-moments-live-title"
      id={isEmbedded ? "section-pulse-moments" : undefined}
    >
      {!isEmbedded ? (
      <header className="pulse-moments-live__head">
        <div>
          <p className="pulse-moments-live__eyebrow">
            <span className="pulse-moments-live__live-dot" aria-hidden="true" />
            {bucketSourceActive ? "Moments from selected time" : "Live moments"}
          </p>
          <h2
            id="pulse-moments-live-title"
            className="pulse-moments-live__title"
          >
            {labels.pulseMoments}
          </h2>
          <p
            className="pulse-moments-live__sub"
            title={isFallback ? undefined : SCORE_EXPLANATION}
          >
            {isFallback
              ? "Moments are temporarily unavailable — try again shortly."
              : bucketSourceActive
                ? `Top spikes for the selected chart bucket — ${SCORE_EXPLANATION.toLowerCase()}`
                : `Top spikes across tracked channels — ${SCORE_EXPLANATION.toLowerCase()}`}
            {updatedAgo ? ` · As of ${updatedAgo}` : ""}
          </p>
        </div>
        {ready ? (
          <div className="pulse-moments-live__meta">
            <span className="pulse-moments-live__meta-pill">
              {compact(filteredMoments.length)} moment
              {filteredMoments.length === 1 ? "" : "s"}
              {channelLabel ? ` - ${channelLabel}` : ""}
            </span>
            {!isFallback ? (
              <span className="pulse-moments-live__meta-pill">
                {compact(hub.coverage.liveChannels)} live
              </span>
            ) : null}
            {selectedMoment?.href ? (
              <Link
                className="pulse-moments-live__open"
                to={selectedMoment.href}
              >
                View moment
              </Link>
            ) : null}
            {selectedSessionHref ? (
              <Link
                className="pulse-moments-live__open pulse-moments-live__open--accent"
                to={selectedSessionHref}
              >
                Analytics
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>
      ) : null}

      {selectedBucketT != null && onClearBucketFilter && feed.source === "network" ? (
        <p className="pulse-moments-live__bucket-filter" role="status">
          Filtered to chart bucket ·{" "}
          <button
            type="button"
            className="pulse-moments-live__bucket-filter-clear"
            onClick={onClearBucketFilter}
          >
            Clear
          </button>
        </p>
      ) : null}

      {bucketDiagnostics ? (
        <div
          className={`pulse-moments-live__diagnostics${isEmbedded ? " pulse-moments-live__diagnostics--compact" : ""}`}
          role="status"
        >
          <strong>Bucket {bucketDiagnostics.bucketLabel}</strong>
          {!isEmbedded ? <span>{bucketDiagnostics.summary}</span> : null}
          <ul className="pulse-moments-live__diagnostics-list">
            <li>
              Chart: {bucketDiagnostics.chartHasActivity ? "activity" : "no activity"}
              {bucketDiagnostics.chartHasActivity
                ? ` · ${compact(bucketDiagnostics.chartViewers)} viewers · ${compact(bucketDiagnostics.chartChatPerMin)}/m chat`
                : ""}
            </li>
            <li>
              Recent window: {bucketDiagnostics.withinLiveHorizon ? "within selected period" : "selected period"}
              {" · "}
              {bucketDiagnostics.livePeaksInBucket} live moment
              {bucketDiagnostics.livePeaksInBucket === 1 ? "" : "s"}
            </li>
            <li>
              Stored moments: {bucketDiagnostics.historicalLoading ? "loading…" : bucketDiagnostics.historicalStatus}
              {bucketDiagnostics.historicalCount > 0
                ? ` · ${bucketDiagnostics.historicalCount} moment${bucketDiagnostics.historicalCount === 1 ? "" : "s"}`
                : bucketDiagnostics.historicalReason
                  ? ` · ${bucketDiagnostics.historicalReason}`
                  : ""}
            </li>
          </ul>
        </div>
      ) : null}

      {feedBanner ? (
        <p
          className={`pulse-moments-live__banner${isFallback ? " pulse-moments-live__banner--info" : ""}`}
          role="status"
        >
          {feedBanner}
        </p>
      ) : null}

      {ready && !isFallback ? (
        <div
          className="pulse-moments-live__filters"
          role="toolbar"
          aria-label="Moment filters"
        >
          {NETWORK_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`pulse-moments-live__filter${filter === key ? " is-active" : ""}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
          <span className="pulse-moments-live__filter-hint">
            {PULSE_MOMENT_FILTER_HINT}
          </span>
          <span className="pulse-moments-live__count">
            {loading ? "..." : `${filteredMoments.length} shown`}
          </span>
        </div>
      ) : null}

      {loading && !ready ? (
        <div className="pulse-moments-live__empty" aria-busy="true">
          {bucketLoading
            ? "Loading moments for the selected chart bucket…"
            : "Loading live IRC peaks..."}
        </div>
      ) : bucketLoading && selectedBucketT != null && filteredMoments.length === 0 ? (
        <div className="pulse-moments-live__empty" aria-busy="true">
          Loading moments for the selected chart bucket…
        </div>
      ) : !ready || filteredMoments.length === 0 ? (
        <div className="pulse-moments-live__empty">
          <strong>
            {!ready
              ? "Live peaks unavailable"
              : bucketFilterEmpty
                ? "No spikes in this bucket"
                : "No moments match this filter"}
          </strong>
          <p>
            {!ready
              ? emptyReason
              : bucketFilterEmpty
                ? bucketStatus === "error"
                  ? "Could not load moments for this bucket."
                  : "No stored or live IRC peaks matched this chart bucket yet. Clear the selection to see all live peaks."
                : selectedBucketT != null
                  ? "Clear the chart bucket selection or wait for more IRC rollups."
                  : "Try another filter or wait for more IRC rollups across tracked channels."}
          </p>
          {bucketFilterEmpty && onClearBucketFilter ? (
            <button
              type="button"
              className="pulse-moments-live__clear-bucket"
              onClick={onClearBucketFilter}
            >
              Clear bucket
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className={`pulse-moments-live__grid${isFallback ? " pulse-moments-live__grid--fallback" : ""}`}
          ref={momentsListRef}
        >
          <MostReactedMinutesTable
            moments={filteredMoments}
            selectedKey={selectedKey}
            emoteLookup={emoteLookup}
            variant="pulse-live"
            liveLogins={liveLogins}
            liveChannels={hub.liveChannels}
            headerMeta={tableHeaderMeta}
            onSelect={handleSelectMoment}
          />
          <div className="pulse-moments-live__side">
            <FigmaMomentInspector
              moment={selectedMoment}
              vodId={selectedMoment?.vodId}
              momentHref={selectedMoment?.href}
              sessionHref={selectedSessionHref}
              emoteLookup={emoteLookup}
              liveChannels={hub.liveChannels}
              channelLive={
                selectedMoment?.login
                  ? liveLogins.has(selectedMoment.login.toLowerCase())
                  : undefined
              }
              channel={
                selectedMoment
                  ? {
                      login: selectedMoment.login,
                      displayName: selectedMoment.displayName,
                      profileImageUrl: selectedMoment.profileImageUrl,
                    }
                  : undefined
              }
              variant="pulse-live"
            />
            <TopEmoteBurstsPanel
              bursts={selectedBursts}
              emoteLookup={emoteLookup}
              variant="pulse-live"
              emptyHint={
                selectedMoment
                  ? momentEmoteRollupsEmptyHint(selectedMoment)
                  : "Select a reacted minute to inspect emotes that drove that spike."
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}
