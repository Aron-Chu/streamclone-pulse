import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySummary } from "../../../lib/hubActivitySummary";
import {
  bucketMinutes,
  chartActivityPoints,
  formatActivityWindowLabel,
  peakActivityChatPerMin,
  peakActivityViewers,
} from "../../../lib/hubActivitySummary";
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
import { hubMetricLegend, livePoolViewerSum } from "../../../lib/hubMetricHelpers";
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
          <strong>Pool:</strong> {compact(poolSize)} live in pool
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
  /** Pulse Moments row shown in the chart rail (hub only). */
  focusedMoment?: FigmaMomentRow | null;
  emoteLookup?: Map<string, HubEmote>;
  liveChannels?: HubLiveChannel[];
  channelLive?: boolean;
  lockedBucketLabel?: string | null;
  onBackToBucket?: () => void;
  /** Visual-only bucket highlight when a moment is selected without a locked bucket. */
  accentBucketT?: number | null;
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
  focusedMoment = null,
  emoteLookup,
  liveChannels = [],
  channelLive,
  lockedBucketLabel = null,
  onBackToBucket,
  accentBucketT = null,
}: FigmaGlobalActivityPanelProps) {
  const labels = useCommandCenterLabels();
  const { transitionInspector, fadeThemeCenter, motionEnabled } = useAnalyticsMotion();
  const inspectorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevWindowKeyRef = useRef(activityWindowKey);
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes);
  const [hoverBucketT, setHoverBucketT] = useState<number | null>(null);
  const hoverIntentRef = useRef<number | null>(null);
  const hoverIntentTimerRef = useRef<number | null>(null);

  const emoteImages = useMemo(() => {
    const map = new Map<string, string>();
    for (const emote of topEmotes) {
      if (emote.imageUrl) map.set(emote.name.toLowerCase(), emote.imageUrl);
    }
    return map;
  }, [topEmotes]);

  const handleBucketHover = useCallback((bucketT: number | null) => {
    if (focusedMoment) return;
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
  }, [focusedMoment]);

  useEffect(() => () => {
    if (hoverIntentTimerRef.current != null) {
      window.clearTimeout(hoverIntentTimerRef.current);
    }
  }, []);

  const chartPoints = useMemo(
    () => chartActivityPoints(hub.activity.points, hub.activity.windowMinutes, undefined, livePoolViewerSum(hub)),
    [hub.activity.points, hub.activity.windowMinutes, hub],
  );
  const peakViewers = peakActivityViewers(hub.activity.points, hub.activity.windowMinutes);
  const peakChatPerMin = peakActivityChatPerMin(hub.activity.points, hub.activity.windowMinutes);
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

  const selectedPoint = useMemo(
    () =>
      selectedBucketT != null
        ? chartPoints.find((p) => p.t === selectedBucketT) ?? null
        : null,
    [chartPoints, selectedBucketT],
  );

  const hoverPoint = useMemo(() => {
    if (focusedMoment || selectedPoint || hoverBucketT == null) return null;
    return chartPoints.find((p) => p.t === hoverBucketT) ?? null;
  }, [chartPoints, focusedMoment, hoverBucketT, selectedPoint]);

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
      : "Hover for bucket totals. Tracked IRC chat only (not all of Twitch). In-progress bucket omitted from chart.";

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
          Network viewer peaks from minute rollups plus Top-N Helix when higher — last {windowLabel}.
          Chat and emote lines are IRC-only.
        </p>
        <p className="figma-global-activity__lede muted">{hubMetricLegend(hub)}</p>
        <ActivityViewerSanityBanner hub={hub} />
        {peakPoint && peakViewers > 0 ? (
          <div className="figma-global-activity__peak-row" role="group" aria-label="Peak summary">
            <span className="figma-global-activity__peak-stat">
              <span className="figma-global-activity__peak-label">Peak global viewers</span>
              <strong>{compact(peakViewers)}</strong>
            </span>
            {livePoolViewerSum(hub) > 0 ? (
              <span className="figma-global-activity__peak-stat">
                <span className="figma-global-activity__peak-label">Live pool sum now</span>
                <strong>{compact(livePoolViewerSum(hub))}</strong>
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
          data-refreshing={activityRefreshing ? "true" : undefined}
        >
          <div className="hubx figma-global-activity__chart figma-global-activity__hub-chart">
            <HubActivityChart
              points={hub.activity.points}
              windowMinutes={hub.activity.windowMinutes}
              channelCount={hub.activity.channelCount}
              poolSize={hub.poolSize}
              livePoolViewerSum={livePoolViewerSum(hub)}
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
                selectedBucketT == null && !focusedMoment ? handleBucketHover : undefined
              }
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
            focusedMoment={focusedMoment}
            emoteLookup={emoteLookup}
            liveChannels={liveChannels}
            channelLive={channelLive}
            lockedBucketT={selectedBucketT}
            lockedBucketLabel={lockedBucketLabel}
            onBackToBucket={onBackToBucket}
            className="figma-global-activity__inspector-panel"
          />
        </div>
      </div>
    </section>
  );
}
