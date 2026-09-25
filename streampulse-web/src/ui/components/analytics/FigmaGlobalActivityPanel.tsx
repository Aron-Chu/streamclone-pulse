import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InspectorReveal } from './InspectorReveal';
import type { ActivitySummary } from "../../../lib/hubActivitySummary";
import {
  bucketMinutes,
  formatActivityWindowLabel,
} from "../../../lib/hubActivitySummary";
import {
  formatHubActivityServedLabel,
  hubActivityHonestyChipLabel,
  hubActivityHonestyDetail,
  hubActivityHonestyEmptyCopy,
  hubActivityContractIssues,
  hubActivityPointsWithinServedWindow,
  isHubActivityHistoricalProjection,
  isHubActivityLivePoolFallback,
  resolveHubActivityChartWindowMinutes,
} from "../../../lib/hubActivityHonesty";
import {
  deriveHubChartActivityModel,
  selectHubChartActivityInputs,
} from "../../../lib/hubChartActivityModel";
import type { FigmaMomentRow } from "../../../lib/figmaSessionAnalytics";
import type { HubEmote, HubLiveChannel, PublicHub } from "../../../lib/publicHub";
import {
  HubActivityChart,
  type HubActivityRangeControl,
} from "../hub/HubActivityChart";
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

function ActivityHonestyChip({ hub }: { hub: PublicHub }) {
  const label = hubActivityHonestyChipLabel(hub.activity);
  if (!label) return null;
  const detail = hubActivityHonestyDetail(hub.activity);
  return (
    <SystemStatusBadge
      state="degraded"
      label={label}
      className="figma-global-activity__status-chip"
      title={detail ?? undefined}
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
  const livePoolFallback = isHubActivityLivePoolFallback(hub.activity);
  const historicalProjection = isHubActivityHistoricalProjection(hub.activity);
  const windowLabel = formatHubActivityServedLabel(hub.activity);
  const requestedWindowLabel = formatActivityWindowLabel(
    Math.max(1, hub.activity.windowMinutes || 30),
  );
  const availableWindowLabel = formatActivityWindowLabel(
    resolveHubActivityChartWindowMinutes(hub.activity),
  );
  const bucket = bucketMinutes(resolveHubActivityChartWindowMinutes(hub.activity));
  const poolSize = hub.poolSize;
  const ircActive = hub.corpusPipeline.collectorActive;

  return (
    <div
      className={`figma-chart-source${className ? ` ${className}` : ""}`}
      aria-label="Chart rollup source"
    >
      <span>
        <strong>Source:</strong>{" "}
        {livePoolFallback
          ? "Live pool fallback (recent only)"
          : historicalProjection
            ? "Historical projection"
            : "Legacy/unspecified activity source"}
      </span>
      <span>
        <strong>Window:</strong>{" "}
        {livePoolFallback
          ? `${requestedWindowLabel} requested · ${availableWindowLabel} available`
          : historicalProjection
            ? `last ${windowLabel}`
            : `served ${windowLabel}`}
      </span>
      <span>
        <strong>Buckets:</strong> ~{bucket} min - {activitySummary.pointCount}/
        {activitySummary.expectedBuckets}
      </span>
      <span>
        <strong>Activity:</strong> {hub.activity.source ?? "unspecified"} / {hub.activity.state ?? "legacy"}
      </span>
      <span>
        <strong>Generated:</strong> {hub.generatedAt || "unavailable"}
      </span>
      {hub.backendVersion ? (
        <span>
          <strong>Backend:</strong> {hub.backendVersion}
        </span>
      ) : null}
      {import.meta.env.VITE_PORTAL_RELEASE ?? import.meta.env.VITE_GIT_SHA ? (
        <span>
          <strong>Portal:</strong>{" "}
          {import.meta.env.VITE_PORTAL_RELEASE ?? import.meta.env.VITE_GIT_SHA}
        </span>
      ) : null}
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
  unavailable?: boolean;
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
  selectedMomentKey?: string | null;
  onSelectMoment?: (moment: FigmaMomentRow) => void;
  /** Fresh Live Wire breakouts mounted directly above the chart they control. */
  annotationLane?: ReactNode;
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
  unavailable = false,
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
  selectedMomentKey = null,
  onSelectMoment,
  annotationLane,
}: FigmaGlobalActivityPanelProps) {
  const labels = useCommandCenterLabels();
  const { fadeThemeCenter, motionEnabled } = useAnalyticsMotion();
  const inspectorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const prevWindowKeyRef = useRef(activityWindowKey);
  const livePoolFallback = isHubActivityLivePoolFallback(hub.activity);
  const historicalProjection = isHubActivityHistoricalProjection(hub.activity);
  const servedLabel = formatHubActivityServedLabel(hub.activity);
  const honestyDetail = hubActivityHonestyDetail(hub.activity);
  const honestyEmpty = hubActivityHonestyEmptyCopy(hub.activity);
  const activityContractIssues = hubActivityContractIssues(hub.activity);
  const activityContractIssue = activityContractIssues[0] ?? null;
  const windowLabel = servedLabel;
  const requestedWindowLabel = formatActivityWindowLabel(
    Math.max(1, hub.activity.windowMinutes || 30),
  );
  const availableWindowLabel = formatActivityWindowLabel(
    resolveHubActivityChartWindowMinutes(hub.activity),
  );
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
    // Pinned investigation survives actions in Live Wire and the moment list.
    // Dismissing it on pointer-down shifts layout before those controls receive
    // pointer-up, losing clicks as well as the user's selection.
    if (selectedBucketT != null || hoverBucketT == null) return;

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
  const {
    chartPoints,
    peakViewers,
    peakViewersAt,
    peakChatPerMin,
  } = chartModel;
  // A legacy fallback can contain stale rows from the requested long range.
  // The chart model has already bounded those rows to the served slice; keep
  // the raw contract issue visible in diagnostics without withholding a
  // truthful recent chart when the rendered inputs are now bounded.
  const fallbackPayloadRepaired = Boolean(
    activityContractIssue &&
      livePoolFallback &&
      chartModel.chartState !== "unmeasured" &&
      hubActivityPointsWithinServedWindow(
        chartInputs.points,
        chartInputs.windowMinutes,
      ),
  );
  const blockingActivityContractIssue = fallbackPayloadRepaired
    ? null
    : activityContractIssue;
  const chartState = loading
    ? "loading"
    : unavailable || blockingActivityContractIssue
      ? "unavailable"
    : chartModel.chartState === "ready"
      ? livePoolFallback
        ? "degraded"
        : "ready"
      : chartModel.chartState;
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

  // On touch layouts the inspector stacks below a tall chart: bring a newly
  // tapped bucket's summary into view instead of changing content off-screen.
  useEffect(() => {
    if (selectedBucketT == null || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    const inspector = inspectorRef.current;
    if (!inspector) return;
    const stickyHeader = document.querySelector<HTMLElement>(".analytics-topnav")?.getBoundingClientRect().height ?? 0;
    const rect = inspector.getBoundingClientRect();
    if (rect.top >= stickyHeader && rect.top < window.innerHeight - 120) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: window.scrollY + rect.top - stickyHeader - 8, behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedBucketT]);

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
  const measurementSummary = unavailable
    ? "Network measurements are unavailable. This is not evidence of an empty or inactive tracking pool."
    : livePoolFallback
      ? `Showing ${servedLabel} of measured tracked-network activity. Viewer peaks use tracked channels; chat and emote rates use the live IRC collection pool.`
      : historicalProjection
        ? `Showing the measured ${servedLabel} historical projection for tracked channels; sparse buckets remain visible as gaps.`
        : `Showing the served ${servedLabel} tracked-network measurement. Historical projection provenance is not confirmed.`;

  return (
    <section
      className="figma-global-activity"
      aria-label={labels.liveActivity}
      data-hub-activity-state={chartState}
      data-hub-requested-window-minutes={hub.activity.windowMinutes}
      data-hub-served-window-minutes={chartInputs.windowMinutes}
      data-hub-activity-source={hub.activity.source ?? "unspecified"}
      data-hub-activity-repaired={fallbackPayloadRepaired ? "true" : undefined}
    >
      <div className="figma-global-activity__headline">
        <div className="figma-global-activity__headline-row">
          <h2 className="figma-block__title">{labels.liveActivity}</h2>
          {updatedAgo ? (
            <HubFreshnessCaption updatedAgo={updatedAgo} className="figma-global-activity__freshness" />
          ) : null}
        </div>
        <p className="figma-global-activity__lede muted">{measurementSummary}</p>
        {peakViewersAt != null && peakViewers > 0 ? (
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
            {peakViewersAt ? (
              <span className="figma-global-activity__peak-time muted">
                {formatPeakTime(peakViewersAt)}
              </span>
            ) : null}
          </div>
        ) : null}
        <details className="figma-global-activity__measurement-details">
          <summary>Measurement and coverage details</summary>
          {!unavailable ? <p>{hubMetricLegend(hub)}</p> : null}
          <ActivityViewerSanityBanner
            hub={hub}
            chartPeakViewers={peakViewers}
            chartWindowMinutes={chartInputs.windowMinutes}
          />
          <div className="figma-global-activity__measurement-statuses">
            <ActivityHonestyChip hub={hub} />
            <CollectorHealthChip hub={hub} />
          </div>
          <p className="figma-global-activity__served-window" data-testid="hub-activity-served-window" role="status">
            {unavailable ? 'Measurement window unavailable.' : fallbackPayloadRepaired
              ? `${requestedWindowLabel} requested · ${availableWindowLabel} available; older fallback rows were discarded because historical projection is unavailable.`
              : blockingActivityContractIssue
              ? `Activity payload withheld: ${blockingActivityContractIssue}.`
              : livePoolFallback
              ? `${requestedWindowLabel} requested · ${availableWindowLabel} available; historical projection is unavailable.`
              : `Showing served ${servedLabel}.`}
          </p>
          {honestyDetail ? <p>{honestyDetail}</p> : null}
          {!unavailable ? <p>{chartNote}</p> : null}
        </details>
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
        {unavailable ? 'Chart interaction is unavailable until a measured snapshot loads.' : 'In-progress bucket omitted.'}
        {activityRefreshing ? (
          <span className="figma-global-activity__chart-refresh" role="status">
            {" "}
            Updating chart…
          </span>
        ) : null}
      </p>
      <div
        className="figma-global-activity__body"
        data-inspector-active={Boolean(selectedPoint)}
        ref={bodyRef}
      >
        <div
          className="figma-global-activity__chart-col"
          ref={chartAreaRef}
          data-refreshing={activityRefreshing ? "true" : undefined}
        >
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
              dataIssue={blockingActivityContractIssue}
              loading={loading}
              footnote={
                livePoolFallback
                  ? `${activitySummary.footnote} · ${servedLabel}`
                  : activitySummary.footnote
              }
              rangeControl={rangeControl}
              annotationLane={annotationLane}
              emptyTitle={unavailable ? 'Measured activity unavailable' : honestyEmpty?.title}
              emptyDescription={unavailable ? 'The hub could not supply a measured snapshot. This is not evidence of an empty or inactive pool.' : honestyEmpty?.description}
              selectedBucketT={selectedBucketT}
              accentBucketT={selectedBucketT == null ? accentBucketT : null}
              providerTotalsComplete={hub.activity.providerTotalsComplete === true}
              onBucketSelect={
                chartBucketSelectEnabled ? onBucketSelect : undefined
              }
              onBucketHover={undefined}
              emoteImages={emoteImages}
            />
          </div>
        </div>
        <div className="figma-global-activity__inspector" data-active={Boolean(selectedPoint)} ref={inspectorRef}>
          <InspectorReveal open={Boolean(selectedPoint)}>
            <ActivityBucketInspector
            rangeEmotes={topEmotes}
            bucketMomentEmotes={bucketMomentEmotes}
            bucketMoments={bucketMoments}
            bucketMomentsLoading={bucketMomentsLoading}
            windowLabel={windowLabel}
            windowMinutes={chartInputs.windowMinutes}
            updatedAgo={updatedAgo}
            emoteIntel={hub.emoteIntel}
            topEmoteName={topEmotes[0]?.name}
            selectedPoint={selectedPoint}
            hoverPoint={null}
            linkedMoment={linkedMoment}
            onClearLinkedMoment={onClearLinkedMoment}
            bucketLocked={selectedBucketT != null}
            onClearBucket={clearBucketFocus}
            providerTotalsComplete={hub.activity.providerTotalsComplete === true}
            liveChannels={liveChannels}
            className="figma-global-activity__inspector-panel"
          />
          </InspectorReveal>
        </div>
      </div>
    </section>
  );
}
