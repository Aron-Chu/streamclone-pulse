import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySummary } from "../../../lib/hubActivitySummary";
import {
  bucketMinutes,
  formatActivityWindowLabel,
} from "../../../lib/hubActivitySummary";
import {
  deriveHubChartActivityModel,
  selectHubChartActivityInputs,
} from "../../../lib/hubChartActivityModel";
import type { FigmaMomentRow } from "../../../lib/figmaSessionAnalytics";
import type { HubEmote, HubLiveChannel, PublicHub } from "../../../lib/publicHub";
import {
  HubActivityChart,
  type HubActivityMomentMarker,
  type HubActivityRangeControl,
} from "../hub/HubActivityChart";
import { HubLiveWireFeed } from "./HubLiveWireFeed";
import type { LivePulseMomentsResult } from "../../../lib/figmaSessionAnalytics";
import type { PublicHubActivityWindow, PublicHubLoadSource } from "../../../lib/publicHub";
import { HubSearch, type HubSuggestion } from "../hub/HubSearch";
import { ActivityBucketInspector } from "./ActivityBucketInspector";
import { ActivityViewerSanityBanner } from "./ActivityViewerSanityBanner";
import { HubFreshnessCaption } from "./HubFreshnessCaption";
import { SystemStatusBadge } from "./primitives/SystemStatusBadge";
import { compact } from "./hubFormat";
import { hubMetricLegend } from "../../../lib/hubMetricHelpers";
import { useCommandCenterLabels } from "../../providers/AnalyticsThemeProvider";
import { useAnalyticsMotion } from "../../motion/useAnalyticsMotion";
import { Link } from "react-router-dom";
import "../hub/hub.css";

function CollectorHealthChip({ hub }: { hub: PublicHub }) {
  const roster = hub.corpusPipeline.roster;
  const active = roster.collectorTracking || hub.corpusPipeline.collectorActive;
  const expected =
    roster.expectedCollectorRows || hub.corpusPipeline.collectorMax;
  const deficit = roster.liveCollectorDeficitRows;
  const admissionStalled =
    roster.admissionDisabled > 0 || roster.metadataStale > 0;
  const hasIssue =
    admissionStalled || deficit > 0 || (expected > 0 && active < expected);
  if (!hasIssue) return null;

  const shortLabel = admissionStalled
    ? `Coverage degraded · ${compact(active)}/${compact(expected)} IRC collecting`
    : `Live chat limited · ${compact(active)}/${compact(expected)} IRC collecting`;

  const detail = [
    admissionStalled
      ? "IRC admission disabled or roster metadata stale."
      : "Live chat coverage limited.",
    `${compact(active)} live rows with active IRC collectors`,
    expected > 0 ? `${compact(expected)} expected from live roster` : null,
    deficit > 0 ? `${compact(deficit)} live channels without IRC yet` : null,
    "Chat and emote chart lines require an active IRC collector; viewer counts may still show from Helix.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SystemStatusBadge
      state="degraded"
      label={shortLabel}
      className="figma-global-activity__status-chip"
      title={detail}
    />
  );
}

/**
 * Chart provenance strip ("Source: hosted API + IRC worker plane - window - buckets"). Now
 * rendered at the very bottom of the analytics page rather than above the chart,
 * so it reads as a footer/provenance note instead of competing with the search.
 */
export function ChartSourceBanner({
  hub,
  activitySummary,
  className,
}: {
  hub: PublicHub;
  activitySummary: ActivitySummary;
  className?: string;
}) {
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes);
  const bucket = bucketMinutes(hub.activity.windowMinutes);
  const poolSize = hub.poolSize;
  const ircActive = hub.corpusPipeline.collectorActive;

  return (
    <div
      className={`figma-chart-source${className ? ` ${className}` : ""}`}
      aria-label="Chart rollup source"
    >
      <span>
        <strong>Source:</strong> Live IRC collector plane
      </span>
      <span>
        <strong>Window:</strong> last {windowLabel}
      </span>
      <span>
        <strong>Buckets:</strong> ~{bucket} min - {activitySummary.pointCount}/
        {activitySummary.expectedBuckets}
      </span>
      {poolSize > 0 ? (
        <span>
          <strong>Pool:</strong> {compact(poolSize)} tracked channels
          {ircActive > 0 && hub.corpusPipeline.collectorMax > 0
            ? ` · ${compact(ircActive)}/${compact(hub.corpusPipeline.collectorMax)} IRC`
            : ''}
        </span>
      ) : null}
      <span className="figma-chart-source__links">
        <Link to="/status">Status</Link>
      </span>
    </div>
  );
}

export interface FigmaGlobalActivityPanelProps {
  hub: PublicHub;
  activitySummary: ActivitySummary;
  suggestions: HubSuggestion[];
  topEmotes?: HubEmote[];
  loading?: boolean;
  rangeControl?: HubActivityRangeControl;
  livePulseSource?:
    | "network"
    | "featured_fallback"
    | "legacy_fallback"
    | "empty";
  chartBucketSelectEnabled?: boolean;
  selectedBucketT?: number | null;
  onBucketSelect?: (bucketT: number | null) => void;
  /** Fired when the chart hover bucket changes (preview inspector). */
  onBucketHover?: (bucketT: number | null) => void;
  showSearch?: boolean;
  updatedAgo?: string;
  activityRefreshing?: boolean;
  /** Changes when the activity time window changes (24h/7d/…) — triggers crossfade. */
  activityWindowKey?: string;
  /** Emotes aggregated from bucket-filtered Pulse Moments (inspector fallback). */
  bucketMomentEmotes?: HubEmote[];
  /** Pulse Moments rows in the active chart bucket (selected or hover preview). */
  bucketMoments?: FigmaMomentRow[];
  /** Historical bucket fetch in flight (selected bucket only). */
  bucketMomentsLoading?: boolean;
  /** Compact link to selected Pulse Moments row (detail stays in table inspector). */
  linkedMoment?: {
    login: string;
    displayName?: string;
    label: string;
  } | null;
  onClearLinkedMoment?: () => void;
  liveChannels?: HubLiveChannel[];
  /** Visual-only bucket highlight when a moment is selected without a locked bucket. */
  accentBucketT?: number | null;
  momentMarkers?: HubActivityMomentMarker[];
  selectedMomentKey?: string | null;
  onSelectMoment?: (moment: FigmaMomentRow) => void;
  onSelectMomentKey?: (key: string) => void;
  /** Live Wire annotation lane feed (mounted above the plot). */
  annotationFeed?: LivePulseMomentsResult | null;
  annotationLoading?: boolean;
  annotationHubEndpointOk?: boolean;
  annotationLoadSource?: PublicHubLoadSource;
  annotationActivityWindow?: PublicHubActivityWindow;
}

function formatPeakTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FigmaGlobalActivityPanel({
  hub,
  activitySummary,
  suggestions,
  topEmotes = [],
  loading,
  rangeControl,
  livePulseSource = "empty",
  chartBucketSelectEnabled = false,
  selectedBucketT = null,
  onBucketSelect,
  onBucketHover,
  showSearch = true,
  updatedAgo,
  activityRefreshing = false,
  activityWindowKey,
  bucketMomentEmotes = [],
  bucketMoments = [],
  bucketMomentsLoading = false,
  linkedMoment = null,
  onClearLinkedMoment,
  liveChannels = [],
  accentBucketT = null,
  momentMarkers = [],
  selectedMomentKey = null,
  onSelectMoment,
  onSelectMomentKey,
  annotationFeed = null,
  annotationLoading = false,
  annotationHubEndpointOk,
  annotationLoadSource,
  annotationActivityWindow = "24h",
}: FigmaGlobalActivityPanelProps) {
  const labels = useCommandCenterLabels();
  const { transitionInspector, fadeThemeCenter, motionEnabled } = useAnalyticsMotion();
  const inspectorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const prevWindowKeyRef = useRef(activityWindowKey);
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes);
  const [hoverBucketT, setHoverBucketT] = useState<number | null>(null);
  const hoverIntentRef = useRef<number | null>(null);
  const hoverIntentTimerRef = useRef<number | null>(null);
  const hasLinkedMoment = Boolean(linkedMoment);

  const emoteImages = useMemo(() => {
    const map = new Map<string, string>();
    for (const emote of topEmotes) {
      if (emote.imageUrl) map.set(emote.name.toLowerCase(), emote.imageUrl);
    }
    return map;
  }, [topEmotes]);

  const handleBucketHover = useCallback((bucketT: number | null) => {
    if (hasLinkedMoment) return;
    if (bucketT == null) {
      if (hoverIntentTimerRef.current != null) {
        window.clearTimeout(hoverIntentTimerRef.current);
        hoverIntentTimerRef.current = null;
      }
      hoverIntentRef.current = null;
      setHoverBucketT(null);
      return;
    }
    hoverIntentRef.current = bucketT;
    if (hoverIntentTimerRef.current != null) {
      window.clearTimeout(hoverIntentTimerRef.current);
    }
    hoverIntentTimerRef.current = window.setTimeout(() => {
      hoverIntentTimerRef.current = null;
      if (hoverIntentRef.current === bucketT) {
        setHoverBucketT(bucketT);
      }
    }, 80);
  }, [hasLinkedMoment]);

  useEffect(() => () => {
    if (hoverIntentTimerRef.current != null) {
      window.clearTimeout(hoverIntentTimerRef.current);
    }
  }, []);

  const clearBucketFocus = useCallback(() => {
    if (hoverIntentTimerRef.current != null) {
      window.clearTimeout(hoverIntentTimerRef.current);
      hoverIntentTimerRef.current = null;
    }
    hoverIntentRef.current = null;
    setHoverBucketT(null);
    onBucketHover?.(null);
    if (selectedBucketT != null) onBucketSelect?.(null);
  }, [onBucketHover, onBucketSelect, selectedBucketT]);

  const prevSelectedBucketTRef = useRef(selectedBucketT);
  useEffect(() => {
    const wasSelected = prevSelectedBucketTRef.current != null;
    prevSelectedBucketTRef.current = selectedBucketT;
    if (!wasSelected || selectedBucketT != null) return;
    if (hoverIntentTimerRef.current != null) {
      window.clearTimeout(hoverIntentTimerRef.current);
      hoverIntentTimerRef.current = null;
    }
    hoverIntentRef.current = null;
    setHoverBucketT(null);
    onBucketHover?.(null);
  }, [onBucketHover, selectedBucketT]);

  useEffect(() => {
    const bucketFocused = selectedBucketT != null || hoverBucketT != null;
    if (!bucketFocused) return;

    const onPointerDown = (event: PointerEvent) => {
      const chartArea = chartAreaRef.current;
      if (!chartArea) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (chartArea.contains(target)) return;
      clearBucketFocus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [clearBucketFocus, hoverBucketT, selectedBucketT]);

  // Chart inputs ignore trust-line / refresh metadata — only activity fields + live pool sum.
  const chartInputs = selectHubChartActivityInputs(hub);
  const chartModel = useMemo(
    () => deriveHubChartActivityModel(chartInputs),
    [chartInputs.points, chartInputs.windowMinutes, chartInputs.livePoolViewerSum],
  );
  const { chartPoints, peakViewers, peakChatPerMin } = chartModel;
  const peakPoint = chartPoints.reduce(
    (best, point) => (point.viewers > (best?.viewers ?? 0) ? point : best),
    chartPoints[0],
  );
  const peakChatPoint = chartPoints.reduce(
    (best, point) => (point.chat > (best?.chat ?? 0) ? point : best),
    chartPoints[0],
  );
  const poolSize = hub.poolSize;
  const ircActive = hub.corpusPipeline.collectorActive;

  const selectedPoint = useMemo(() => {
    if (selectedBucketT != null) {
      return chartPoints.find((p) => p.t === selectedBucketT) ?? null;
    }
    // Moment selection: show that bucket's preview in the rail (not a second inspector).
    if (accentBucketT != null) {
      return chartPoints.find((p) => p.t === accentBucketT) ?? null;
    }
    return null;
  }, [accentBucketT, chartPoints, selectedBucketT]);

  const hoverPoint = useMemo(() => {
    if (hasLinkedMoment || selectedBucketT != null || hoverBucketT == null) return null;
    return chartPoints.find((p) => p.t === hoverBucketT) ?? null;
  }, [chartPoints, hasLinkedMoment, hoverBucketT, selectedBucketT]);

  useEffect(() => {
    if (selectedPoint) {
      onBucketHover?.(null);
      return;
    }
    onBucketHover?.(hoverBucketT);
  }, [hoverBucketT, onBucketHover, selectedPoint]);

  const prevSelectedTRef = useRef<number | null>(null);

  useEffect(() => {
    const nextT = selectedPoint?.t ?? null;
    if (nextT == null) {
      prevSelectedTRef.current = null;
      return;
    }
    if (prevSelectedTRef.current === nextT) return;
    prevSelectedTRef.current = nextT;
    const chrome = inspectorRef.current?.querySelector(
      ".activity-bucket-inspector__chrome",
    );
    transitionInspector(chrome instanceof HTMLElement ? chrome : null);
  }, [selectedPoint?.t, transitionInspector]);

  useEffect(() => {
    if (!activityWindowKey || !motionEnabled) return;
    if (prevWindowKeyRef.current === activityWindowKey) return;
    prevWindowKeyRef.current = activityWindowKey;
    fadeThemeCenter(bodyRef.current);
  }, [activityWindowKey, fadeThemeCenter, motionEnabled]);

  const chartNote = chartBucketSelectEnabled
    ? "Click any activity bucket to filter Pulse Moments in this panel (older buckets load corpus peaks). In-progress bucket omitted from chart."
    : livePulseSource === "featured_fallback" ||
        livePulseSource === "legacy_fallback"
      ? "Chart clicks don't filter fallback moments — open a channel session for chart-to-moment. In-progress bucket omitted from chart."
      : "Hover for bucket totals. Tracked chat only (not all of Twitch). In-progress bucket omitted from chart.";

  return (
    <section
      className="figma-global-activity"
      aria-label={labels.liveActivity}
    >
      <div className="figma-global-activity__headline">
        <div className="figma-global-activity__headline-row">
          <h2 className="figma-block__title">{labels.liveActivity}</h2>
          {updatedAgo ? (
            <HubFreshnessCaption updatedAgo={updatedAgo} className="figma-global-activity__freshness" />
          ) : null}
        </div>
        <p className="figma-global-activity__lede muted">
          Network viewer peaks from tracked channels — last {windowLabel}.
          Chat and emote lines come from the live tracking pool.
        </p>
        <p className="figma-global-activity__lede muted">{hubMetricLegend(hub)}</p>
        <ActivityViewerSanityBanner hub={hub} />
        {peakPoint && peakViewers > 0 ? (
          <div className="figma-global-activity__peak-row" role="group" aria-label="Peak summary">
            <span className="figma-global-activity__peak-stat">
              <span className="figma-global-activity__peak-label">Peak global viewers</span>
              <strong>{compact(peakViewers)}</strong>
            </span>
            {chartInputs.livePoolViewerSum > 0 ? (
              <span className="figma-global-activity__peak-stat">
                <span className="figma-global-activity__peak-label">Live pool sum now</span>
                <strong>{compact(chartInputs.livePoolViewerSum)}</strong>
              </span>
            ) : null}
            {peakChatPerMin > 0 ? (
              <span className="figma-global-activity__peak-stat">
                <span className="figma-global-activity__peak-label">Peak chat/min</span>
                <strong>{compact(peakChatPerMin)}</strong>
              </span>
            ) : null}
            {peakPoint.t ? (
              <span className="figma-global-activity__peak-time muted">
                {formatPeakTime(peakPoint.t)}
              </span>
            ) : null}
          </div>
        ) : null}
        <CollectorHealthChip hub={hub} />
      </div>
      {showSearch ? (
      <div
        className="figma-global-activity__search"
        role="search"
        aria-label="Channel search"
      >
        <HubSearch
          suggestions={suggestions}
          placeholder="Search live channels..."
          showKbd
        />
      </div>
      ) : null}
      <p className="figma-global-activity__chart-note" role="note">
        {chartNote}
        {activityRefreshing ? (
          <span className="figma-global-activity__chart-refresh" role="status">
            {" "}
            Updating chart…
          </span>
        ) : null}
      </p>
      <div className="figma-global-activity__body" ref={bodyRef}>
        <div
          className="figma-global-activity__chart-col"
          ref={chartAreaRef}
          data-refreshing={activityRefreshing ? "true" : undefined}
        >
          {annotationFeed ? (
            <div className="figma-global-activity__annotation-lane" id="section-live-wire">
              <HubLiveWireFeed
                hub={hub}
                feed={annotationFeed}
                activityWindow={annotationActivityWindow}
                loading={annotationLoading}
                hubEndpointOk={annotationHubEndpointOk}
                loadSource={annotationLoadSource}
                layout="lane"
                selectedMomentKey={selectedMomentKey}
                onSelectMoment={onSelectMoment}
              />
            </div>
          ) : null}
          <div className="hubx figma-global-activity__chart figma-global-activity__hub-chart">
            <HubActivityChart
              points={chartInputs.points}
              windowMinutes={chartInputs.windowMinutes}
              channelCount={hub.activity.channelCount}
              poolSize={hub.poolSize}
              livePoolViewerSum={chartInputs.livePoolViewerSum}
              expectedBuckets={activitySummary.expectedBuckets}
              missingBuckets={activitySummary.missingBuckets}
              coveragePct={activitySummary.coveragePct}
              loading={loading}
              footnote={activitySummary.footnote}
              rangeControl={rangeControl}
              selectedBucketT={selectedBucketT}
              accentBucketT={selectedBucketT == null ? accentBucketT : null}
              onBucketSelect={
                chartBucketSelectEnabled ? onBucketSelect : undefined
              }
              onBucketHover={
                selectedBucketT == null && !hasLinkedMoment
                  ? handleBucketHover
                  : undefined
              }
              momentMarkers={momentMarkers}
              selectedMomentKey={selectedMomentKey}
              onSelectMomentKey={onSelectMomentKey}
              emoteImages={emoteImages}
            />
          </div>
        </div>
        <div className="figma-global-activity__inspector" ref={inspectorRef}>
          <ActivityBucketInspector
            rangeEmotes={topEmotes}
            bucketMomentEmotes={bucketMomentEmotes}
            bucketMoments={bucketMoments}
            bucketMomentsLoading={bucketMomentsLoading}
            windowLabel={windowLabel}
            windowMinutes={hub.activity.windowMinutes}
            updatedAgo={updatedAgo}
            emoteIntel={hub.emoteIntel}
            topEmoteName={topEmotes[0]?.name}
            selectedPoint={selectedPoint}
            hoverPoint={hoverPoint}
            linkedMoment={linkedMoment}
            onClearLinkedMoment={onClearLinkedMoment}
            bucketLocked={selectedBucketT != null}
            liveChannels={liveChannels}
            className="figma-global-activity__inspector-panel"
          />
        </div>
      </div>
    </section>
  );
}
