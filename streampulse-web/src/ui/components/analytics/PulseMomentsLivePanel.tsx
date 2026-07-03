import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildAnalyticsHref } from "../../../lib/analyticsLinks";
import {
  featuredSessionFromPublicHub,
  mapHubPulseMoment,
  momentRowKey,
  resolveLivePulseMoments,
  type LivePulseMomentsResult,
} from "../../../lib/figmaSessionAnalytics";
import {
  buildEmoteLookup,
  countIrcRollupChannels,
  filterMomentsByBucket,
  filterPulseMoments,
  isBucketWithinLiveHorizon,
  momentEmoteRollupsEmptyHint,
  PULSE_MOMENT_FILTER_HINT,
  SCORE_EXPLANATION,
  sourceLabel,
  type PulseMomentFilter,
} from "../../../lib/pulseMomentsUtils";
import type { PublicHub, PublicHubActivityWindow } from "../../../lib/publicHub";
import { fetchHistoricalHubMoments } from "../../../lib/publicHub";
import { getBackendUrl } from "../../../lib/apiClient";
import { resolveBackendSource } from "../../../lib/backendSource";
import { FigmaMomentInspector } from "./FigmaMomentInspector";
import { MostReactedMinutesTable } from "./MostReactedMinutesTable";
import { TopEmoteBurstsPanel } from "./TopEmoteBurstsPanel";
import { withComputedBurstShare } from "../../../lib/emoteShare";
import { compact } from "./hubFormat";

const NETWORK_FILTERS: Array<{ key: PulseMomentFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "chat", label: "Chat spikes" },
  { key: "emotes", label: "Emote spikes" },
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
  selectedBucketT?: number | null;
  activityWindow?: PublicHubActivityWindow;
  activityWindowMinutes?: number;
  updatedAgo?: string;
}

export function PulseMomentsLivePanel({
  hub,
  topEmotes,
  loading,
  feed: feedProp,
  selectedBucketT = null,
  activityWindow = "7d",
  activityWindowMinutes = 180,
  updatedAgo,
}: PulseMomentsLivePanelProps) {
  const featured = useMemo(() => featuredSessionFromPublicHub(hub), [hub]);
  const resolvedFeed = useMemo(() => resolveLivePulseMoments(hub), [hub]);
  const feed = feedProp ?? resolvedFeed;
  const isFallback =
    feed.source === "featured_fallback" || feed.source === "legacy_fallback";
  const [filter, setFilter] = useState<PulseMomentFilter>("all");
  const [historicalMoments, setHistoricalMoments] = useState<
    ReturnType<typeof mapHubPulseMoment>[]
  >([]);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalStatus, setHistoricalStatus] = useState<
    "idle" | "ready" | "empty" | "error"
  >("idle");
  const effectiveFilter: PulseMomentFilter = isFallback ? "all" : filter;
  const liveBucketFiltered = useMemo(() => {
    if (feed.source !== "network" || selectedBucketT == null) {
      return feed.moments;
    }
    return filterMomentsByBucket(
      feed.moments,
      selectedBucketT,
      activityWindowMinutes,
      hub.liveChannels,
    );
  }, [
    activityWindowMinutes,
    feed.moments,
    feed.source,
    hub.liveChannels,
    selectedBucketT,
  ]);
  const bucketOutsideLive =
    selectedBucketT != null && !isBucketWithinLiveHorizon(selectedBucketT);
  const liveBucketMiss =
    feed.source === "network" &&
    selectedBucketT != null &&
    !bucketOutsideLive &&
    liveBucketFiltered.length === 0 &&
    feed.moments.length > 0;
  const useHistoricalFetch = bucketOutsideLive || liveBucketMiss;

  useEffect(() => {
    if (!useHistoricalFetch || selectedBucketT == null || feed.source !== "network") {
      setHistoricalMoments([]);
      setHistoricalStatus("idle");
      setHistoricalLoading(false);
      return;
    }
    const controller = new AbortController();
    setHistoricalLoading(true);
    fetchHistoricalHubMoments(
      selectedBucketT,
      activityWindow,
      controller.signal,
    )
      .then((response) => {
        const rows = response.moments.map(mapHubPulseMoment);
        setHistoricalMoments(rows);
        setHistoricalStatus(
          response.status === "ready" && rows.length > 0 ? "ready" : "empty",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHistoricalMoments([]);
          setHistoricalStatus("error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setHistoricalLoading(false);
        }
      });
    return () => controller.abort();
  }, [activityWindow, feed.source, selectedBucketT, useHistoricalFetch]);

  const bucketFilterMiss =
    feed.source === "network" &&
    selectedBucketT != null &&
    !useHistoricalFetch &&
    liveBucketFiltered.length === 0 &&
    feed.moments.length > 0;
  const historicalSourceActive =
    useHistoricalFetch && historicalStatus === "ready" && historicalMoments.length > 0;
  const allMoments = useMemo(() => {
    if (feed.source !== "network" || selectedBucketT == null) {
      return feed.moments;
    }
    if (useHistoricalFetch) {
      if (historicalLoading) return [];
      if (historicalMoments.length > 0) return historicalMoments;
      if (bucketOutsideLive) return [];
      return feed.moments;
    }
    if (liveBucketFiltered.length > 0) return liveBucketFiltered;
    if (bucketFilterMiss) return feed.moments;
    return liveBucketFiltered;
  }, [
    bucketFilterMiss,
    bucketOutsideLive,
    feed.moments,
    feed.source,
    historicalLoading,
    historicalMoments,
    liveBucketFiltered,
    selectedBucketT,
    useHistoricalFetch,
  ]);
  const emoteLookup = useMemo(() => {
    const rows: PublicHub["topEmotes"] = [...topEmotes];
    for (const moment of feed.moments) {
      for (const emote of moment.topEmotes ?? []) {
        if (!emote.name?.trim()) continue;
        rows.push({
          name: emote.name,
          provider: emote.provider,
          imageUrl: emote.imageUrl,
          count: emote.count ?? 0,
          sharePct: 0,
        });
      }
    }
    return buildEmoteLookup(rows);
  }, [feed.moments, topEmotes]);
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
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    filteredMoments[0] ? momentRowKey(filteredMoments[0]) : undefined,
  );

  useEffect(() => {
    const next = filteredMoments[0]
      ? momentRowKey(filteredMoments[0])
      : undefined;
    setSelectedKey((current) => {
      if (current && filteredMoments.some((m) => momentRowKey(m) === current))
        return current;
      return next;
    });
  }, [filteredMoments]);

  const selectedMoment = useMemo(
    () =>
      filteredMoments.find((m) => momentRowKey(m) === selectedKey) ??
      filteredMoments[0] ??
      null,
    [filteredMoments, selectedKey],
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

  const hasNetworkMoments = feed.moments.length > 0 || historicalSourceActive;
  const bucketFilterActive =
    feed.source === "network" &&
    selectedBucketT != null &&
    !bucketFilterMiss &&
    !useHistoricalFetch &&
    liveBucketFiltered.length > 0;
  const bucketFilterEmpty =
    selectedBucketT != null &&
    !historicalLoading &&
    allMoments.length === 0 &&
    (useHistoricalFetch || bucketFilterActive);
  const ready = hasNetworkMoments || (useHistoricalFetch && historicalLoading);
  const backendSource = resolveBackendSource(getBackendUrl());
  const emptyReason =
    featured.state === "ready"
      ? "No backend peaks in the IRC tracking pool yet."
      : backendSource === "local"
        ? "Reading local Streamclone stack - switch to hosted API for live IRC peaks and emote economy."
        : (EMPTY_REASONS[featured.reason ?? ""] ??
          EMPTY_REASONS.no_qualifying_session);

  const feedBanner = useMemo(() => {
    if (selectedBucketT != null && feed.source === "network") {
      if (historicalLoading) {
        return "Loading corpus peaks for the selected chart bucket…";
      }
      if (historicalSourceActive) {
        return `Showing ${historicalMoments.length} corpus peak${historicalMoments.length === 1 ? "" : "s"} from the selected chart bucket. Click the bucket again to clear.`;
      }
      if (useHistoricalFetch && historicalStatus === "empty") {
        return "This chart bucket has network activity but no stored corpus peaks yet. Clear the selection or try a busier bucket.";
      }
      if (useHistoricalFetch && historicalStatus === "error") {
        return "Could not load corpus peaks for this bucket — showing live peaks when available.";
      }
      if (bucketFilterMiss) {
        if (!isBucketWithinLiveHorizon(selectedBucketT)) {
          return "This chart bucket is outside the live IRC peak window (~3h). Corpus peaks load when the backend deploy includes /v1/public/hub/moments.";
        }
        return "This bucket has network activity but no IRC peaks landed in it. Showing all current live peaks — click the chart again to clear.";
      }
      if (liveBucketFiltered.length > 0) {
        return `Showing ${liveBucketFiltered.length} peak${liveBucketFiltered.length === 1 ? "" : "s"} from the selected chart bucket. Click the bucket again to clear.`;
      }
    }
    if (feed.banner) return feed.banner;
    if (
      feed.source === "network" &&
      channelCount <= 1 &&
      ircChannelCount <= 1
    ) {
      return "Only 1 IRC-covered live channel has peaks in this window.";
    }
    if (feed.source === "network" && channelCount <= 1 && ircChannelCount > 1) {
      return "Multiple channels are tracked, but only one channel produced peaks right now.";
    }
    return undefined;
  }, [
    bucketFilterMiss,
    channelCount,
    feed.banner,
    feed.source,
    historicalLoading,
    historicalMoments.length,
    historicalSourceActive,
    historicalStatus,
    ircChannelCount,
    liveBucketFiltered.length,
    selectedBucketT,
    useHistoricalFetch,
  ]);

  const channelLabel =
    feed.source === "featured_fallback"
      ? "1 channel - featured fallback"
      : feed.source === "legacy_fallback"
        ? "Legacy hub.moments"
        : channelCount > 0
          ? `${channelCount} channel${channelCount === 1 ? "" : "s"}`
          : undefined;

  const sectionClass = `pulse-moments-live${isFallback ? " pulse-moments-live--fallback" : ""}`;

  return (
    <section
      className={sectionClass}
      aria-labelledby="pulse-moments-live-title"
    >
      <header className="pulse-moments-live__head">
        <div>
          <p className="pulse-moments-live__eyebrow">
            <span className="pulse-moments-live__live-dot" aria-hidden="true" />
            {historicalSourceActive ? "Corpus historical peaks" : "Live IRC peaks"}
          </p>
          <h2
            id="pulse-moments-live-title"
            className="pulse-moments-live__title"
          >
            Pulse Moments Live
          </h2>
          <p
            className="pulse-moments-live__sub"
            title={isFallback ? undefined : SCORE_EXPLANATION}
          >
            {isFallback
              ? "Backend deploy or IRC pool state - not a browser error. Chart bucket selection is unavailable in fallback mode."
              : historicalSourceActive
                ? `Top corpus peaks for the selected chart bucket — ${SCORE_EXPLANATION.toLowerCase()}`
                : `Top peaks across IRC-tracked channels - ${SCORE_EXPLANATION.toLowerCase()}`}
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
                {compact(hub.coverage.liveChannels)} live -{" "}
                {compact(ircChannelCount)} IRC -{" "}
                {sourceLabel(selectedMoment?.source)}
              </span>
            ) : null}
            {selectedMoment?.href ? (
              <Link
                className="pulse-moments-live__open"
                to={selectedMoment.href}
              >
                Open moment
              </Link>
            ) : selectedSessionHref ? (
              <Link
                className="pulse-moments-live__open pulse-moments-live__open--ghost"
                to={selectedSessionHref}
              >
                Open session
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

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
          {historicalLoading
            ? "Loading corpus peaks for chart bucket..."
            : "Loading live IRC peaks..."}
        </div>
      ) : !ready || filteredMoments.length === 0 ? (
        <div className="pulse-moments-live__empty">
          <strong>
            {!ready
              ? "Live peaks unavailable"
              : bucketFilterEmpty
                ? "No peaks in this chart bucket"
                : "No moments match this filter"}
          </strong>
          <p>
            {!ready
              ? emptyReason
              : bucketFilterEmpty
                ? useHistoricalFetch
                  ? historicalStatus === "error"
                    ? "Corpus peak fetch failed for this bucket."
                    : "No stored corpus peaks matched this chart bucket yet."
                  : !isBucketWithinLiveHorizon(selectedBucketT)
                    ? "Live peaks only cover the last ~3 hours. Corpus historical peaks load when you select an older bucket."
                    : "No IRC peaks matched this bucket yet. Clear the chart selection to see all live peaks."
                : bucketFilterMiss
                  ? "Showing all live peaks because this bucket had activity but no matching IRC spike rows."
                  : selectedBucketT != null
                    ? "Clear the chart bucket selection or wait for more IRC rollups."
                    : "Try another filter or wait for more IRC rollups across tracked channels."}
          </p>
        </div>
      ) : isFallback ? (
        <div className="pulse-moments-live__fallback-card">
          <MostReactedMinutesTable
            moments={filteredMoments}
            selectedKey={selectedKey}
            emoteLookup={emoteLookup}
            variant="pulse-live"
            liveLogins={liveLogins}
            onSelect={(moment) => setSelectedKey(momentRowKey(moment))}
          />
        </div>
      ) : (
        <div className="pulse-moments-live__grid">
          <MostReactedMinutesTable
            moments={filteredMoments}
            selectedKey={selectedKey}
            emoteLookup={emoteLookup}
            variant="pulse-live"
            liveLogins={liveLogins}
            onSelect={(moment) => setSelectedKey(momentRowKey(moment))}
          />
          <div className="pulse-moments-live__side">
            <FigmaMomentInspector
              moment={selectedMoment}
              vodId={selectedMoment?.vodId}
              momentHref={selectedMoment?.href}
              sessionHref={selectedSessionHref}
              emoteLookup={emoteLookup}
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
