/**
 * The d3-v5 hub activity panel (U6), behind VITE_PUBLIC_HUB_V5. Same props as
 * the default FigmaGlobalActivityPanel, so the page can swap one for the
 * other; the chips under the card are shared with it.
 */
import { useCallback, useMemo, useRef } from "react";
import {
  bucketMinutes,
  formatActivityWindowLabel,
} from "../../../lib/hubActivitySummary";
import {
  formatHubActivityServedLabel,
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
import { HubActivityChart } from "../hub/HubActivityChartV5";
import { ActivityViewerSanityBanner } from "./ActivityViewerSanityBanner";
import {
  hubLiveChannelCount,
  SAMPLED_PEAK_LABEL,
  SAMPLED_VIEWERS_DEFINITION,
  WATCHING_NOW_LABEL,
  watchingNowDefinition,
} from "../../../lib/hubViewerScopes";
import { hubMetricLegend } from "../../../lib/hubMetricHelpers";
import { useCommandCenterLabels } from "../../providers/AnalyticsThemeProvider";
import {
  ActivityHonestyChip,
  CollectorHealthChip,
  type FigmaGlobalActivityPanelProps,
} from "./FigmaGlobalActivityPanel";
import "../hub/hub.css";

/**
 * The hub's activity block (U6): the d3 activity card (header, readout, chart,
 * navigator, provider lanes) and, under it, the measurement details the (i)
 * link opens. The bucket card (U7) reads the shared hub bucket selection; the
 * page props for the old inspector stay accepted until the page moves (U4).
 */
export function HubActivityPanelV5({
  hub,
  activitySummary,
  topEmotes = [],
  loading,
  unavailable = false,
  rangeControl,
  livePulseSource = "empty",
  chartBucketSelectEnabled = false,
  selectedBucketT = null,
  onBucketSelect,
  activityRefreshing = false,
  accentBucketT = null,
  annotationLane,
}: FigmaGlobalActivityPanelProps) {
  const labels = useCommandCenterLabels();
  /** The chart's card: the wheel zooms anywhere over it (owner rule). */
  const hubChartCardRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const livePoolFallback = isHubActivityLivePoolFallback(hub.activity);
  const historicalProjection = isHubActivityHistoricalProjection(hub.activity);
  const servedLabel = formatHubActivityServedLabel(hub.activity);
  const honestyDetail = hubActivityHonestyDetail(hub.activity);
  const honestyEmpty = hubActivityHonestyEmptyCopy(hub.activity);
  const activityContractIssues = hubActivityContractIssues(hub.activity);
  const activityContractIssue = activityContractIssues[0] ?? null;
  const requestedWindowLabel = formatActivityWindowLabel(
    Math.max(1, hub.activity.windowMinutes || 30),
  );
  const availableWindowLabel = formatActivityWindowLabel(
    resolveHubActivityChartWindowMinutes(hub.activity),
  );

  const emoteImages = useMemo(() => {
    const map = new Map<string, string>();
    for (const emote of topEmotes) {
      if (emote.imageUrl) map.set(emote.name.toLowerCase(), emote.imageUrl);
    }
    return map;
  }, [topEmotes]);

  // Chart inputs ignore trust-line / refresh metadata — only activity fields + live pool sum.
  const chartInputs = selectHubChartActivityInputs(hub);
  const chartModel = useMemo(
    () => deriveHubChartActivityModel(chartInputs),
    [chartInputs.points, chartInputs.windowMinutes, chartInputs.livePoolViewerSum],
  );
  const { peakViewers } = chartModel;
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

  // "How this is measured" (the (i) link): open the details under the card and bring them into view.
  const openMeasured = useCallback(() => {
    const details = detailsRef.current;
    if (!details) return;
    details.open = true;
    const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    details.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }, []);

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
      <div
        ref={hubChartCardRef}
        className="figma-global-activity__hub-chart hub-act"
        data-hub-chart-wheel-card=""
        data-bench-chart-card=""
        data-refreshing={activityRefreshing ? "true" : undefined}
      >
        <HubActivityChart
          wheelCardRef={hubChartCardRef}
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
          rangeControl={rangeControl}
          annotationLane={annotationLane}
          emptyTitle={unavailable ? 'Measured activity unavailable' : honestyEmpty?.title}
          emptyDescription={unavailable ? 'The hub could not supply a measured snapshot. This is not evidence of an empty or inactive pool.' : honestyEmpty?.description}
          selectedBucketT={selectedBucketT}
          accentBucketT={selectedBucketT == null ? accentBucketT : null}
          providerTotalsComplete={hub.activity.providerTotalsComplete === true}
          onBucketSelect={chartBucketSelectEnabled ? onBucketSelect : undefined}
          emoteImages={emoteImages}
          bucketMinutes={hub.activity.bucketMinutes}
          providerCoverage={hub.activity.providerCoverage}
          onOpenMeasured={unavailable ? undefined : openMeasured}
        />
      </div>
      <details ref={detailsRef} className="figma-global-activity__measurement-details">
        <summary>Measurement and coverage details</summary>
        <p className="figma-global-activity__lede muted">{measurementSummary}</p>
        {!unavailable ? <p>{hubMetricLegend(hub)}</p> : null}
        {!unavailable ? (
          <dl className="figma-global-activity__viewer-definitions" data-testid="hub-viewer-definitions">
            <div>
              <dt>{SAMPLED_PEAK_LABEL} (this chart)</dt>
              <dd>{SAMPLED_VIEWERS_DEFINITION}</dd>
            </div>
            <div>
              <dt>{WATCHING_NOW_LABEL} (page header)</dt>
              <dd>{watchingNowDefinition(hubLiveChannelCount(hub))}</dd>
            </div>
          </dl>
        ) : null}
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
    </section>
  );
}
