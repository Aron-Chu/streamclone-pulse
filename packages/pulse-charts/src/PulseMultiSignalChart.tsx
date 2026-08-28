import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { parseEmoteKey, reactionAnalyticalOffset, type ChartSelection } from "@streampulse/pulse-core";
import { chatIntervalSelectionFromActivityBar } from "./chatIntervalSelection.ts";
import type {
  ChartGameSegment,
  ChartMinuteRollup,
  ChartPlayhead,
  ChartReactionPoint,
} from "./types.ts";
import { computeChartCursorSync } from "./chartCursorSync.ts";
import { lerpActivityLayout } from "./emotePlotSelection.ts";
import { useSmoothedScalar } from "./useSmoothedScalar.ts";
import { GameSegmentOverlay } from "./GameSegmentOverlay.tsx";
import { ViewerMorphPaths } from "./ViewerMorphPaths.tsx";
import { gameSegmentKey, normalizeGameSegments } from "./gameSegments.ts";
import {
  gameSegmentPlotBoundsByTimestampScale,
  gamesNormalizeDurationSeconds,
} from "./gameSegmentChart.ts";
import {
  CHART_MOTION,
  CHART_THEME,
  adaptiveChartLineWidth,
  chartLineWidth,
  emoteChartColor,
  hexToRgba,
  legendDotStyle,
} from "./chartTheme.ts";
import { buildChartHitRegions, chartHitRegionAtX } from "./chartHitRegions.ts";
import { buildRenderBuckets } from "./renderBuckets.ts";
import { composeRenderView } from "./renderView.ts";
import {
  buildReactionLaneGeometry,
  findReactionMomentAtPlotX,
  type ReactionLaneGeometry,
} from "./reactionLane.ts";
import {
  buildPresentationTrend,
  presentationTrendPathD,
  type PresentationTrend,
} from "./presentationTrend.ts";
import { ChartMotionChrome } from "./ChartMotionChrome.tsx";
import {
  formatChartMinuteChip,
  hoverBandFromBars,
  intervalBandFromTimestamps,
  estimateTimeChipWidth,
  xForPresentationMidIndex,
} from "./ChartMotionChrome.tsx";
import {
  analyzeViewerCoverage,
  chartViewerValue,
  count,
  formatVodClock,
  vodClock,
  minuteEmoteTotal,
  rollupHasMinuteData,
  rollupsHaveViewerData,
  viewerSourceLabel,
  seriesMax,
  viewerObservedValue,
  viewerReadoutValue,
  viewerValue,
} from "./chartRollupUtils.ts";

import { buildChartSeries, type ChartSeries } from "./chartSeries.ts";
import { viewerScaleBounds } from "./viewerScale.ts";
import {
  buildViewerGeometry,
  buildViewerTimestampScale,
  type ViewerTimedValue,
  type ViewerTimestampScale,
} from "./viewerGeometry.ts";
import { resolveViewerInteractionState } from "./viewerInteraction.ts";
import {
  chartViewportPresets,
  CHART_DRAG_INTENT_PX,
  dragPanChartViewport,
  fullChartViewport,
  normalizeChartViewport,
  panChartViewport,
  resolveSelectionReveal,
  viewportCenterSeconds,
  viewportDurationSeconds,
  wheelZoomChartViewport,
  zoomChartViewport,
  type ChartViewport,
} from "./chartViewport.ts";
import { useSmoothedChartViewport } from "./useSmoothedChartViewport.ts";

const ChartHoverReadout = memo(function ChartHoverReadout({
  minuteTs,
  streamStartedAt,
  viewers,
  chatCount,
  emoteTotal,
  reactionScore,
}: {
  minuteTs?: string;
  streamStartedAt?: string;
  viewers: number | null;
  chatCount?: number | null;
  emoteTotal: number | null;
  reactionScore?: number | null;
}) {
  return (
    <p
      className="h-5 min-w-0 truncate text-xs font-bold leading-5 tabular-nums text-zinc-500"
      title="Values at the hovered minute on the chart"
    >
      {vodClock(minuteTs, streamStartedAt)} · viewers {count(viewers)} · chat{" "}
      {count(chatCount)}/min · emotes {count(emoteTotal)}/min
      {reactionScore != null ? ` · reaction ${Math.round(reactionScore)}/100` : ""}
    </p>
  );
});

function buildSeries(
  rollups: ChartMinuteRollup[],
  selected: Set<string>,
  peakViewersFallback = 0,
  avgViewersFallback = 0,
  useViewerFallback = false,
): ChartSeries[] {
  return buildChartSeries(
    rollups,
    selected,
    peakViewersFallback,
    avgViewersFallback,
    useViewerFallback,
  );
}

const ACTIVITY_ZONE_GAP = 8;
/** Keep per-emote traces off the chat/trace divider when the rail is thin. */
const ACTIVITY_TRACE_INSET = 0.12;
const CHART_VIEWBOX_HEIGHT = 400;

function pointOffsetSeconds(
  minuteTs: string,
  streamStartedAt?: string,
): number | null {
  const timestamp = Date.parse(minuteTs);
  const start = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN;
  if (!Number.isFinite(timestamp) || !Number.isFinite(start)) return null;
  return Math.max(0, (timestamp - start) / 1000);
}

function formatViewportDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

type PlotZone =
  "viewer" | "activity-chat" | "activity-emote-trace" | "activity-emote";

type ActivityPlotLayout = {
  zoneFraction: number;
  chat: number;
  trace: number;
  bars: number;
  tracePlacement: "before-bars" | "after-bars";
  activityTop: number;
  activityHeight: number;
  chatSplit: number;
  traceSplit: number;
};

export type ChartLayoutMode = "viewer-led" | "equal-signals";
export type ChartDragPanMode = "off" | "zoomed";
export type ChartLineWeightMode = "fixed" | "viewport-adaptive";

function equalSignalsActivityLayout(
  height: number,
  padTop: number,
  padBottom: number,
): ActivityPlotLayout {
  const fullPlotHeight = height - padTop - padBottom;
  const traceHeight = Math.max(36, Math.min(58, fullPlotHeight * 0.14));
  const laneHeight = Math.max(
    1,
    (fullPlotHeight - ACTIVITY_ZONE_GAP - traceHeight) / 3,
  );
  const activityHeight = laneHeight * 2 + traceHeight;
  const activityTop = padTop + laneHeight + ACTIVITY_ZONE_GAP;
  const chatSplit = activityTop + laneHeight;
  const traceSplit = chatSplit + laneHeight;
  return {
    zoneFraction: activityHeight / fullPlotHeight,
    chat: laneHeight / activityHeight,
    trace: traceHeight / activityHeight,
    bars: laneHeight / activityHeight,
    tracePlacement: "after-bars",
    activityTop,
    activityHeight,
    chatSplit,
    traceSplit,
  };
}

function defaultActivityPlotLayout(
  height: number,
  padTop: number,
  padBottom: number,
): ActivityPlotLayout {
  return buildActivityPlotLayout(height, padTop, padBottom, {
    zoneFraction: 0.36,
    chat: 0.48,
    trace: 0.18,
    bars: 0.34,
  });
}

function buildActivityPlotLayout(
  height: number,
  padTop: number,
  padBottom: number,
  fractions: {
    zoneFraction: number;
    chat: number;
    trace: number;
    bars: number;
  },
): ActivityPlotLayout {
  const fullPlotHeight = height - padTop - padBottom;
  const activityHeight = fullPlotHeight * fractions.zoneFraction;
  const activityTop = height - padBottom - activityHeight;
  const chatSplit = activityTop + activityHeight * fractions.chat;
  const traceSplit = chatSplit + activityHeight * fractions.trace;
  return {
    ...fractions,
    tracePlacement: "before-bars",
    activityTop,
    activityHeight,
    chatSplit,
    traceSplit,
  };
}

function plotBandForZone(
  height: number,
  padTop: number,
  padBottom: number,
  zone: PlotZone,
  layout: ActivityPlotLayout,
) {
  const fullPlotHeight = height - padTop - padBottom;
  const activityHeight = fullPlotHeight * layout.zoneFraction;
  const viewerHeight = fullPlotHeight - activityHeight - ACTIVITY_ZONE_GAP;
  const { activityTop, chatSplit, traceSplit } = layout;
  const layoutBase = {
    activityTop: layout.activityTop,
    activityHeight: layout.activityHeight,
    chatSplit: layout.chatSplit,
    traceSplit: layout.traceSplit,
  };

  switch (zone) {
    case "viewer":
      return {
        bandTop: padTop,
        bandBottom: padTop + viewerHeight,
        bandHeight: viewerHeight,
        ...layoutBase,
      };
    case "activity-chat":
      return {
        bandTop: activityTop,
        bandBottom: chatSplit,
        bandHeight: activityHeight * layout.chat,
        ...layoutBase,
      };
    case "activity-emote-trace":
      if (layout.tracePlacement === "after-bars") {
        return {
          bandTop: traceSplit,
          bandBottom: height - padBottom,
          bandHeight: activityHeight * layout.trace,
          ...layoutBase,
        };
      }
      return {
        bandTop: chatSplit,
        bandBottom: traceSplit,
        bandHeight: activityHeight * layout.trace,
        ...layoutBase,
      };
    case "activity-emote":
      if (layout.tracePlacement === "after-bars") {
        return {
          bandTop: chatSplit,
          bandBottom: traceSplit,
          bandHeight: activityHeight * layout.bars,
          ...layoutBase,
        };
      }
      return {
        bandTop: traceSplit,
        bandBottom: height - padBottom,
        bandHeight: activityHeight * layout.bars,
        ...layoutBase,
      };
    default:
      return {
        bandTop: padTop,
        bandBottom: height - padBottom,
        bandHeight: fullPlotHeight,
        ...layoutBase,
      };
  }
}

function plotY(
  value: number,
  max: number,
  height: number,
  padTop: number,
  padBottom: number,
  zone: PlotZone = "viewer",
  rangeMin = 0,
  layout?: ActivityPlotLayout,
) {
  const resolvedLayout =
    layout ?? defaultActivityPlotLayout(height, padTop, padBottom);
  let { bandTop, bandBottom, bandHeight } = plotBandForZone(
    height,
    padTop,
    padBottom,
    zone,
    resolvedLayout,
  );
  if (zone === "activity-emote-trace" && bandHeight > 0) {
    const inset = bandHeight * ACTIVITY_TRACE_INSET;
    bandTop += inset;
    bandBottom -= inset;
    bandHeight = Math.max(1, bandBottom - bandTop);
  }
  const span = Math.max(1, max - rangeMin);
  const y =
    bandBottom - ((Math.max(rangeMin, value) - rangeMin) / span) * bandHeight;
  return Math.max(bandTop, Math.min(bandBottom, y));
}

type ActivityAxis = { min: number; max: number; mode: "peak" | "fit" };

function activityAxisBounds(
  series: ChartSeries[],
  fitToVisible = true,
  options: { includeAggregateEmotes?: boolean } = {},
): ActivityAxis {
  const includeAggregateEmotes = options.includeAggregateEmotes ?? true;
  const visible: number[] = [];
  for (const item of series) {
    if (item.key === "chat") continue;
    if (!includeAggregateEmotes && item.key === "emotes") continue;
    for (const value of item.values) {
      if (value !== null && value > 0) visible.push(value);
    }
  }
  if (visible.length === 0)
    return { min: 0, max: 1, mode: fitToVisible ? "fit" : "peak" };
  const visibleMin = Math.min(...visible);
  const visibleMax = Math.max(...visible);
  const peakMax = Math.max(1, visibleMax);
  if (!fitToVisible) {
    return { min: 0, max: Math.ceil(peakMax * 1.06), mode: "peak" };
  }
  const span = Math.max(0, visibleMax - visibleMin);
  const pad = span > 0 ? span * 0.05 : Math.max(1, visibleMax * 0.08);
  const fitMin = span > 0 ? Math.max(0, Math.floor(visibleMin - pad)) : 0;
  const fitMax = Math.max(fitMin + 1, Math.ceil(visibleMax + pad));
  return { min: fitMin, max: fitMax, mode: "fit" };
}

function emoteSpikeIndices(
  values: Array<number | null>,
  minFraction = 0.32,
  maxSpikes = 0,
) {
  if (maxSpikes <= 0) return [];
  const positives = values.filter((v): v is number => v !== null && v > 0);
  if (positives.length === 0) return [];
  const max = Math.max(...positives);
  const sorted = [...positives].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const threshold = Math.max(max * minFraction, median * 1.35, 1);
  const spikes: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value < threshold) continue;
    const prev = i > 0 ? (values[i - 1] ?? 0) : 0;
    const next = i < values.length - 1 ? (values[i + 1] ?? 0) : 0;
    if (value >= prev && value >= next) spikes.push(i);
  }
  if (spikes.length <= maxSpikes) return spikes;
  return spikes
    .sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0))
    .slice(0, maxSpikes)
    .sort((a, b) => a - b);
}

function smoothDisplayValues(
  values: Array<number | null>,
  window = 3,
): Array<number | null> {
  if (window <= 1 || values.length < 3) return values;
  const radius = Math.floor(window / 2);
  return values.map((value, index) => {
    if (value === null) return null;
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      const sample = values[index + offset];
      if (sample === null || sample === undefined) continue;
      sum += sample;
      count += 1;
    }
    return count > 0 ? sum / count : value;
  });
}

/** Keep collapsed charts light while letting expanded mode expose detail. */
const ACTIVITY_BARS_COLLAPSED_CAP = 240;
const ACTIVITY_BARS_EXPANDED_CAP = 480;

function activityBarsMaxForLength(
  length: number,
  plotWidthPx = 876,
  pxPerBar = 1.05,
  detailProgress = 0,
) {
  if (length <= 0) return 0;
  const progress = Math.max(0, Math.min(1, detailProgress));
  const target = Math.floor(plotWidthPx / (pxPerBar - progress * 0.25));
  const cap = Math.round(
    ACTIVITY_BARS_COLLAPSED_CAP +
      (ACTIVITY_BARS_EXPANDED_CAP - ACTIVITY_BARS_COLLAPSED_CAP) * progress,
  );
  return Math.min(length, cap, Math.max(target, progress > 0.5 ? 96 : 64));
}

type ActivityBarRect = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  hasValue: boolean;
  peakValue: number;
  isSpike?: boolean;
  sourceIndex: number;
  bucketStartIndex: number;
  bucketEndExclusive: number;
  observedCount: number;
  rangeLength: number;
  observedRatio: number;
  fullyObserved: boolean;
  peak: { index: number; value: number } | null;
};

function activityBarRects(
  values: Array<number | null>,
  timestamps: string[],
  max: number,
  rangeMin: number,
  zone: PlotZone,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
  density: { pxPerBar: number; minWidth: number; maxWidth: number },
  layout: ActivityPlotLayout,
  timeScale: ViewerTimestampScale,
  spikeThreshold = 0,
  detailProgress = 0,
  aggregation: "average" | "peak" = "average",
  bandBottomOverride?: number,
): ActivityBarRect[] {
  const n = values.length;
  if (n === 0) return [];
  const plotWidth = width - padLeft - padRight;
  const barSeries = chatBarsForChart(
    values,
    activityBarsMaxForLength(n, plotWidth, density.pxPerBar, detailProgress),
    aggregation,
  );
  const zoneBand = plotBandForZone(
    height,
    padTop,
    padBottom,
    zone,
    layout,
  );
  const bandBottom = bandBottomOverride ?? zoneBand.bandBottom;

  return barSeries.map((bar, barIdx) => {
    const {
      index,
      value,
      peakValue,
      hasValue,
      startIndex,
      endExclusive,
      observedCount,
      rangeLength,
      observedRatio,
      fullyObserved,
      peak,
    } = bar;
    const startX = timeScale.xForTimestamp(timestamps[startIndex] ?? "", startIndex, n);
    const exclusiveX = endExclusive < n
      ? timeScale.xForTimestamp(timestamps[endExclusive] ?? "", endExclusive, n)
      : timeScale.plotEndX;
    const intervalLeft = Math.min(startX, exclusiveX);
    const intervalRight = Math.max(startX, exclusiveX);
    const intervalWidth = Math.max(1, intervalRight - intervalLeft);
    // Chat and emotes share one visual cadence even though their disclosed
    // values differ (chat average vs emote peak). A consistent inset keeps the
    // lanes comparable and reveals substantially more time bins at overview.
    // Peak identity stays on `index` for hit-testing / selection.
    const widthPx = Math.max(
      density.minWidth,
      Math.min(density.maxWidth, intervalWidth * 0.82),
    );
    const x = intervalLeft + (intervalWidth - widthPx) / 2;
    const cy = plotY(
      value,
      max,
      height,
      padTop,
      padBottom,
      zone,
      rangeMin,
      layout,
    );
    const barHeight = value > 0 ? Math.max(1, bandBottom - cy) : 1;
    const y = value > 0 ? cy : bandBottom - 1;
    return {
      key: `bar-${index}-${barIdx}`,
      x,
      y,
      width: widthPx,
      height: barHeight,
      value,
      hasValue,
      peakValue,
      isSpike: spikeThreshold > 0 && value > spikeThreshold,
      sourceIndex: aggregation === "peak" ? index : (peak?.index ?? index),
      bucketStartIndex: startIndex,
      bucketEndExclusive: endExclusive,
      observedCount,
      rangeLength,
      observedRatio,
      fullyObserved,
      peak,
    };
  });
}

type ReactionBarRect = ReactionLaneGeometry;

type ChatRenderBar = {
  /** Interval center index used only for legacy slot placement fallback. */
  index: number;
  value: number;
  peakValue: number;
  hasValue: boolean;
  startIndex: number;
  endExclusive: number;
  observedCount: number;
  rangeLength: number;
  observedRatio: number;
  fullyObserved: boolean;
  peak: { index: number; value: number } | null;
};

function chatBarsForChart(
  values: Array<number | null>,
  maxBars = 360,
  aggregation: "average" | "peak" = "average",
): ChatRenderBar[] {
  const n = values.length;
  if (n === 0) return [];
  const buckets =
    composeRenderView({ chat: values }, maxBars).signals.chat ?? [];
  return buckets.map((bucket) => {
    const rangeLength = bucket.rangeLength > 0
      ? bucket.rangeLength
      : Math.max(1, bucket.endExclusive - bucket.startIndex);
    const peak = bucket.peak
      ? { index: bucket.peak.index, value: bucket.peak.value }
      : null;
    // Average bars keep peak as disclosed metadata only — never as X identity.
    const centerIndex = Math.floor((bucket.startIndex + bucket.endExclusive - 1) / 2);
    return {
      index:
        aggregation === "peak"
          ? (peak?.index ?? bucket.first?.index ?? bucket.startIndex)
          : centerIndex,
      value:
        aggregation === "peak"
          ? peak?.value ?? 0
          : bucket.average ?? peak?.value ?? 0,
      peakValue: peak?.value ?? 0,
      hasValue: bucket.count > 0,
      startIndex: bucket.startIndex,
      endExclusive: bucket.endExclusive,
      observedCount: bucket.count,
      rangeLength,
      observedRatio: bucket.observedRatio,
      fullyObserved: bucket.fullyObserved,
      peak,
    };
  });
}

function linePath(
  values: Array<number | null>,
  timestamps: string[],
  max: number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
  linear = false,
  zone: PlotZone = "viewer",
  rangeMin = 0,
  layout?: ActivityPlotLayout,
  timeScale?: ViewerTimestampScale,
) {
  const n = values.length;
  if (!n) return "";
  const resolvedLayout =
    layout ?? defaultActivityPlotLayout(height, padTop, padBottom);
  const { bandTop, bandBottom } = plotBandForZone(
    height,
    padTop,
    padBottom,
    zone,
    resolvedLayout,
  );

  const points: Array<{ x: number; y: number } | null> = values.map(
    (value, index) => {
      if (value === null) return null;
      const x = timeScale
        ? timeScale.xForTimestamp(timestamps[index] ?? "", index, n)
        : n === 1
          ? padLeft
          : padLeft + (index / (n - 1)) * (width - padLeft - padRight);
      const y = plotY(
        value,
        max,
        height,
        padTop,
        padBottom,
        zone,
        rangeMin,
        resolvedLayout,
      );
      return { x, y };
    },
  );

  let path = "";
  let segment: Array<{ x: number; y: number }> = [];

  const drawSegment = (
    seg: Array<{ x: number; y: number }>,
    linearSeg = false,
  ) => {
    if (seg.length === 0) return "";
    if (seg.length === 1)
      return `M${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
    if (seg.length === 2 || linearSeg) {
      let d = `M${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
      for (let i = 1; i < seg.length; i++) {
        d += ` L${seg[i].x.toFixed(1)} ${seg[i].y.toFixed(1)}`;
      }
      return d;
    }

    let d = `M${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;

    // Compute slopes at each point for smooth tangent matching
    const slopes: number[] = new Array(seg.length);
    for (let i = 0; i < seg.length; i++) {
      if (i === 0) {
        slopes[i] = (seg[1].y - seg[0].y) / (seg[1].x - seg[0].x);
      } else if (i === seg.length - 1) {
        slopes[i] = (seg[i].y - seg[i - 1].y) / (seg[i].x - seg[i - 1].x);
      } else {
        const dx1 = seg[i].x - seg[i - 1].x;
        const dy1 = seg[i].y - seg[i - 1].y;
        const dx2 = seg[i + 1].x - seg[i].x;
        const dy2 = seg[i + 1].y - seg[i].y;
        slopes[i] = (dy1 / dx1 + dy2 / dx2) / 2;
      }
    }

    for (let i = 0; i < seg.length - 1; i++) {
      const p1 = seg[i];
      const p2 = seg[i + 1];
      const dx = p2.x - p1.x;

      const cp1x = p1.x + dx * 0.35;
      const cp1y = Math.max(
        bandTop,
        Math.min(bandBottom, p1.y + slopes[i] * dx * 0.35),
      );
      const cp2x = p2.x - dx * 0.35;
      const cp2y = Math.max(
        bandTop,
        Math.min(bandBottom, p2.y - slopes[i + 1] * dx * 0.35),
      );

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt === null) {
      if (segment.length > 0) {
        path += (path ? " " : "") + drawSegment(segment, linear);
        segment = [];
      }
    } else {
      segment.push(pt);
    }
  }
  if (segment.length > 0) {
    path += (path ? " " : "") + drawSegment(segment, linear);
  }

  return path;
}

export function handleMultiSignalWheelEvent(args: {
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "preventDefault">
  viewport: ChartViewport
  durationSeconds: number
  anchorSeconds: number
  onViewportChange: (viewport: ChartViewport) => void
  domainStartSeconds?: number
}): boolean {
  const {
    event,
    viewport,
    durationSeconds,
    anchorSeconds,
    onViewportChange,
    domainStartSeconds = 0,
  } = args
  if (durationSeconds <= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false
  event.preventDefault()
  const next = wheelZoomChartViewport({
    viewport,
    durationSeconds,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    anchorSeconds,
    domainStartSeconds,
  })
  if (
    next.startSeconds !== viewport.startSeconds
    || next.endSeconds !== viewport.endSeconds
  ) {
    onViewportChange(next)
  }
  return true
}

function PulseMultiSignalChartInnerImpl({
  rollups: allRollups,
  detailRollups: detailRollupsProp,
  games = [],
  reactionPoints = [],
  streamStartedAt,
  chartStreamId = null,
  peakViewersFallback = 0,
  avgViewersFallback = 0,
  selectedEmotes = new Set<string>(),
  selectedRollup = null,
  previewRollup = null,
  selectedOffsetSeconds = null,
  previewOffsetSeconds = null,
  onSelectRollup,
  onSelectOffset,
  onSelectReactionMoment,
  onPreviewReactionMoment,
  syncing = false,
  isLive = false,
  showSpikes: showSpikesProp,
  onShowSpikesChange,
  activityExpanded: activityExpandedProp,
  onActivityExpandedChange,
  height: heightProp,
  playhead = null,
  variant = "compact",
  motionEnabled = true,
  chromeless = false,
  onHoverRollupChange,
  focusedSeriesKey: focusedSeriesKeyProp,
  onFocusedSeriesKeyChange,
  highlightedGameSegmentKey = null,
  durationSeconds = 0,
  viewport: viewportProp,
  onViewportChange,
  viewportMotionEnabled = true,
  viewportDomainStartSeconds = 0,
  layoutMode = "viewer-led",
  dragPanMode = "off",
  lineWeightMode = "fixed",
}: {
  rollups: ChartMinuteRollup[];
  /** Full-resolution viewer source used for idle/detail geometry and moment lookup. */
  detailRollups?: ChartMinuteRollup[];
  games?: ChartGameSegment[];
  /** Backend-authored exact reaction windows; used only for the visual intensity lane. */
  reactionPoints?: ChartReactionPoint[];
  streamStartedAt?: string;
  chartStreamId?: string | null;
  peakViewersFallback?: number;
  avgViewersFallback?: number;
  viewerSource?: string;
  selectedEmotes?: Set<string>;
  selectedRollup?: ChartMinuteRollup | null;
  previewRollup?: ChartMinuteRollup | null;
  /** Exact stream-relative anchor for a refined selected moment. */
  selectedOffsetSeconds?: number | null;
  /** Exact stream-relative anchor for a refined hover/preview moment. */
  previewOffsetSeconds?: number | null;
  onSelectRollup?: (rollup: ChartMinuteRollup | null) => void;
  /** Exact stream-relative pointer selection; rollup remains the metric source. */
  onSelectOffset?: (offsetSeconds: number) => void;
  onSelectReactionMoment?: (moment: ChartReactionPoint) => void;
  onPreviewReactionMoment?: (moment: ChartReactionPoint | null) => void;
  syncing?: boolean;
  isLive?: boolean;
  showSpikes?: boolean;
  onShowSpikesChange?: (value: boolean) => void;
  activityExpanded?: boolean;
  onActivityExpandedChange?: (value: boolean) => void;
  height?: number;
  playhead?: {
    streamId: string;
    offsetSeconds: number;
    isPlaying: boolean;
  } | null;
  variant?: "console" | "compact";
  motionEnabled?: boolean;
  chromeless?: boolean;
  onHoverRollupChange?: (rollup: ChartMinuteRollup | null) => void;
  focusedSeriesKey?: string | null;
  onFocusedSeriesKeyChange?: (key: string | null) => void;
  highlightedGameSegmentKey?: string | null;
  /** Prefer wall/offset span from the parent; avoids length*60 dropping late games. */
  durationSeconds?: number;
  /** Optional controlled wall-time viewport for portal shells with their own rail. */
  viewport?: ChartViewport | null;
  onViewportChange?: (viewport: ChartViewport) => void;
  /** Excludes unattested leading history from the full visual domain. */
  viewportDomainStartSeconds?: number;
  /** Portal can opt into equal viewer/chat/emote lanes without changing extension defaults. */
  layoutMode?: ChartLayoutMode;
  /** Optional graph-surface navigation. The extension keeps its existing gesture path. */
  dragPanMode?: ChartDragPanMode;
  /** Disable viewport easing while the parent rail is being dragged/resized. */
  viewportMotionEnabled?: boolean;
  /** Portal-only opt-in; shared/extension callers retain the fixed stroke contract. */
  lineWeightMode?: ChartLineWeightMode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const hoverIndexRef = useRef<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverClientRef = useRef<{
    clientX: number;
  } | null>(null);
  const interactionBoundsRef = useRef<DOMRect | null>(null);
  const chatTrendPrevRef = useRef<{ key: string; trend: PresentationTrend } | null>(null);
  const emoteTrendPrevRef = useRef<{ key: string; trend: PresentationTrend } | null>(null);
  const pointerRef = useRef<{
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    dragging: boolean;
    cancelled: boolean;
    gesture: "pending" | "scrub" | "pan" | "blocked-pan";
    startViewport: ChartViewport;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const lastRevealedSelectionRef = useRef<number | null>(null);
  const chartId = useId().replace(/:/g, "");
  const [announcement, setAnnouncement] = useState("");
  const activityExpandedControlled = activityExpandedProp !== undefined;
  const showSpikesControlled = showSpikesProp !== undefined;
  const [localActivityExpanded, setLocalActivityExpanded] = useState(false);
  // Same-page playhead sync (Req 22.1, 22.3): when a VOD player is mounted on
  // the same page for THIS stream and is actively playing, the chart shows a
  // playback cursor tracking the shared playhead. When no player is present,
  // the stream id does not match, or the player is inactive, sync is disabled
  // and the chart uses its standard hover cursor.
  const cursorSync = computeChartCursorSync({
    chartStreamId,
    playhead: playhead ?? { streamId: "", offsetSeconds: 0, isPlaying: false },
  });
  const [localShowSpikes, setLocalShowSpikes] = useState(false);
  const activityExpanded = activityExpandedProp ?? localActivityExpanded;
  const showSpikes = showSpikesProp ?? localShowSpikes;
  const [focusedSeriesKeyState, setFocusedSeriesKeyState] = useState<
    string | null
  >(null);
  const focusedSeriesKey = focusedSeriesKeyProp ?? focusedSeriesKeyState;
  const setFocusedSeriesKey = useCallback(
    (key: string | null) => {
      onFocusedSeriesKeyChange?.(key);
      if (focusedSeriesKeyProp === undefined) setFocusedSeriesKeyState(key);
    },
    [focusedSeriesKeyProp, onFocusedSeriesKeyChange],
  );
  const [hoveredSpikeKey, setHoveredSpikeKey] = useState<string | null>(null);
  // Expansion smoothly tweens between 0 and 1 so the line stroke widths and lane ratios
  // animate over ~250ms instead of snapping. Prefers-reduced-motion users snap to target.
  const [animatedExpandProgress, setAnimatedExpandProgress] = useState(
    activityExpanded ? 1 : 0,
  );
  useEffect(() => {
    const target = activityExpanded ? 1 : 0;
    if (motionEnabled === false) {
      setAnimatedExpandProgress(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const startValue = animatedExpandProgress;
    const duration = CHART_MOTION.expandMs;
    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedExpandProgress(startValue + (target - startValue) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    if (Math.abs(target - startValue) < 0.001) {
      setAnimatedExpandProgress(target);
    } else {
      raf = requestAnimationFrame(step);
    }
    return () => cancelAnimationFrame(raf);
    // animatedExpandProgress intentionally excluded — we want the tween to start from
    // the value at the moment the target changed, not retarget every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityExpanded, motionEnabled]);
  const expandProgress = animatedExpandProgress;

  // Per-emote draw-in placement is below `perEmoteSeries` declaration.
  // (Kept here as a placeholder so the surrounding code reads top-down.)
  const toggleShowSpikes = useCallback(() => {
    const next = !showSpikes;
    if (!showSpikesControlled) setLocalShowSpikes(next);
    onShowSpikesChange?.(next);
  }, [onShowSpikesChange, showSpikes, showSpikesControlled]);
  const toggleActivityExpanded = useCallback(() => {
    const next = !activityExpanded;
    if (!activityExpandedControlled) setLocalActivityExpanded(next);
    onActivityExpandedChange?.(next);
  }, [activityExpanded, activityExpandedControlled, onActivityExpandedChange]);
  useEffect(() => {
    hoverIndexRef.current = null;
    pointerRef.current = null;
    suppressClickRef.current = false;
    pendingHoverClientRef.current = null;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    setHover(null);
    setScrubbing(false);
    setHoveredSpikeKey(null);
    setAnnouncement("");
    lastRevealedSelectionRef.current = null;
    if (!showSpikesControlled) setLocalShowSpikes(false);
    if (!activityExpandedControlled) setLocalActivityExpanded(false);
    onHoverRollupChange?.(null);
    onFocusedSeriesKeyChange?.(null);
    if (focusedSeriesKeyProp === undefined) setFocusedSeriesKeyState(null);
  }, [chartStreamId]);
  const seriesFocusOpacity = useCallback(
    (seriesKey: string, base: number) => {
      if (!focusedSeriesKey) return base;
      if (focusedSeriesKey === "spikes") return base * 0.32;
      if (seriesKey === focusedSeriesKey) return base;

      const emoteFamily = seriesKey !== "viewers" && seriesKey !== "chat";
      if (focusedSeriesKey === "emotes" && emoteFamily) return base;

      return base * 0.14;
    },
    [focusedSeriesKey],
  );
  const fullRollups = allRollups;
  const inferredDurationSeconds = useMemo(() => {
    if (durationSeconds > 0) return durationSeconds;
    const offsets = fullRollups
      .map((point) => pointOffsetSeconds(point.minuteTs, streamStartedAt))
      .filter((offset): offset is number => offset != null);
    return offsets.length > 0 ? Math.max(...offsets) : 0;
  }, [durationSeconds, fullRollups, streamStartedAt]);
  const [localViewport, setLocalViewport] = useState<ChartViewport | null>(
    null,
  );
  const targetViewport = useMemo(() => {
    if (inferredDurationSeconds <= 0)
      return fullChartViewport(inferredDurationSeconds, viewportDomainStartSeconds);
    if (viewportProp)
      return normalizeChartViewport(
        viewportProp,
        inferredDurationSeconds,
        undefined,
        viewportDomainStartSeconds,
      );
    return localViewport
      ? normalizeChartViewport(
        localViewport,
        inferredDurationSeconds,
        undefined,
        viewportDomainStartSeconds,
      )
      : fullChartViewport(inferredDurationSeconds, viewportDomainStartSeconds);
  }, [
    inferredDurationSeconds,
    localViewport,
    viewportDomainStartSeconds,
    viewportProp,
  ]);
  const effectiveViewport = useSmoothedChartViewport(
    targetViewport,
    motionEnabled && viewportMotionEnabled,
  );
  const isZoomed =
    inferredDurationSeconds > 0 &&
    viewportDurationSeconds(effectiveViewport)
      < inferredDurationSeconds - viewportDomainStartSeconds - 1;
  const viewportFraction = inferredDurationSeconds > 0
    ? viewportDurationSeconds(effectiveViewport)
      / Math.max(1, inferredDurationSeconds - viewportDomainStartSeconds)
    : 1;
  const setViewport = useCallback(
    (next: ChartViewport) => {
      const normalized = normalizeChartViewport(
        next,
        inferredDurationSeconds,
        undefined,
        viewportDomainStartSeconds,
      );
      if (viewportProp === undefined) setLocalViewport(normalized);
      onViewportChange?.(normalized);
    },
    [
      inferredDurationSeconds,
      onViewportChange,
      viewportDomainStartSeconds,
      viewportProp,
    ],
  );
  useEffect(() => {
    if (!streamStartedAt) return;
    const resolved = resolveSelectionReveal({
      viewport: effectiveViewport,
      durationSeconds: inferredDurationSeconds,
      selectedOffsetSeconds: Number.isFinite(selectedOffsetSeconds)
        ? selectedOffsetSeconds
        : null,
      previewOffsetSeconds,
      lastRevealedOffsetSeconds: lastRevealedSelectionRef.current,
      domainStartSeconds: viewportDomainStartSeconds,
    });
    lastRevealedSelectionRef.current = resolved.revealedOffsetSeconds;
    if (
      resolved.viewport.startSeconds !== effectiveViewport.startSeconds
      || resolved.viewport.endSeconds !== effectiveViewport.endSeconds
    ) {
      setViewport(resolved.viewport);
    }
  }, [
    effectiveViewport,
    inferredDurationSeconds,
    previewOffsetSeconds,
    selectedOffsetSeconds,
    setViewport,
    streamStartedAt,
    viewportDomainStartSeconds,
  ]);
  const rollups = useMemo(() => {
    if (!isZoomed) return fullRollups;
    const start = effectiveViewport.startSeconds - 60;
    const end = effectiveViewport.endSeconds + 60;
    return fullRollups.filter((point) => {
      const offset = pointOffsetSeconds(point.minuteTs, streamStartedAt);
      return offset == null || (offset >= start && offset <= end);
    });
  }, [
    effectiveViewport.endSeconds,
    effectiveViewport.startSeconds,
    fullRollups,
    isZoomed,
    streamStartedAt,
  ]);
  const fullDetailRollups = detailRollupsProp?.length
    ? detailRollupsProp
    : fullRollups;
  const detailRollups = useMemo(() => {
    if (!isZoomed) return fullDetailRollups;
    const start = effectiveViewport.startSeconds - 60;
    const end = effectiveViewport.endSeconds + 60;
    return fullDetailRollups.filter((point) => {
      const offset = pointOffsetSeconds(point.minuteTs, streamStartedAt);
      return offset == null || (offset >= start && offset <= end);
    });
  }, [
    effectiveViewport.endSeconds,
    effectiveViewport.startSeconds,
    fullDetailRollups,
    isZoomed,
    streamStartedAt,
  ]);
  const commitHover = useCallback(
    (index: number | null) => {
      if (hoverIndexRef.current === index) return;
      hoverIndexRef.current = index;
      setHover(index);
      onHoverRollupChange?.(
        index != null && rollups[index] ? rollups[index]! : null,
      );
    },
    [onHoverRollupChange, rollups],
  );

  const hasSyncedChat = rollups.some(
    (point) => !point.missing && (point.chatCount ?? 0) > 0,
  );
  const viewerCoverage = useMemo(
    () => analyzeViewerCoverage(rollups),
    [rollups],
  );
  const hasViewerRollups = viewerCoverage.hasViewerRollups;
  const hasFlatViewerLine = viewerCoverage.hasFlatViewerLine;
  const useViewerFallback =
    !isLive &&
    !hasSyncedChat &&
    rollups.every((point) => point.missing || viewerValue(point) === 0);
  const needsViewerResync =
    !isLive &&
    hasSyncedChat &&
    (!hasViewerRollups ||
      hasFlatViewerLine ||
      viewerCoverage.hasPartialTail ||
      viewerCoverage.hasShortSpan);
  const hasChartData = useMemo(
    () => rollups.some(rollupHasMinuteData),
    [rollups],
  );
  const hasViewerChartData = useMemo(
    () =>
      rollupsHaveViewerData(rollups) || rollupsHaveViewerData(detailRollups),
    [detailRollups, rollups],
  );
  const canRenderChart = hasChartData || hasViewerChartData;
  const [measuredChartCssWidth, setMeasuredChartCssWidth] = useState(0);
  // The website console has a fixed-height inspection chart. Match its SVG
  // coordinate width to the rendered container so narrow layouts do not
  // letterbox a 1000x400 viewBox into a phone-sized 340x400 canvas. Compact
  // extension charts intentionally retain the established 1000-unit viewBox.
  const width = variant === "console" && measuredChartCssWidth > 0
    ? Math.max(1, Math.round(measuredChartCssWidth))
    : 1000;
  const baseHeight = heightProp ?? CHART_VIEWBOX_HEIGHT;
  // Expansion is an inspection mode: the chart earns additional vertical
  // space instead of only reallocating the same 400px between lanes. Because
  // this follows the existing rAF progress, the container grows smoothly.
  const height = baseHeight + Math.round(expandProgress * 120);
  const padLeft = width < 480 ? 58 : width < 720 ? 64 : 90;
  const padRight = width < 480 ? 18 : width < 720 ? 24 : 34;
  const padTop = 34;
  const padBottom = 34;
  const plotWidthPx = width - padLeft - padRight;
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const plotMeasureRef = useRef<SVGRectElement | null>(null);
  const [measuredPlotCssWidth, setMeasuredPlotCssWidth] = useState(0);
  useEffect(() => {
    const svg = chartSvgRef.current;
    if (!svg) return;

    const updateMeasurement = (observedWidth = 0) => {
      interactionBoundsRef.current = null;
      const svgCssWidth = observedWidth > 0
        ? observedWidth
        : svg.getBoundingClientRect().width || svg.clientWidth;
      if (variant === "console" && svgCssWidth > 0) {
        setMeasuredChartCssWidth((previous) =>
          Math.abs(previous - svgCssWidth) < 0.5 ? previous : svgCssWidth,
        );
      }
      const measuredPlotWidth =
        plotMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const expectedPlotRatio = plotWidthPx / width;
      const measuredPlotRatio = svgCssWidth > 0
        ? measuredPlotWidth / svgCssWidth
        : 0;
      // Some DOM implementations report an SVG child rect in viewBox units
      // even after the root SVG has a different rendered CSS width. Accept the
      // child measurement only when it has the same scale as the rendered SVG;
      // otherwise derive the CSS plot width from the root measurement.
      const plotMeasurementUsesCssPixels =
        measuredPlotWidth > 0
        && svgCssWidth > 0
        && Math.abs(measuredPlotRatio - expectedPlotRatio) < 0.02;
      const renderedWidth =
        plotMeasurementUsesCssPixels
          ? measuredPlotWidth
          : observedWidth > 0
            ? (observedWidth * plotWidthPx) / width
            : (svgCssWidth * plotWidthPx) / width;
      if (!(renderedWidth > 0)) return;
      const nextPlotWidth = renderedWidth;
      setMeasuredPlotCssWidth((previous) =>
        Math.abs(previous - nextPlotWidth) < 0.5 ? previous : nextPlotWidth,
      );
    };

    updateMeasurement();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) =>
            updateMeasurement(entries[0]?.contentRect.width ?? 0),
          )
        : null;
    observer?.observe(svg);
    const handleWindowResize = () => updateMeasurement();
    if (typeof window !== "undefined")
      window.addEventListener("resize", handleWindowResize, { passive: true });
    return () => {
      observer?.disconnect();
      if (typeof window !== "undefined")
        window.removeEventListener("resize", handleWindowResize);
    };
  }, [canRenderChart, plotWidthPx, variant, width]);
  const streamStartMs = streamStartedAt
    ? Date.parse(streamStartedAt)
    : Number.NaN;
  const timestampScale = useMemo(
    () =>
      buildViewerTimestampScale(
        [...rollups, ...detailRollups].map((point) => point.minuteTs),
        {
          width,
          padLeft,
          padRight,
          ...((isZoomed || viewportDomainStartSeconds > 0) && Number.isFinite(streamStartMs)
            ? {
                domainStartMs:
                  streamStartMs + effectiveViewport.startSeconds * 1000,
                domainEndMs:
                  streamStartMs + effectiveViewport.endSeconds * 1000,
              }
            : {}),
        },
      ),
    [
      detailRollups,
      effectiveViewport.endSeconds,
      effectiveViewport.startSeconds,
      isZoomed,
      padLeft,
      padRight,
      rollups,
      streamStartMs,
      viewportDomainStartSeconds,
      width,
    ],
  );

  const series = useMemo(
    () =>
      buildSeries(
        rollups,
        selectedEmotes,
        peakViewersFallback,
        avgViewersFallback,
        useViewerFallback,
      ),
    [
      rollups,
      selectedEmotes,
      peakViewersFallback,
      avgViewersFallback,
      useViewerFallback,
    ],
  );
  // Shared once per rollup change so downstream path/rect memos can hit equality on
  // minuteTs arrays instead of `.map()`-allocating a new array each render.
  const rollupMinuteTimestamps = useMemo(
    () => rollups.map((point) => point.minuteTs),
    [rollups],
  );
  const viewerSourceValues = useMemo(
    () => detailRollups.map(viewerObservedValue),
    [detailRollups],
  );
  const chatItem = useMemo(
    () => series.find((s) => s.key === "chat"),
    [series],
  );
  const emotesItem = useMemo(
    () => series.find((s) => s.key === "emotes"),
    [series],
  );
  const perEmoteSeries = useMemo(
    () => series.filter((s) => s.dashed),
    [series],
  );

  // Per-emote draw-in: when the set of plotted emote buckets changes (user clicks
  // a new emote in the overlay selector), tween each trace's opacity 0→1 over
  // 300ms so the lines fade in instead of snapping. Disabled under reduced motion.
  const plottedKeysSignature = perEmoteSeries.map((item) => item.key).join("|");
  const [emoteFadeInProgress, setEmoteFadeInProgress] = useState(1);
  useEffect(() => {
    if (motionEnabled === false) {
      setEmoteFadeInProgress(1);
      return;
    }
    if (perEmoteSeries.length === 0) {
      setEmoteFadeInProgress(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const duration = CHART_MOTION.emoteDrawMs;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setEmoteFadeInProgress(eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    setEmoteFadeInProgress(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [plottedKeysSignature, motionEnabled, perEmoteSeries.length]);
  const activityAxisSeries = useMemo(
    () => series.filter((s) => s.key !== "viewers" && s.key !== "chat"),
    [series],
  );
  const activityAxis = useMemo(
    () => activityAxisBounds(activityAxisSeries, true),
    [activityAxisSeries],
  );
  const activityScaleMax = activityAxis.max;
  const activityScaleMin = activityAxis.min;
  const selectedEmoteAxis = useMemo(
    () =>
      activityAxisBounds(perEmoteSeries, true, {
        includeAggregateEmotes: false,
      }),
    [perEmoteSeries],
  );
  const selectedEmoteScaleMax = selectedEmoteAxis.max;
  const selectedEmoteScaleMin = selectedEmoteAxis.min;
  // Per-emote traces always use their own scale — aggregate emote totals dwarf individual counts.
  const perEmotePlotAxis = selectedEmoteAxis;
  const activityLayout = useMemo(() => {
    if (layoutMode === "equal-signals") {
      return equalSignalsActivityLayout(height, padTop, padBottom);
    }
    return buildActivityPlotLayout(
      height,
      padTop,
      padBottom,
      // Keep lane ratios independent of plotted-series selection so plotting
      // never moves the viewer, chat, or emote baselines.
      lerpActivityLayout(expandProgress, false),
    );
  }, [height, padTop, padBottom, expandProgress, layoutMode]);
  const viewerBand = useMemo(
    () => plotBandForZone(height, padTop, padBottom, "viewer", activityLayout),
    [activityLayout, height, padTop, padBottom],
  );
  const activityLabelYs = useMemo(() => {
    const chatBand = plotBandForZone(
      height,
      padTop,
      padBottom,
      "activity-chat",
      activityLayout,
    );
    const traceBand = plotBandForZone(
      height,
      padTop,
      padBottom,
      "activity-emote-trace",
      activityLayout,
    );
    const emoteBand = plotBandForZone(
      height,
      padTop,
      padBottom,
      "activity-emote",
      activityLayout,
    );
    return {
      chat: (chatBand.bandTop + chatBand.bandBottom) / 2,
      trace: (traceBand.bandTop + traceBand.bandBottom) / 2,
      bars: (emoteBand.bandTop + emoteBand.bandBottom) / 2,
    };
  }, [activityLayout, height, padBottom, padTop]);
  const emoteBandMaxY = useMemo(
    () =>
      plotY(
        activityAxis.max,
        activityAxis.max,
        height,
        padTop,
        padBottom,
        "activity-emote",
        activityAxis.min,
        activityLayout,
      ),
    [activityAxis, activityLayout, height, padTop, padBottom],
  );
  const viewerAxis = useMemo(
    () => viewerScaleBounds(viewerSourceValues, peakViewersFallback, true),
    [peakViewersFallback, viewerSourceValues],
  );
  const viewerPeakAxis = useMemo(
    () => viewerScaleBounds(viewerSourceValues, peakViewersFallback, false),
    [peakViewersFallback, viewerSourceValues],
  );
  const scaleForSeries = useCallback(
    (item: ChartSeries) => {
      if (item.key === "viewers") {
        return viewerAxis.max;
      }
      if (item.key === "chat") {
        return Math.max(1, chatItem?.max ?? item.max);
      }
      return activityAxis.max;
    },
    [viewerAxis.max, chatItem, activityAxis.max],
  );
  const chatBandMaxY = useMemo(() => {
    if (!chatItem) return 0;
    const chatMax = Math.max(1, chatItem.max);
    return plotY(
      chatMax,
      chatMax,
      height,
      padTop,
      padBottom,
      "activity-chat",
      0,
      activityLayout,
    );
  }, [activityLayout, chatItem, height, padTop, padBottom]);
  const emotesDisplayValues = useMemo(
    () =>
      emotesItem
        ? smoothDisplayValues(emotesItem.values, expandProgress >= 0.5 ? 1 : 3)
        : [],
    [emotesItem, expandProgress],
  );
  const chatDisplayValues = useMemo(
    () =>
      chatItem
        ? smoothDisplayValues(chatItem.values, expandProgress >= 0.5 ? 1 : 3)
        : [],
    [chatItem, expandProgress],
  );
  const activityVisualBoost = 1 + expandProgress * 0.2;
  const primaryLineWidth = lineWeightMode === "viewport-adaptive"
    ? adaptiveChartLineWidth(expandProgress, viewportFraction)
    : chartLineWidth(expandProgress);
  const secondaryLineWidth = lineWeightMode === "viewport-adaptive"
    ? adaptiveChartLineWidth(expandProgress, viewportFraction, "secondary")
    : chartLineWidth(expandProgress, "secondary");
  const adaptiveStrokeStyle = lineWeightMode === "viewport-adaptive" && motionEnabled
    ? { transition: "stroke-width 140ms cubic-bezier(.16, 1, .3, 1)" }
    : undefined;
  const MARKER_GUTTER_PX = 8;
  const emoteBand = useMemo(
    () => plotBandForZone(height, padTop, padBottom, "activity-emote", activityLayout),
    [activityLayout, height, padBottom, padTop],
  );
  const selectedEmoteBand = useMemo(
    () => plotBandForZone(
      height,
      padTop,
      padBottom,
      "activity-emote-trace",
      activityLayout,
    ),
    [activityLayout, height, padBottom, padTop],
  );
  const emoteMagnitudeBottom = showSpikes
    ? emoteBand.bandBottom - MARKER_GUTTER_PX
    : emoteBand.bandBottom;
  const reactionGutterTop = emoteMagnitudeBottom;
  const reactionGutterBottom = emoteBand.bandBottom;
  const emoteBarRects = useMemo(() => {
    if (!emotesItem) return [];
    const spikeThreshold = activityAxis.max * 0.55;
    return activityBarRects(
      emotesItem.values,
      rollupMinuteTimestamps,
      activityAxis.max,
      activityAxis.min,
      "activity-emote",
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      { pxPerBar: 1.05, minWidth: 1, maxWidth: 10 },
      activityLayout,
      timestampScale,
      spikeThreshold,
      expandProgress,
      "peak",
      emoteMagnitudeBottom,
    );
  }, [
    activityAxis,
    activityLayout,
    emoteMagnitudeBottom,
    emotesItem,
    expandProgress,
    height,
    padBottom,
    padLeft,
    padRight,
    padTop,
    rollupMinuteTimestamps,
    timestampScale,
    width,
  ]);
  const reactionBarRectsForChart = useMemo(
    () => {
      if (!showSpikes) return [];
      const startMs = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN;
      return buildReactionLaneGeometry({
        moments: reactionPoints,
        plotLeft: timestampScale.plotStartX,
        plotWidth: timestampScale.plotWidth,
        bandTop: reactionGutterTop,
        bandBottom: reactionGutterBottom,
        xForOffset: (offset) => Number.isFinite(startMs)
          ? (() => {
              const targetMs = startMs + offset * 1000;
              const domainPaddingMs = 60_000;
              if (
                targetMs < timestampScale.firstTimestampMs - domainPaddingMs ||
                targetMs > timestampScale.lastTimestampMs + domainPaddingMs
              ) return null;
              return timestampScale.xForTimestampMs(targetMs);
            })()
          : null,
      });
    },
    [
      reactionGutterBottom,
      reactionGutterTop,
      reactionPoints,
      showSpikes,
      streamStartedAt,
      timestampScale,
    ],
  );
  const reactionPeakBar = useMemo(
    () =>
      reactionBarRectsForChart.reduce<ReactionBarRect | null>(
        (peak, bar) => (peak == null || bar.score > peak.score ? bar : peak),
        null,
      ),
    [reactionBarRectsForChart],
  );
  const presentationTrendKey = `${plotWidthPx}:${effectiveViewport.startSeconds}:${effectiveViewport.endSeconds}:${isZoomed ? 1 : 0}`;
  const emoteGuidePathD = useMemo(() => {
    if (!emotesItem) return "";
    const previous =
      emoteTrendPrevRef.current?.key === presentationTrendKey
        ? emoteTrendPrevRef.current.trend
        : undefined;
    const trend = buildPresentationTrend(emotesDisplayValues, {
      plotWidth: plotWidthPx,
      previousTrend: previous,
    });
    emoteTrendPrevRef.current = { key: presentationTrendKey, trend };
    const fallback = linePath(
      emotesDisplayValues,
      rollupMinuteTimestamps,
      activityAxis.max,
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      true,
      "activity-emote",
      activityAxis.min,
      activityLayout,
      timestampScale,
    );
    const xForIndex = (index: number) =>
      timestampScale.xForTimestamp(
        rollupMinuteTimestamps[
          Math.max(0, Math.min(rollupMinuteTimestamps.length - 1, Math.round(index)))
        ] ?? "",
        Math.max(0, Math.min(rollupMinuteTimestamps.length - 1, Math.round(index))),
        rollupMinuteTimestamps.length,
      );
    const path = presentationTrendPathD(trend, {
      xForIndex: (index) =>
        xForPresentationMidIndex(index, rollupMinuteTimestamps, xForIndex),
      yForValue: (value) =>
        plotY(
          value,
          activityAxis.max,
          height,
          padTop,
          padBottom,
          "activity-emote",
          activityAxis.min,
          activityLayout,
        ),
    });
    return path || fallback;
  }, [
    activityLayout,
    activityAxis,
    emotesDisplayValues,
    emotesItem,
    height,
    padBottom,
    padLeft,
    padRight,
    padTop,
    plotWidthPx,
    presentationTrendKey,
    rollupMinuteTimestamps,
    timestampScale,
    width,
  ]);
  const chatLinePathD = useMemo(() => {
    if (!chatItem) return "";
    const chatMax = scaleForSeries(chatItem);
    const previous =
      chatTrendPrevRef.current?.key === presentationTrendKey
        ? chatTrendPrevRef.current.trend
        : undefined;
    const trend = buildPresentationTrend(chatDisplayValues, {
      plotWidth: plotWidthPx,
      previousTrend: previous,
    });
    chatTrendPrevRef.current = { key: presentationTrendKey, trend };
    const fallback = linePath(
      chatDisplayValues,
      rollupMinuteTimestamps,
      chatMax,
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      true,
      "activity-chat",
      0,
      activityLayout,
      timestampScale,
    );
    const xForIndex = (index: number) =>
      timestampScale.xForTimestamp(
        rollupMinuteTimestamps[
          Math.max(0, Math.min(rollupMinuteTimestamps.length - 1, Math.round(index)))
        ] ?? "",
        Math.max(0, Math.min(rollupMinuteTimestamps.length - 1, Math.round(index))),
        rollupMinuteTimestamps.length,
      );
    const path = presentationTrendPathD(trend, {
      xForIndex: (index) =>
        xForPresentationMidIndex(index, rollupMinuteTimestamps, xForIndex),
      yForValue: (value) =>
        plotY(
          value,
          chatMax,
          height,
          padTop,
          padBottom,
          "activity-chat",
          0,
          activityLayout,
        ),
    });
    return path || fallback;
  }, [
    activityLayout,
    chatDisplayValues,
    chatItem,
    height,
    padBottom,
    padLeft,
    padRight,
    padTop,
    plotWidthPx,
    presentationTrendKey,
    rollupMinuteTimestamps,
    scaleForSeries,
    timestampScale,
    width,
  ]);
  const chatWhisperBarRects = useMemo(() => {
    if (!chatItem) return [];
    const chatMax = scaleForSeries(chatItem);
    return activityBarRects(
      chatItem.values,
      rollupMinuteTimestamps,
      chatMax,
      0,
      "activity-chat",
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      { pxPerBar: 1.05, minWidth: 1, maxWidth: 10 },
      activityLayout,
      timestampScale,
      0,
      expandProgress,
      "average",
    );
  }, [
    activityLayout,
    chatItem,
    expandProgress,
    height,
    padBottom,
    padLeft,
    padRight,
    padTop,
    rollupMinuteTimestamps,
    scaleForSeries,
    timestampScale,
    width,
  ]);
  const emoteSpikeIdxs = useMemo(() => {
    if (!showSpikes || !emotesItem) return [];
    return emoteSpikeIndices(emotesItem.values, 0.3, 28);
  }, [showSpikes, emotesItem]);
  // Note: spike surfaces are consolidated to a single dot layer. The pink bar
  // tint that used to fire on bar.isSpike was dropped because it stacked on top
  // of the same dot at the same X, reading as two separate spike markers. The
  // bar itself still grows taller — the line path above the bars shows the
  // same information. Chat bar tinting has always been purple (CHART_THEME.chat.color),
  // not pink, so its spike distinction is just bar height.
  const syncChatFrontierIdx = useMemo(() => {
    if (!syncing || !rollups.length) return -1;
    let last = -1;
    rollups.forEach((point, idx) => {
      if (!point.missing && (point.chatCount ?? 0) > 0) last = idx;
    });
    return last;
  }, [syncing, rollups]);
  const syncChatFrontierX = useMemo(() => {
    if (syncChatFrontierIdx < 0 || rollups.length === 0) return null;
    return timestampScale.xForTimestamp(
      rollups[syncChatFrontierIdx]?.minuteTs ?? "",
      syncChatFrontierIdx,
      rollups.length,
    );
  }, [rollups, syncChatFrontierIdx, timestampScale]);
  const syncOverlayBand = useMemo(() => {
    const viewerBand = plotBandForZone(
      height,
      padTop,
      padBottom,
      "viewer",
      activityLayout,
    );
    return {
      bandTop: viewerBand.activityTop,
      bandBottom: height - padBottom,
      bandHeight: viewerBand.activityHeight,
    };
  }, [activityLayout, height, padTop, padBottom]);
  const plottedEmoteKeys = useMemo(
    () => perEmoteSeries.map((item) => item.key),
    [perEmoteSeries],
  );
  const handleSpikeSelect = useCallback(
    (idx: number, event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      const rollup = rollups[idx];
      if (!rollup) return;
      if (selectedRollup?.minuteTs === rollup.minuteTs) {
        onSelectRollup?.(null);
        return;
      }
      onSelectRollup?.(rollup);
    },
    [rollups, onSelectRollup, selectedRollup],
  );
  const perEmoteOverlays = useMemo(
    () =>
      perEmoteSeries.map((item) => ({
        key: item.key,
        color: item.color,
        linePathD: linePath(
          item.values,
          rollupMinuteTimestamps,
          perEmotePlotAxis.max,
          width,
          height,
          padLeft,
          padRight,
          padTop,
          padBottom,
          true,
          "activity-emote-trace",
          perEmotePlotAxis.min,
          activityLayout,
          timestampScale,
        ),
      })),
    [
      activityLayout,
      height,
      padBottom,
      padLeft,
      padRight,
      padTop,
      perEmotePlotAxis,
      perEmoteSeries,
      rollupMinuteTimestamps,
      timestampScale,
      width,
    ],
  );
  // Keep the dense, static SVG children referentially stable while hover and
  // preview chrome move. React can then skip reconciling hundreds of bars on
  // every distinct bucket transition.
  const emoteBarElements = useMemo(
    () => emoteBarRects.map((bar) => (
      <rect
        key={bar.key}
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        rx={0}
        data-activity-bar="emotes"
        fill={CHART_THEME.emote.color}
        opacity={seriesFocusOpacity(
          "emotes",
          (bar.hasValue
            ? (bar.isSpike ? CHART_THEME.emote.barSpike : CHART_THEME.emote.bar)
            : CHART_THEME.emote.barBaseline) * activityVisualBoost,
        )}
      >
        <title>
          {`Emote peak ${count(emotesItem?.values[bar.sourceIndex] ?? 0)}/min at ${vodClock(rollupMinuteTimestamps[bar.sourceIndex], streamStartedAt)} · interval ${formatVodClock(Math.max(60, (bar.bucketEndExclusive - bar.bucketStartIndex) * 60))}`}
        </title>
      </rect>
    )),
    [
      activityVisualBoost,
      emoteBarRects,
      emotesItem,
      rollupMinuteTimestamps,
      seriesFocusOpacity,
      streamStartedAt,
    ],
  );
  const chatBarElements = useMemo(
    () => chatWhisperBarRects.map((bar) => (
      <rect
        key={bar.key}
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        rx={0}
        data-activity-bar="chat"
        data-observed-ratio={bar.observedRatio.toFixed(3)}
        data-range-length={bar.rangeLength}
        fill={CHART_THEME.chat.color}
        opacity={seriesFocusOpacity(
          "chat",
          (bar.hasValue
            ? CHART_THEME.chat.whisperBar
            : CHART_THEME.chat.whisperBar * 0.6)
          * (bar.fullyObserved ? 1 : Math.max(0.35, bar.observedRatio)),
        )}
      >
        <title>
          {`Chat average ${count(bar.value)}/min · peak ${count(bar.peakValue)}/min`
          + (bar.peak
            ? ` at ${vodClock(rollupMinuteTimestamps[bar.peak.index], streamStartedAt)}`
            : "")
          + ` · coverage ${bar.observedCount}/${bar.rangeLength}`
          + ` · interval ${formatVodClock(Math.max(60, bar.rangeLength * 60))}`}
        </title>
      </rect>
    )),
    [chatWhisperBarRects, rollupMinuteTimestamps, seriesFocusOpacity, streamStartedAt],
  );
  const perEmoteOverlayElements = useMemo(
    () => perEmoteOverlays.map((overlay) => (
      <g key={overlay.key}>
        {overlay.linePathD ? (
          <path
            d={overlay.linePathD}
            fill="none"
            stroke={overlay.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={secondaryLineWidth}
            style={adaptiveStrokeStyle}
            vectorEffect="non-scaling-stroke"
            className="sc-emote-plot-line"
            opacity={
              seriesFocusOpacity(
                overlay.key,
                0.95 * activityVisualBoost,
              ) * emoteFadeInProgress
            }
          />
        ) : null}
      </g>
    )),
    [
      activityVisualBoost,
      emoteFadeInProgress,
      adaptiveStrokeStyle,
      perEmoteOverlays,
      secondaryLineWidth,
      seriesFocusOpacity,
    ],
  );
  const viewerGeometry = useMemo(() => {
    if (!viewerSourceValues.some((value) => value !== null)) return null;
    const viewerTimed: ViewerTimedValue[] = detailRollups.map(
      (point, index) => ({
        minuteTs: point.minuteTs,
        value: viewerSourceValues[index] ?? null,
      }),
    );
    return buildViewerGeometry(viewerTimed, viewerTimed, {
      width,
      padLeft,
      padRight,
      bandTop: viewerBand.bandTop,
      bandBottom: viewerBand.bandBottom,
      valueToY: (value) =>
        plotY(
          value,
          viewerAxis.max,
          height,
          padTop,
          padBottom,
          "viewer",
          viewerAxis.min,
          activityLayout,
        ),
      plotCssWidth: measuredPlotCssWidth,
      timestampScale,
    });
  }, [
    activityLayout,
    detailRollups,
    height,
    padBottom,
    padLeft,
    padRight,
    padTop,
    measuredPlotCssWidth,
    timestampScale,
    viewerAxis,
    viewerBand,
    viewerSourceValues,
    width,
  ]);
  const hoveredViewerTimestamp =
    hover == null ? null : (rollups[hover]?.minuteTs ?? null);
  const viewerTargetTimestamp =
    hoveredViewerTimestamp ??
    previewRollup?.minuteTs ??
    selectedRollup?.minuteTs ??
    null;
  const viewerTargetOffsetSeconds = hoveredViewerTimestamp
    ? pointOffsetSeconds(hoveredViewerTimestamp, streamStartedAt)
    : Number.isFinite(previewOffsetSeconds)
      ? previewOffsetSeconds
      : Number.isFinite(selectedOffsetSeconds)
        ? selectedOffsetSeconds
        : selectedRollup
          ? pointOffsetSeconds(selectedRollup.minuteTs, streamStartedAt)
          : null;
  const hasChatData = useMemo(
    () =>
      rollups.some(
        (point) => (point.chatCount ?? 0) > 0 || minuteEmoteTotal(point) > 0,
      ),
    [rollups],
  );
  const gameBandHeight = 0;
  const gameBandTop = padTop + 1;
  const plotBottomApprox = height - 28;
  const gameDividerExtent = Math.max(80, plotBottomApprox - gameBandTop);
  // Offsets still normalize the Games played list; SVG markers use timestampScale below.
  const chartOffsets = useMemo(() => {
    const startMs = streamStartedAt ? Date.parse(streamStartedAt) : NaN;
    return rollups.map((rollup, index) => {
      const minuteMs = Date.parse(rollup.minuteTs);
      if (Number.isFinite(startMs) && Number.isFinite(minuteMs)) {
        return Math.max(0, Math.floor((minuteMs - startMs) / 1000));
      }
      return index * 60;
    });
  }, [rollups, streamStartedAt]);
  // Downsampled charts keep first/last minuteTs but shrink length — length*60 would
  // drop late segments (xqc Terraria / Slay the Spire) and kill hover highlight.
  const chartGames = useMemo(
    () =>
      normalizeGameSegments(
        games,
        gamesNormalizeDurationSeconds(
          chartOffsets,
          rollups.length,
          durationSeconds,
        ),
      ),
    [games, chartOffsets, rollups.length, durationSeconds],
  );
  const highlightedGameBounds = useMemo(() => {
    if (!highlightedGameSegmentKey) return null;
    const segment = chartGames.find(
      (game) => gameSegmentKey(game) === highlightedGameSegmentKey,
    );
    if (!segment) return null;
    return gameSegmentPlotBoundsByTimestampScale(
      segment,
      timestampScale,
      streamStartedAt,
    );
  }, [highlightedGameSegmentKey, chartGames, streamStartedAt, timestampScale]);

  const playheadTargetX = useMemo(() => {
    if (!cursorSync.synced || cursorSync.cursorOffsetSeconds === null) {
      return padLeft;
    }
    const startMs = streamStartedAt
      ? Date.parse(streamStartedAt)
      : timestampScale.firstTimestampMs;
    if (!Number.isFinite(startMs)) return padLeft;
    const targetMs = startMs + cursorSync.cursorOffsetSeconds * 1000;
    return timestampScale.xForTimestampMs(targetMs);
  }, [
    cursorSync.cursorOffsetSeconds,
    cursorSync.synced,
    padLeft,
    streamStartedAt,
    timestampScale,
  ]);
  // Scrub coordinates stay immediate; only the external player playhead may ease.
  const smoothPlayheadX = useSmoothedScalar(
    playheadTargetX,
    motionEnabled && cursorSync.synced,
    { settleMs: CHART_MOTION.selectionSettleMs },
  );
  const displayPlayheadX =
    motionEnabled && cursorSync.synced ? smoothPlayheadX : playheadTargetX;

  const viewerValues = viewerSourceValues.filter(
    (value): value is number => value !== null && value > 0,
  );
  const avgViewers =
    viewerValues.length > 0
      ? Math.round(
          viewerValues.reduce((a, b) => a + b, 0) / viewerValues.length,
        )
      : avgViewersFallback;
  const activeViewerAxis = viewerSourceValues.some((value) => value !== null)
    ? viewerAxis
    : viewerPeakAxis;
  const viewerScale = activeViewerAxis.max;
  const viewerScaleMin = activeViewerAxis.min;
  const viewerScaleSpan = Math.max(1, viewerScale - viewerScaleMin);
  const yMax = padTop;
  const yAvg =
    viewerBand.bandBottom -
    ((avgViewers - viewerScaleMin) / viewerScaleSpan) * viewerBand.bandHeight;
  const showAvgLabel = yAvg - yMax > 22 && viewerBand.bandBottom - yAvg > 22;
  const hoverPoint =
    hover != null
      ? (rollups[hover] ??
        previewRollup ??
        selectedRollup ??
        rollups[rollups.length - 1])
      : (previewRollup ?? selectedRollup ?? rollups[rollups.length - 1]);
  const hoverReactionScore = useMemo(() => {
    if (!hoverPoint || reactionPoints.length === 0) return null;
    const offset = pointOffsetSeconds(hoverPoint.minuteTs, streamStartedAt);
    if (offset == null) return null;
    let best: number | null = null;
    for (const point of reactionPoints) {
      const start = Number(point.offsetSeconds);
      const end = start + Number(point.durationSeconds ?? 60);
      const score = Number(point.reactionScore ?? point.score ?? 0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(score)) continue;
      if (offset >= start && offset <= end && (best == null || score > best)) best = score;
    }
    return best;
  }, [hoverPoint, reactionPoints, streamStartedAt]);
  const viewerInspecting =
    !cursorSync.synced &&
    (viewerTargetTimestamp !== null || viewerTargetOffsetSeconds != null);
  const viewerCursorX =
    viewerTargetOffsetSeconds != null && streamStartedAt
      ? (() => {
          const startMs = Date.parse(streamStartedAt);
          return Number.isFinite(startMs)
            ? timestampScale.xForTimestampMs(
                startMs + viewerTargetOffsetSeconds * 1000,
              )
            : timestampScale.plotStartX;
        })()
      : viewerTargetTimestamp
        ? timestampScale.xForTimestamp(viewerTargetTimestamp)
        : timestampScale.plotStartX;
  const selectedMarkerX = useMemo(() => {
    const offset = Number.isFinite(selectedOffsetSeconds)
      ? selectedOffsetSeconds
        : selectedRollup
          ? pointOffsetSeconds(selectedRollup.minuteTs, streamStartedAt)
          : null;
    if (!Number.isFinite(offset) && !selectedRollup) return null;
    if (Number.isFinite(offset)
      && (offset! < effectiveViewport.startSeconds || offset! > effectiveViewport.endSeconds)) {
      return null;
    }
    if (Number.isFinite(offset) && streamStartedAt) {
      const startMs = Date.parse(streamStartedAt);
      if (Number.isFinite(startMs)) return timestampScale.xForTimestampMs(startMs + offset! * 1000);
    }
    return selectedRollup ? timestampScale.xForTimestamp(selectedRollup.minuteTs) : null;
  }, [effectiveViewport, selectedOffsetSeconds, selectedRollup, streamStartedAt, timestampScale]);
  const previewMarkerOffsetSeconds = typeof previewOffsetSeconds === "number"
    && Number.isFinite(previewOffsetSeconds)
    ? previewOffsetSeconds
    : previewRollup
      ? pointOffsetSeconds(previewRollup.minuteTs, streamStartedAt)
      : null;
  const previewMarkerX = useMemo(() => {
    const offset = previewMarkerOffsetSeconds;
    if (!Number.isFinite(offset) && !previewRollup) return null;
    if (Number.isFinite(offset)
      && (offset! < effectiveViewport.startSeconds || offset! > effectiveViewport.endSeconds)) {
      return null;
    }
    if (Number.isFinite(offset) && streamStartedAt) {
      const startMs = Date.parse(streamStartedAt);
      if (Number.isFinite(startMs)) return timestampScale.xForTimestampMs(startMs + offset! * 1000);
    }
    return previewRollup ? timestampScale.xForTimestamp(previewRollup.minuteTs) : null;
  }, [effectiveViewport, previewMarkerOffsetSeconds, previewRollup, streamStartedAt, timestampScale]);
  const selectedSourceIndex = selectedRollup
    ? rollups.findIndex((rollup) => rollup.minuteTs === selectedRollup.minuteTs)
    : -1;
  const xForBandIndex = (index: number) =>
    timestampScale.xForTimestamp(
      rollupMinuteTimestamps[
        Math.max(0, Math.min(rollupMinuteTimestamps.length - 1, index))
      ] ?? "",
      Math.max(0, Math.min(rollupMinuteTimestamps.length - 1, index)),
      rollupMinuteTimestamps.length,
    );
  const bandForIndex = (index: number | null) => {
    if (index == null || index < 0) return null;
    return (
      hoverBandFromBars(emoteBarRects, index)
      ?? hoverBandFromBars(chatWhisperBarRects, index)
      ?? intervalBandFromTimestamps({
        startIndex: index,
        endExclusive: index + 1,
        timestamps: rollupMinuteTimestamps,
        xForIndex: xForBandIndex,
      })
    );
  };
  const pinBand = selectedMarkerX == null
    ? null
    : bandForIndex(selectedSourceIndex >= 0 ? selectedSourceIndex : null);
  const hoverBand = bandForIndex(hover);
  const hoverLineX =
    hover != null && rollups[hover]
      ? timestampScale.xForTimestamp(
          rollups[hover]!.minuteTs,
          hover,
          rollups.length,
        )
      : null;
  const chromeTimeOffset =
    hover != null
      ? pointOffsetSeconds(rollups[hover]?.minuteTs ?? "", streamStartedAt)
      : Number.isFinite(selectedOffsetSeconds)
        ? selectedOffsetSeconds
        : selectedRollup
          ? pointOffsetSeconds(selectedRollup.minuteTs, streamStartedAt)
          : null;
  const chromeTimeChipValue =
    chromeTimeOffset != null ? formatChartMinuteChip(chromeTimeOffset) : null;
  const chromeTimeChipLabel = chromeTimeChipValue == null
    ? null
    : hover != null
      ? chromeTimeChipValue
      : `Selected ${chromeTimeChipValue}`;
  const chromeTimeChipWidth = chromeTimeChipLabel
    ? estimateTimeChipWidth(chromeTimeChipLabel)
    : 28;
  const previewTimeChipLabel =
    previewMarkerX != null
    && previewMarkerX !== selectedMarkerX
    && previewMarkerOffsetSeconds != null
      ? `Preview ${formatChartMinuteChip(previewMarkerOffsetSeconds)}`
      : null;
  const previewTimeChipWidth = previewTimeChipLabel
    ? estimateTimeChipWidth(previewTimeChipLabel)
    : 28;
  const viewerLineOpacity = seriesFocusOpacity(
    "viewers",
    CHART_THEME.viewer.line,
  );
  const viewerAreaOpacity = seriesFocusOpacity(
    "viewers",
    layoutMode === "equal-signals" ? 0.46 : 0.72,
  );
  const futureOpacity = Math.max(
    0.22,
    Math.min(0.38, viewerLineOpacity * 0.42),
  );
  // Hover/pin is a visual inspection split: keep measured history present but
  // quieter after the active bucket. This is not a missing-data treatment.
  const afterCursorOpacity = futureOpacity;
  // Live-edge X for future-fade: the X coordinate of "now" so the idle viewer
  // line is muted past the live edge when the user isn't hovering. For ended
  // streams we never fade (the line is historical).
  const liveEdgeX = useMemo(() => {
    if (!isLive) return null;
    const startMs = streamStartedAt ? Date.parse(streamStartedAt) : NaN;
    if (!Number.isFinite(startMs)) return null;
    const nowMs = Date.now();
    if (nowMs <= startMs) return null;
    return timestampScale.xForTimestampMs(nowMs);
  }, [isLive, streamStartedAt, timestampScale]);
  // Match the extension inspection contract: hover/pin keeps the past fully
  // legible and gently fades the later portion across every activity lane.
  const activityPlotWidth = Math.max(0, width - padRight - padLeft);
  const activityFadeEnabled = viewerInspecting;
  // When not actively inspecting the viewer cursor, render the mask as fully white
  // (full visibility) so any accidental application is a no-op. When inspecting,
  // shift the white-to-black seam to a 10px feather straddling the cursor.
  const activitySeamPx =
    activityPlotWidth > 0
      ? (10 / Math.max(1, measuredPlotCssWidth || activityPlotWidth)) *
        activityPlotWidth
      : 0;
  const activityFadeStartX = activityFadeEnabled
    ? Math.max(
        padLeft,
        Math.min(width - padRight, viewerCursorX - activitySeamPx / 2),
      )
    : padLeft;
  const activityFadeEndX = activityFadeEnabled
    ? Math.max(
        padLeft,
        Math.min(width - padRight, viewerCursorX + activitySeamPx / 2),
      )
    : padLeft;
  const activityFadeStartPercent =
    activityPlotWidth > 0
      ? ((activityFadeStartX - padLeft) / activityPlotWidth) * 100
      : 0;
  const activityFadeEndPercent = activityFadeEnabled
    ? activityPlotWidth > 0
      ? ((activityFadeEndX - padLeft) / activityPlotWidth) * 100
      : 0
    : 100;
  const maskStartPercent = activityFadeEnabled
    ? `${activityFadeStartPercent}%`
    : "0%";
  const maskEndPercent = activityFadeEnabled
    ? `${activityFadeEndPercent}%`
    : "0%";

  const hoverHitRegions = useMemo(
    () => buildChartHitRegions(rollups.map((point, index) => ({
      index,
      centerX: timestampScale.xForTimestamp(point.minuteTs, index, rollups.length),
      selectable: !point.missing,
    }))),
    [rollups, timestampScale],
  );

  function cacheInteractionBounds(target: SVGRectElement) {
    interactionBoundsRef.current = target.getBoundingClientRect();
  }

  function updateHoverFromClientX(clientX: number) {
    if (rollups.length === 0) return;
    const rect = interactionBoundsRef.current;
    if (!rect) return;
    if (rect.width <= 0) return;
    const clientXRelative = clientX - rect.left;
    const pct = Math.min(1, Math.max(0, clientXRelative / rect.width));
    const plotX = timestampScale.plotStartX + pct * timestampScale.plotWidth;
    const region = chartHitRegionAtX(hoverHitRegions, plotX);
    commitHover(region?.index ?? null);
  }

  function scheduleHoverFromClientX(
    clientX: number,
    target: SVGRectElement,
    flushNow = false,
  ) {
    if (!interactionBoundsRef.current) cacheInteractionBounds(target);
    pendingHoverClientRef.current = { clientX };
    const flush = () => {
      hoverRafRef.current = null;
      const pending = pendingHoverClientRef.current;
      if (!pending) return;
      updateHoverFromClientX(pending.clientX);
    };
    if (flushNow) {
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      flush();
      return;
    }
    if (hoverRafRef.current != null) return;
    hoverRafRef.current = requestAnimationFrame(flush);
  }

  /** Map a pointer to an authored reaction only inside the Markers gutter. */
  function reactionMomentAtClientPoint(
    clientX: number,
    clientY: number,
    target: SVGRectElement,
  ): ChartReactionPoint | null {
    if (reactionBarRectsForChart.length === 0) return null;
    if (!interactionBoundsRef.current) cacheInteractionBounds(target);
    const rect = interactionBoundsRef.current;
    if (!rect) return null;
    if (rect.width <= 0 || rect.height <= 0) return null;
    const xProgress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const yProgress = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const plotX = timestampScale.plotStartX + xProgress * timestampScale.plotWidth;
    const plotYValue = padTop + yProgress * (height - padTop - padBottom);
    if (plotYValue < reactionGutterTop || plotYValue > reactionGutterBottom) return null;
    const hit = findReactionMomentAtPlotX(reactionBarRectsForChart, plotX, 10);
    return hit?.moment ?? null;
  }

  function activityBarAtPlotX(
    bars: readonly ActivityBarRect[],
    plotX: number,
  ): ActivityBarRect | null {
    let best: ActivityBarRect | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const bar of bars) {
      if (!bar.hasValue) continue;
      if (plotX >= bar.x && plotX <= bar.x + bar.width) return bar;
      const center = bar.x + bar.width / 2;
      const dist = Math.abs(center - plotX);
      if (dist < bestDist) {
        bestDist = dist;
        best = bar;
      }
    }
    return bestDist <= Math.max(8, (best?.width ?? 0) / 2 + 4) ? best : null;
  }

  function resolveMultiSignalPointerSelection(
    clientX: number,
    clientY: number,
    target: SVGRectElement,
  ): ChartSelection {
    if (!interactionBoundsRef.current) cacheInteractionBounds(target);
    const rect = interactionBoundsRef.current;
    if (!rect) return { kind: "none" };
    if (rect.width <= 0 || rect.height <= 0) return { kind: "none" };
    const xProgress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const yProgress = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const plotX = timestampScale.plotStartX + xProgress * timestampScale.plotWidth;
    const plotYValue = padTop + yProgress * (height - padTop - padBottom);

    const reaction = reactionMomentAtClientPoint(clientX, clientY, target);
    if (reaction) {
      return {
        kind: "reaction",
        moment: reaction as ChartReactionPoint & Record<string, unknown>,
        analyticalOffsetSeconds: reactionAnalyticalOffset(reaction),
      };
    }

    if (plotYValue >= emoteBand.bandTop && plotYValue <= emoteMagnitudeBottom) {
      const emote = activityBarAtPlotX(emoteBarRects, plotX);
      if (emote?.peak || emote) {
        const sourceIndex = emote.peak?.index ?? emote.sourceIndex;
        const offset = pointOffsetSeconds(
          rollups[sourceIndex]?.minuteTs ?? "",
          streamStartedAt,
        ) ?? sourceIndex * 60;
        return {
          kind: "emote_peak",
          sourceIndex,
          offsetSeconds: offset,
          value: emote.peak?.value ?? emote.value,
        };
      }
    }

    const chatBand = plotBandForZone(height, padTop, padBottom, "activity-chat", activityLayout);
    if (plotYValue >= chatBand.bandTop && plotYValue <= chatBand.bandBottom) {
      const chat = activityBarAtPlotX(chatWhisperBarRects, plotX);
      if (chat) {
        return chatIntervalSelectionFromActivityBar({
          startIndex: chat.bucketStartIndex,
          endExclusive: chat.bucketEndExclusive,
          average: chat.value,
          peak: chat.peak,
          observedCount: chat.observedCount,
          rangeLength: chat.rangeLength,
          offsetForIndex: (index) =>
            pointOffsetSeconds(rollups[index]?.minuteTs ?? "", streamStartedAt)
            ?? index * 60,
        });
      }
    }

    let canonicalIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < rollups.length; index++) {
      const pointX = timestampScale.xForTimestamp(
        rollups[index]!.minuteTs,
        index,
        rollups.length,
      );
      const distance = Math.abs(pointX - plotX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        canonicalIndex = index;
      }
    }
    const snapped = pointOffsetSeconds(
      rollups[canonicalIndex]?.minuteTs ?? "",
      streamStartedAt,
    ) ?? canonicalIndex * 60;
    return {
      kind: "chart_minute",
      canonicalIndex,
      offsetSeconds: snapped,
    };
  }

  function clearHoverPreview() {
    pointerRef.current = null;
    pendingHoverClientRef.current = null;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    hoverIndexRef.current = null;
    setHover(null);
    onHoverRollupChange?.(null);
    onPreviewReactionMoment?.(null);
  }

  function toggleRollupSelection(index: number) {
    const rollup = rollups[index];
    if (!rollup) return;
    if (selectedRollup?.minuteTs === rollup.minuteTs) {
      onSelectRollup?.(null);
      clearHoverPreview();
      setAnnouncement(
        `Selection cleared at ${vodClock(rollup.minuteTs, streamStartedAt)}.`,
      );
      return;
    }
    onSelectRollup?.(rollup);
    setAnnouncement(`Selected ${vodClock(rollup.minuteTs, streamStartedAt)}.`);
  }

  function viewportAnchorFromClientX(
    clientX: number,
    target: Element,
  ): number {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return viewportCenterSeconds(effectiveViewport);
    const progress = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width),
    );
    return (
      effectiveViewport.startSeconds +
      progress * viewportDurationSeconds(effectiveViewport)
    );
  }

  function zoomViewportByFactor(factor: number, anchorSeconds?: number) {
    if (inferredDurationSeconds <= 0) return;
    setViewport(
      zoomChartViewport({
        viewport: effectiveViewport,
        durationSeconds: inferredDurationSeconds,
        zoomSeconds: viewportDurationSeconds(effectiveViewport) * factor,
        anchorSeconds,
        domainStartSeconds: viewportDomainStartSeconds,
      }),
    );
  }

  function resetViewport() {
    setViewport(fullChartViewport(inferredDurationSeconds, viewportDomainStartSeconds));
  }

  const presetAnchorSeconds = Number.isFinite(selectedOffsetSeconds)
    ? selectedOffsetSeconds!
    : selectedRollup && streamStartedAt
      ? (pointOffsetSeconds(selectedRollup.minuteTs, streamStartedAt)
        ?? (isLive
          ? inferredDurationSeconds
          : viewportCenterSeconds(effectiveViewport)))
      : isLive
        ? inferredDurationSeconds
        : viewportCenterSeconds(effectiveViewport);

  const handleChartWheel = useCallback((event: WheelEvent) => {
    const anchorTarget = plotMeasureRef.current ?? chartSvgRef.current;
    if (!anchorTarget) return;
    handleMultiSignalWheelEvent({
      event,
      viewport: effectiveViewport,
      durationSeconds: inferredDurationSeconds,
      anchorSeconds: viewportAnchorFromClientX(event.clientX, anchorTarget),
      onViewportChange: setViewport,
      domainStartSeconds: viewportDomainStartSeconds,
    });
  }, [
    effectiveViewport,
    inferredDurationSeconds,
    setViewport,
    viewportDomainStartSeconds,
  ]);

  useEffect(() => {
    const node = chartSvgRef.current;
    if (!node) return;
    node.addEventListener("wheel", handleChartWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleChartWheel);
  }, [handleChartWheel]);

  // Keep this empty-state return after every hook in the component. The chart
  // can legitimately transition between an empty live frame and a populated
  // minute payload, so returning before later hooks breaks React's hook order.
  if (!canRenderChart) {
    return (
      <div
        className="pulse-chart-empty"
        style={{
          minHeight: heightProp ?? 200,
          display: "grid",
          placeItems: "center",
          color: "#71717a",
          fontSize: 12,
          padding: 12,
          textAlign: "center",
        }}
      >
        Chart minutes not available yet.
      </div>
    );
  }

  function handleChartKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (
      (event.key === "+" ||
        event.key === "=" ||
        event.key === "-" ||
        event.key === "_" ||
        event.key === "0") &&
      inferredDurationSeconds > 0
    ) {
      event.preventDefault();
      if (event.key === "0") resetViewport();
      else
        zoomViewportByFactor(
          event.key === "+" || event.key === "=" ? 0.75 : 1.333333,
        );
      return;
    }
    if (!onSelectRollup || rollups.length === 0) return;
    const selectedIndex = selectedRollup
      ? rollups.findIndex(
          (rollup) => rollup.minuteTs === selectedRollup.minuteTs,
        )
      : -1;
    const currentIndex = hover ?? (selectedIndex >= 0 ? selectedIndex : 0);
    const step = event.shiftKey ? 5 : 1;
    let nextIndex: number | null = null;

    switch (event.key) {
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = rollups.length - 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        if (event.altKey && isZoomed) {
          event.preventDefault();
          setViewport(
            panChartViewport(
              effectiveViewport,
              -viewportDurationSeconds(effectiveViewport) * 0.25,
              inferredDurationSeconds,
              undefined,
              viewportDomainStartSeconds,
            ),
          );
          return;
        }
        nextIndex = Math.max(0, currentIndex - step);
        break;
      case "ArrowRight":
      case "ArrowDown":
        if (event.altKey && isZoomed) {
          event.preventDefault();
          setViewport(
            panChartViewport(
              effectiveViewport,
              viewportDurationSeconds(effectiveViewport) * 0.25,
              inferredDurationSeconds,
              undefined,
              viewportDomainStartSeconds,
            ),
          );
          return;
        }
        nextIndex = Math.min(rollups.length - 1, currentIndex + step);
        break;
      case "Escape":
        event.preventDefault();
        clearHoverPreview();
        onSelectRollup(null);
        setAnnouncement("Selection cleared.");
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        toggleRollupSelection(currentIndex);
        return;
      default:
        return;
    }

    event.preventDefault();
    commitHover(nextIndex);
    const rollup = rollups[nextIndex];
    if (rollup)
      setAnnouncement(
        `Previewing ${vodClock(rollup.minuteTs, streamStartedAt)}.`,
      );
  }

  function handlePlotPointerDown(event: ReactPointerEvent<SVGRectElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    suppressClickRef.current = false;
    setScrubbing(false);
    pointerRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      cancelled: false,
      gesture: "pending",
      startViewport: effectiveViewport,
    };
    onPreviewReactionMoment?.(
      reactionMomentAtClientPoint(event.clientX, event.clientY, event.currentTarget),
    );
    scheduleHoverFromClientX(event.clientX, event.currentTarget, true);
  }

  function handlePlotPointerMove(event: ReactPointerEvent<SVGRectElement>) {
    const pointer = pointerRef.current;
    if (
      !pointer ||
      (pointer.pointerId !== event.pointerId && event.pointerId !== 0) ||
      pointer.cancelled
    )
      return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.dragging) {
      if (Math.abs(dy) >= CHART_DRAG_INTENT_PX && Math.abs(dy) > Math.abs(dx)) {
        pointer.cancelled = true;
        suppressClickRef.current = true;
        pointerRef.current = null;
        clearHoverPreview();
        return;
      }
      if (Math.abs(dx) >= CHART_DRAG_INTENT_PX && Math.abs(dx) > Math.abs(dy)) {
        pointer.dragging = true;
        if (dragPanMode === "zoomed") {
          pointer.gesture = isZoomed ? "pan" : "blocked-pan";
          setScrubbing(false);
          clearHoverPreview();
          // clearHoverPreview deliberately drops pointerRef; restore the active
          // gesture so pointer capture can continue until release.
          pointerRef.current = pointer;
        } else {
          pointer.gesture = "scrub";
          setScrubbing(true);
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is unavailable in some embedded/test browsers.
        }
      }
    }
    if (pointer.gesture === "pan") {
      event.preventDefault();
      if (!interactionBoundsRef.current) cacheInteractionBounds(event.currentTarget);
      const rect = interactionBoundsRef.current;
      if (rect && rect.width > 0) {
        setViewport(dragPanChartViewport({
          viewport: pointer.startViewport,
          durationSeconds: inferredDurationSeconds,
          deltaPixels: dx,
          plotWidthPixels: rect.width,
          domainStartSeconds: viewportDomainStartSeconds,
        }));
      }
      return;
    }
    if (pointer.gesture === "blocked-pan") {
      event.preventDefault();
      return;
    }
    if (pointer.dragging || pointer.pointerType === "mouse") {
      event.preventDefault();
      onPreviewReactionMoment?.(
        reactionMomentAtClientPoint(event.clientX, event.clientY, event.currentTarget),
      );
      scheduleHoverFromClientX(event.clientX, event.currentTarget);
    }
  }

  function handlePlotPointerUp(event: ReactPointerEvent<SVGRectElement>) {
    const pointer = pointerRef.current;
    if (
      !pointer ||
      (pointer.pointerId !== event.pointerId && event.pointerId !== 0)
    )
      return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    if (pointer.dragging && pointer.gesture === "scrub") {
      suppressClickRef.current = true;
      const reaction = reactionMomentAtClientPoint(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      if (reaction) {
        onSelectReactionMoment?.(reaction);
        setAnnouncement(
          `Selected reaction at ${formatVodClock(reactionAnalyticalOffset(reaction))}.`,
        );
      }
      if (!interactionBoundsRef.current) cacheInteractionBounds(event.currentTarget);
      updateHoverFromClientX(event.clientX);
      const finalIndex = hoverIndexRef.current ?? hover ?? 0;
      if (!reaction) toggleRollupSelection(finalIndex);
    } else if (pointer.dragging) {
      // A pan (including a full-range blocked pan) consumes the gesture but
      // never mutates the committed bucket.
      suppressClickRef.current = true;
    }
    setScrubbing(false);
    pointerRef.current = null;
  }

  function handlePlotPointerCancel(event: ReactPointerEvent<SVGRectElement>) {
    const pointer = pointerRef.current;
    suppressClickRef.current = true;
    setScrubbing(false);
    clearHoverPreview();
  }

  function handlePlotMouseLeave() {
    if (pointerRef.current?.dragging) return;
    clearHoverPreview();
  }

  const chartBody = (
    <div
      className="relative overflow-hidden rounded"
      data-chart-layout-mode={layoutMode}
      data-focused-series={focusedSeriesKey ?? "overview"}
      data-activity-expanded={activityExpanded ? "true" : "false"}
      data-activity-zone-fraction={activityLayout.zoneFraction.toFixed(3)}
      data-activity-zone-height={activityLayout.activityHeight.toFixed(2)}
      data-viewer-lane-height={viewerBand.bandHeight.toFixed(2)}
      data-chat-lane-height={(activityLayout.activityHeight * activityLayout.chat).toFixed(2)}
      data-emote-lane-height={(activityLayout.activityHeight * activityLayout.bars).toFixed(2)}
      data-plotted-emote-lane-height={selectedEmoteBand.bandHeight.toFixed(2)}
      data-plotted-emote-lane-position={activityLayout.tracePlacement}
      data-spikes-visible={showSpikes ? "true" : "false"}
      data-chart-pan-state={pointerRef.current?.gesture === "pan" ? "panning" : "idle"}
    >
      {variant === "console" && inferredDurationSeconds >= 10 * 60 ? (
        <div
          className="pointer-events-auto absolute right-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-1 rounded border border-white/10 bg-zinc-950/80 p-1 text-[9px] font-black uppercase tracking-wide text-zinc-400 shadow-lg backdrop-blur-sm"
          data-chart-viewport-controls
          aria-label="Chart zoom controls"
        >
          <span
            className="px-1 tabular-nums text-zinc-500"
            data-chart-viewport-readout
          >
            {isZoomed
              ? formatViewportDuration(
                  viewportDurationSeconds(effectiveViewport),
                )
              : "Full"}
          </span>
          <button
            type="button"
            onClick={() => zoomViewportByFactor(1.333333)}
            aria-label="Zoom chart out"
            className="rounded px-1.5 py-1 transition hover:bg-white/10 hover:text-zinc-200"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomViewportByFactor(0.75)}
            aria-label="Zoom chart in"
            className="rounded px-1.5 py-1 transition hover:bg-white/10 hover:text-zinc-200"
          >
            +
          </button>
          {chartViewportPresets(inferredDurationSeconds).map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                if (preset.seconds === "full") resetViewport();
                else
                  setViewport(
                    zoomChartViewport({
                      viewport: effectiveViewport,
                      durationSeconds: inferredDurationSeconds,
                      zoomSeconds: preset.seconds,
                      anchorSeconds: presetAnchorSeconds,
                      domainStartSeconds: viewportDomainStartSeconds,
                    }),
                  );
              }}
              aria-pressed={
                preset.seconds === "full"
                  ? !isZoomed
                  : Math.abs(
                      viewportDurationSeconds(effectiveViewport) -
                        preset.seconds,
                    ) < 1
              }
              className="rounded px-1.5 py-1 transition hover:bg-white/10 hover:text-zinc-200 aria-[pressed=true]:bg-violet-400/15 aria-[pressed=true]:text-violet-200"
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      {variant === "console" && reactionBarRectsForChart.length > 0 ? (
        <div
          className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-11rem)] flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded border border-amber-400/15 bg-zinc-950/75 px-2 py-1 text-[9px] font-bold tracking-wide text-amber-200/80 shadow-sm backdrop-blur-sm"
          data-reaction-legend
          title="Backend-authored reaction markers use a fixed-height gutter; color shows reason and opacity shows confidence."
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          <span>Reaction markers</span>
          <span className="text-zinc-500">fixed height · reason color · fade = confidence</span>
        </div>
      ) : null}
      <svg
        ref={chartSvgRef}
        viewBox={`0 0 ${width} ${height}`}
        data-viewer-plot-css-width={
          measuredPlotCssWidth > 0 ? measuredPlotCssWidth.toFixed(2) : undefined
        }
        data-chart-line-weight-mode={lineWeightMode}
        data-chart-primary-line-width={primaryLineWidth.toFixed(2)}
        role={onSelectRollup ? "group" : "img"}
        aria-roledescription={
          onSelectRollup ? "interactive analytics chart" : undefined
        }
        aria-label="Analytics timeline chart"
        aria-description={
          onSelectRollup
            ? "Hover to preview, click to pin a point, and press Escape to clear."
            : undefined
        }
        aria-describedby={
          onSelectRollup ? `${chartId}-announcement` : undefined
        }
        aria-keyshortcuts={
          onSelectRollup
            ? "Home End ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight + - 0 Enter Space Escape"
            : undefined
        }
        data-viewer-state={resolveViewerInteractionState({
          hoverIndex: hover,
          selectedIndex: selectedRollup
            ? rollups.findIndex(
                (rollup) => rollup.minuteTs === selectedRollup.minuteTs,
              )
            : null,
          scrubbing,
        })}
        tabIndex={onSelectRollup ? 0 : undefined}
        className={
          variant === "compact"
            ? "block w-full cursor-crosshair select-none"
            : "block h-[360px] min-h-[320px] w-full cursor-crosshair select-none sm:h-[min(420px,52vh)]"
        }
        style={
          variant === "console"
            ? {
                height: `${height}px`,
                minHeight: `${height}px`,
                overscrollBehavior: "contain",
              }
            : variant === "compact" && heightProp
              ? {
                  height: heightProp,
                  minHeight: heightProp,
                  overscrollBehavior: "contain",
                }
              : { overscrollBehavior: "contain" }
        }
        onKeyDown={handleChartKeyDown}
        onBlur={() => {
          if (hover != null) clearHoverPreview();
        }}
      >
        <defs>
          <linearGradient
            id={`${chartId}-viewerAreaGradient`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor={CHART_THEME.viewer.color}
              stopOpacity={CHART_THEME.viewer.fillTop}
            />
            <stop
              offset="100%"
              stopColor={CHART_THEME.viewer.color}
              stopOpacity={CHART_THEME.viewer.fillBottom}
            />
          </linearGradient>
          <clipPath id={`${chartId}-analyticsPlotClip`}>
            <rect
              x={padLeft}
              y={padTop}
              width={width - padLeft - padRight}
              height={height - padTop - padBottom}
            />
          </clipPath>
          {/* Inspection fade: later measured values remain visible at reduced
              opacity; the fade never changes values or gap semantics. */}
          <linearGradient
            id={`${chartId}-activityFadeMask`}
            gradientUnits="userSpaceOnUse"
            x1={padLeft}
            x2={width - padRight}
            y1="0"
            y2="0"
          >
            <stop offset="0%" stopColor="white" />
            <stop offset={maskStartPercent} stopColor="white" />
            <stop
              offset={maskEndPercent}
              stopColor="white"
              stopOpacity={activityFadeEnabled ? futureOpacity : 1}
            />
            <stop
              offset="100%"
              stopColor="white"
              stopOpacity={activityFadeEnabled ? futureOpacity : 1}
            />
          </linearGradient>
          <mask
            id={`${chartId}-activityFadeMaskApply`}
            maskUnits="userSpaceOnUse"
            x={padLeft}
            y="0"
            width={width - padLeft - padRight}
            height="100%"
          >
            <rect
              x={padLeft}
              y="0"
              width={width - padLeft - padRight}
              height="100%"
              fill={`url(#${chartId}-activityFadeMask)`}
            />
          </mask>
        </defs>

        {/* Bottom axis grid — only horizontal line we keep; the dashed cyan viewer guides
            and white lane separators are noise. Text labels (MAX/AVG/MIN) read off the
            viewer band height and stay readable without an underline. */}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={height - padBottom}
          y2={height - padBottom}
          stroke="rgba(255,255,255,.08)"
          strokeWidth="1"
        />

        {/* Left Y-Axis labels */}
        <g>
          {/* MAX Label */}
          <text
            x={padLeft - 12}
            y={padTop - 4}
            textAnchor="end"
            className="fill-cyan-400 text-[10px] font-black uppercase"
          >
            MAX
          </text>
          <text
            x={padLeft - 12}
            y={padTop + 10}
            textAnchor="end"
            className="fill-cyan-400 text-sm font-black"
          >
            {count(viewerScale)}
          </text>

          {/* AVG Label */}
          {showAvgLabel && (
            <>
              <text
                x={padLeft - 12}
                y={yAvg - 4}
                textAnchor="end"
                className="fill-cyan-400/80 text-[10px] font-black uppercase"
              >
                AVG
              </text>
              <text
                x={padLeft - 12}
                y={yAvg + 10}
                textAnchor="end"
                className="fill-cyan-400/80 text-sm font-black"
              >
                {count(avgViewers)}
              </text>
            </>
          )}
          {viewerScaleMin > 0 && (
            <>
              <text
                x={padLeft - 12}
                y={viewerBand.bandBottom - 14}
                textAnchor="end"
                className="fill-cyan-400/70 text-[10px] font-black uppercase"
              >
                MIN
              </text>
              <text
                x={padLeft - 12}
                y={viewerBand.bandBottom}
                textAnchor="end"
                className="fill-cyan-400/70 text-sm font-black"
              >
                {count(viewerScaleMin)}
              </text>
            </>
          )}
        </g>

        <g
          className="sc-chart-plot"
          clipPath={`url(#${chartId}-analyticsPlotClip)`}
        >
          {/* Activity strip background */}
          <rect
            ref={plotMeasureRef}
            x={padLeft}
            y={activityLayout.activityTop}
            width={width - padLeft - padRight}
            height={activityLayout.activityHeight}
            fill="rgba(255,255,255,0.025)"
          />
          {/* Activity lane separators were rendered as horizontal guides; removed per
            cleanup pass — chat/emote/trace lanes stay distinct via fill colors and
            lane-internal padding without divider lines. */}

          {/* Selected emotes use a compact lane of their own. In the portal
              this sits below aggregate Emotes/min so the green signal never
              competes with an individual overlay trace. */}
          {perEmoteSeries.length > 0 ? (
            <>
              <rect
                x={padLeft}
                y={selectedEmoteBand.bandTop}
                width={width - padLeft - padRight}
                height={Math.max(1, selectedEmoteBand.bandHeight)}
                fill={layoutMode === "equal-signals"
                  ? "rgba(148,163,184,0.055)"
                  : "rgba(255,255,255,0.02)"}
                data-plotted-emote-lane="true"
              />
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={selectedEmoteBand.bandTop}
                y2={selectedEmoteBand.bandTop}
                stroke={layoutMode === "equal-signals"
                  ? "rgba(148,163,184,0.18)"
                  : "rgba(255,255,255,0.08)"}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}

          {viewerGeometry ? (
            <ViewerMorphPaths
              idleLineD={viewerGeometry.idlePathD}
              idleAreaD={viewerGeometry.idleAreaPathD}
              detailLineD={isZoomed ? viewerGeometry.detailPathD : viewerGeometry.idlePathD}
              gradientId={`${chartId}-viewerAreaGradient`}
              plotStartX={timestampScale.plotStartX}
              plotEndX={timestampScale.plotEndX}
              plotCssWidth={measuredPlotCssWidth}
              cursorX={viewerCursorX}
              inspecting={viewerInspecting}
              lineOpacity={viewerLineOpacity}
              areaOpacity={viewerAreaOpacity}
              afterCursorOpacity={afterCursorOpacity}
              futureOpacity={futureOpacity}
              activeColor={CHART_THEME.viewer.color}
              afterCursorColor={CHART_THEME.viewer.after}
              liveEdgeX={liveEdgeX}
              expandProgress={expandProgress}
              strokeWidth={primaryLineWidth}
              animateStrokeWidth={lineWeightMode === "viewport-adaptive"}
              motionEnabled={motionEnabled}
            />
          ) : null}

          <g
            data-activity-future-fade={activityFadeEnabled ? "true" : "false"}
            mask={activityFadeEnabled ? `url(#${chartId}-activityFadeMaskApply)` : undefined}
          >
          {/* Dense emote bar histogram — always on, like chat whisper bars.
              Reaction windows live in the gutter below and never replace this. */}
          {emoteBarElements}

          {reactionBarRectsForChart.map((bar) => (
            <rect
              key={bar.key}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={Math.min(2, bar.width / 3)}
              data-reaction-bar="true"
              data-reaction-offset={bar.offsetSeconds}
              data-reaction-window="true"
              fill={bar.color}
              opacity={Math.min(0.55, 0.28 + bar.confidence * 0.32)}
              stroke={bar.color}
              strokeWidth={bar.refined ? 0.75 : 0.6}
              strokeDasharray={bar.refined ? undefined : "2 2"}
              data-reaction-score={Math.round(bar.score)}
              data-reaction-precision={bar.precisionSeconds ?? undefined}
              aria-label={`Reaction window ${Math.round(bar.score)}/100 at ${formatVodClock(bar.seekOffsetSeconds)}${bar.precisionSeconds != null ? `, plus or minus ${bar.precisionSeconds} seconds` : ""}`}
              pointerEvents="none"
            >
              <title>
                {`Reaction window · ${bar.reason} · ${Math.round(bar.score)}/100 · ${formatVodClock(bar.startSeconds)}–${formatVodClock(bar.endSeconds)}${bar.precisionSeconds != null ? ` · ±${bar.precisionSeconds}s` : ""} · ${bar.refined ? "refined" : "coarse fallback"}`}
              </title>
            </rect>
          ))}

          {reactionPeakBar ? (
            <line
              x1={reactionPeakBar.centerX}
              x2={reactionPeakBar.centerX}
              y1={reactionPeakBar.y - 5}
              y2={reactionPeakBar.y}
              stroke={CHART_THEME.moment.selected}
              strokeWidth="2"
              strokeLinecap="round"
              data-reaction-peak="true"
              className={motionEnabled ? "sc-reaction-peak" : undefined}
              pointerEvents="none"
            />
          ) : null}

          {/* Emote trend over the histogram — same bars+line pairing as chat. */}
          {emoteGuidePathD ? (
            <path
              d={emoteGuidePathD}
              fill="none"
              stroke={CHART_THEME.emote.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={primaryLineWidth}
              style={adaptiveStrokeStyle}
              vectorEffect="non-scaling-stroke"
              data-emote-trend="true"
              data-presentation-trend="emotes"
              opacity={seriesFocusOpacity(
                "emotes",
                Math.min(1, CHART_THEME.emote.line * activityVisualBoost),
              )}
            />
          ) : null}

          {/* Chat whisper bars behind line */}
          {chatBarElements}

          {/* Chat line */}
          {chatLinePathD ? (
            <path
              d={chatLinePathD}
              fill="none"
              stroke={CHART_THEME.chat.line}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={primaryLineWidth}
              style={adaptiveStrokeStyle}
              vectorEffect="non-scaling-stroke"
              data-presentation-trend="chat"
              opacity={seriesFocusOpacity(
                "chat",
                Math.min(1, CHART_THEME.chat.lineOpacity * activityVisualBoost),
              )}
            />
          ) : null}

          {/* Selected emote traces — thin rail directly above aggregate bars. */}
          {perEmoteOverlayElements}
          </g>

          {syncing && syncChatFrontierX != null ? (
            <>
              <rect
                x={syncChatFrontierX}
                y={syncOverlayBand.bandTop}
                width={Math.max(0, width - padRight - syncChatFrontierX)}
                height={syncOverlayBand.bandHeight}
                fill="rgba(9,9,11,0.35)"
              />
              <line
                x1={syncChatFrontierX}
                x2={syncChatFrontierX}
                y1={syncOverlayBand.bandTop}
                y2={syncOverlayBand.bandBottom}
                stroke="rgba(34,211,238,0.85)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                className="animate-pulse"
              />
            </>
          ) : null}
        </g>

        {variant !== "console" && (syncing ? (
          <>
            <text
              x={width - padRight + 2}
              y={padTop + 12}
              textAnchor="start"
              className="fill-cyan-300/90 text-[8px] font-black uppercase"
            >
              Viewers
            </text>
            {perEmoteSeries.length > 0 ? (
              <text
                x={width - padRight + 2}
                y={activityLabelYs.trace}
                textAnchor="start"
                className="fill-zinc-300/80 text-[8px] font-black uppercase"
              >
                Selected max {count(selectedEmoteScaleMax)}
              </text>
            ) : null}
            <text
              x={width - padRight + 2}
              y={activityLabelYs.chat}
              textAnchor="start"
              className="fill-violet-300/80 text-[8px] font-black uppercase"
            >
              Chat (syncing)
            </text>
            <text
              x={width - padRight + 2}
              y={activityLabelYs.bars}
              textAnchor="start"
              className="fill-emerald-300/70 text-[8px] font-black uppercase"
            >
              Emotes (syncing)
            </text>
          </>
        ) : (
          <>
            <text
              x={width - padRight + 2}
              y={emoteBandMaxY - 3}
              textAnchor="start"
              className="fill-emerald-300/80 text-[8px] font-black uppercase"
            >
              Emote peak {count(activityScaleMax)}
            </text>
            {chatItem ? (
              <text
                x={width - padRight + 2}
                y={chatBandMaxY - 3}
                textAnchor="start"
                className="fill-violet-300/80 text-[8px] font-black uppercase"
              >
                Chat max {count(scaleForSeries(chatItem))}
              </text>
            ) : null}
            <text
              x={width - padRight + 2}
              y={activityLabelYs.bars - 3}
              className={reactionBarRectsForChart.length > 0
                ? "fill-amber-300/80 text-[8px] font-black uppercase"
                : "fill-emerald-400/50 text-[8px] font-black uppercase"}
            >
              {reactionBarRectsForChart.length > 0 ? "Reaction markers" : "Emotes"}
            </text>
            {perEmoteSeries.length > 0 ? (
              <text
                x={width - padRight + 2}
                y={activityLabelYs.trace - 3}
                textAnchor="start"
                className="fill-zinc-300/80 text-[8px] font-black uppercase"
              >
                Selected max {count(selectedEmoteScaleMax)}
              </text>
            ) : null}
            <text
              x={width - padRight + 2}
              y={activityLabelYs.chat - 3}
              className="fill-violet-400/50 text-[8px] font-black uppercase"
            >
              Chat
            </text>
          </>
        ))}

        {/* Draw X-axis ticks and time labels. The group is measurable so the
            console can attach its position rail to visible axis content rather
            than the SVG's otherwise invisible footer. */}
        <g data-chart-x-axis="true">
          {(() => {
            // Keep elapsed labels legible when the website chart is rendered in
            // a narrow container. The extension retains its established eight-
            // tick density because it uses the fixed 1000-unit compact viewBox.
            const visibleAxisRollups = rollups.filter((point) => {
              const offset = pointOffsetSeconds(point.minuteTs, streamStartedAt);
              return offset == null
                || (offset >= effectiveViewport.startSeconds
                  && offset <= effectiveViewport.endSeconds);
            });
            const axisRollups = visibleAxisRollups.length > 1 ? visibleAxisRollups : rollups;
            const responsiveTickLimit = variant === "console"
              ? Math.max(2, Math.min(8, Math.floor(plotWidthPx / 90) + 1))
              : 8;
            const numTicks = Math.min(responsiveTickLimit, axisRollups.length);
            if (numTicks <= 1) return null;
            const tickIndices = [];
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i / (numTicks - 1)) * (axisRollups.length - 1)),
              );
            }
            return tickIndices.map((idx) => {
              const item = axisRollups[idx];
              if (!item) return null;
              const x = timestampScale.xForTimestamp(
                item.minuteTs,
                idx,
                axisRollups.length,
              );
              return (
                <g key={idx} className="opacity-60" data-chart-x-axis-tick="true">
                  <line
                    x1={x}
                    x2={x}
                    y1={height - padBottom}
                    y2={height - padBottom + 6}
                    stroke="rgba(255,255,255,.3)"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={height - padBottom + 20}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[10px] font-black"
                    data-chart-x-axis-label="true"
                  >
                    {vodClock(item.minuteTs, streamStartedAt)}
                  </text>
                </g>
              );
            });
          })()}
        </g>

        {cursorSync.synced &&
        cursorSync.cursorOffsetSeconds !== null &&
        rollups.length > 1 ? (
          <line
            x1={displayPlayheadX}
            x2={displayPlayheadX}
            y1={padTop}
            y2={height - padBottom}
            stroke="#34d399"
            strokeWidth="2"
            className="sc-playhead-line"
          />
        ) : null}

        {selectedMarkerX != null || previewMarkerX != null || hoverLineX != null || pinBand != null ? (
          <ChartMotionChrome
            motionEnabled={motionEnabled}
            padLeft={padLeft}
            padTop={padTop}
            plotWidth={plotWidthPx}
            plotBottom={height - padBottom}
            hoverX={hoverLineX}
            pinX={selectedMarkerX}
            hoverBand={hoverBand}
            pinBand={pinBand}
            timeChipLabel={chromeTimeChipLabel}
            timeChipWidth={chromeTimeChipWidth}
            previewX={previewMarkerX}
            previewTimeChipLabel={previewTimeChipLabel}
            previewTimeChipWidth={previewTimeChipWidth}
            selectedMarkerKey={
              selectedRollup?.minuteTs
                ?? (Number.isFinite(selectedOffsetSeconds) ? `offset:${selectedOffsetSeconds}` : 'selected')
            }
            previewMarkerKey={
              previewRollup?.minuteTs
                ?? (Number.isFinite(previewOffsetSeconds) ? `offset:${previewOffsetSeconds}` : 'preview')
            }
          />
        ) : null}

        {highlightedGameBounds ? (
          <g
            pointerEvents="none"
            aria-hidden="true"
            data-game-highlight={highlightedGameSegmentKey ?? undefined}
          >
            <rect
              x={highlightedGameBounds.startX}
              y={padTop}
              width={Math.max(
                1,
                highlightedGameBounds.endX - highlightedGameBounds.startX,
              )}
              height={Math.max(0, height - padTop - padBottom)}
              fill="rgba(249, 115, 22, 0.1)"
            />
            <line
              x1={highlightedGameBounds.endX}
              x2={highlightedGameBounds.endX}
              y1={padTop}
              y2={height - padBottom}
              stroke="rgba(249, 115, 22, 0.32)"
              strokeWidth="1.25"
              strokeDasharray="4 5"
            />
          </g>
        ) : null}

        <GameSegmentOverlay
          segments={chartGames}
          rollups={rollups}
          streamStartedAt={streamStartedAt}
          timestampScale={timestampScale}
          padLeft={padLeft}
          plotWidth={plotWidthPx}
          gameBandTop={gameBandTop}
          gameBandHeight={0}
          labelAnchorY={gameBandTop + Math.min(48, gameDividerExtent * 0.35)}
          dividerExtent={gameDividerExtent}
          minLabelWidth={8}
          highlightedSegmentKey={highlightedGameSegmentKey}
          isLive={isLive}
        />

        {/* Transparent overlay rect for reliable mouse interaction */}
        <rect
          x={padLeft}
          y={padTop}
          width={width - padLeft - padRight}
          height={height - padTop - padBottom}
          fill="transparent"
          style={{
            cursor: dragPanMode === "zoomed" && isZoomed ? "grab" : "crosshair",
            touchAction: dragPanMode === "zoomed" ? "pan-y" : "none",
          }}
          onPointerEnter={(event) => cacheInteractionBounds(event.currentTarget)}
          onMouseMove={(event) => {
            onPreviewReactionMoment?.(
              reactionMomentAtClientPoint(event.clientX, event.clientY, event.currentTarget),
            );
            scheduleHoverFromClientX(event.clientX, event.currentTarget);
          }}
          onMouseLeave={handlePlotMouseLeave}
          onPointerDown={handlePlotPointerDown}
          onPointerMove={handlePlotPointerMove}
          onPointerUp={handlePlotPointerUp}
          onPointerCancel={handlePlotPointerCancel}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            if (rollups.length === 0) return;
            const selection = resolveMultiSignalPointerSelection(
              event.clientX,
              event.clientY,
              event.currentTarget,
            );
            if (selection.kind === "reaction") {
              onSelectReactionMoment?.(selection.moment as ChartReactionPoint);
              setAnnouncement(
                `Selected reaction at ${formatVodClock(selection.analyticalOffsetSeconds)}.`,
              );
              return;
            }
            if (selection.kind === "emote_peak") {
              if (onSelectOffset) onSelectOffset(selection.offsetSeconds);
              else toggleRollupSelection(selection.sourceIndex);
              setAnnouncement(`Selected emote peak at ${formatVodClock(selection.offsetSeconds)}.`);
              return;
            }
            if (selection.kind === "chat_interval") {
              const idx = selection.peak?.index ?? selection.startIndex;
              if (onSelectOffset) onSelectOffset(selection.anchorOffsetSeconds);
              else toggleRollupSelection(idx);
              setAnnouncement(
                `Selected chat interval avg ${Math.round(selection.average)} `
                + `from ${selection.startOffsetSeconds}s to ${selection.endOffsetSeconds}s `
                + `(${selection.observedCount}/${selection.rangeLength} observed).`,
              );
              return;
            }
            if (selection.kind === "chart_minute") {
              if (onSelectOffset) onSelectOffset(selection.offsetSeconds);
              else toggleRollupSelection(selection.canonicalIndex);
              return;
            }
          }}
        />

        {showSpikes
          ? emoteSpikeIdxs.map((idx) => {
              const value = emotesItem?.values[idx] ?? null;
              if (value === null || value <= 0) return null;
              const spikeKey = `emote-${idx}`;
              const n = rollups.length;
              const cx = timestampScale.xForTimestamp(
                rollups[idx]?.minuteTs ?? "",
                idx,
                n,
              );
              const cy = plotY(
                value,
                activityAxis.max,
                height,
                padTop,
                padBottom,
                "activity-emote",
                activityAxis.min,
                activityLayout,
              );
              const isHovered = hoveredSpikeKey === spikeKey;
              const radius = isHovered
                ? CHART_THEME.spike.hoverRadius
                : CHART_THEME.spike.dotRadius;
              return (
                <circle
                  key={spikeKey}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={CHART_THEME.spike.color}
                  stroke="#fafafa"
                  strokeWidth={isHovered ? 2 : 1.5}
                  className="cursor-pointer"
                  style={{ pointerEvents: "all" }}
                  opacity={focusedSeriesKey === "spikes"
                    ? CHART_THEME.spike.opacity
                    : seriesFocusOpacity("emotes", CHART_THEME.spike.opacity)}
                  onMouseEnter={() => setHoveredSpikeKey(spikeKey)}
                  onMouseLeave={() =>
                    setHoveredSpikeKey((current) =>
                      current === spikeKey ? null : current,
                    )
                  }
                  onClick={(event) => handleSpikeSelect(idx, event)}
                />
              );
            })
          : null}

        {/* Chat-spike dot layer removed in the chart cleanup pass; see the
            emoteSpikeIdxs memo comment above. Emote spikes remain the single
            discrete spike layer; chat minutes still tint via bar.isSpike. */}
      </svg>
      {onSelectRollup ? (
        <span
          id={`${chartId}-announcement`}
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </span>
      ) : null}
    </div>
  );

  if (chromeless) return chartBody;

  return (
    <div
      className="sc-chart-root rounded border border-white/10 bg-[#0d0d12] p-3"
      data-variant={variant}
    >
      {!showSpikesControlled || !activityExpandedControlled ? (
        <div className="mb-2 space-y-1">
          <div className="flex h-5 min-h-5 items-center">
            <ChartHoverReadout
              minuteTs={hoverPoint?.minuteTs}
              streamStartedAt={streamStartedAt}
              viewers={hoverPoint ? viewerReadoutValue(hoverPoint) : null}
              chatCount={hoverPoint?.chatCount}
              emoteTotal={hoverPoint ? minuteEmoteTotal(hoverPoint) : null}
              reactionScore={hoverReactionScore}
            />
          </div>
          <div className="flex h-7 min-h-7 items-center justify-end">
            <div className="inline-flex shrink-0 items-center gap-1 rounded border border-white/10 bg-white/[0.03] p-0.5">
              {!showSpikesControlled ? (
                <button
                  type="button"
                  onClick={toggleShowSpikes}
                  aria-pressed={showSpikes}
                  aria-label={
                    showSpikes
                      ? "Hide reaction and spike markers"
                      : "Show reaction and spike markers"
                  }
                  className={`rounded px-2 py-1 text-[10px] font-black uppercase transition ${showSpikes ? "bg-amber-400/10 text-amber-200" : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"}`}
                >
                  Markers
                </button>
              ) : null}
              {!activityExpandedControlled ? (
                <button
                  type="button"
                  onClick={toggleActivityExpanded}
                  aria-pressed={activityExpanded}
                  className={`rounded px-2 py-1 text-[10px] font-black uppercase transition ${activityExpanded ? "bg-violet-400/10 text-violet-200" : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"}`}
                >
                  {activityExpanded ? "Reset" : "Expand"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {chartBody}
    </div>
  );
}

export const PulseMultiSignalChartInner = memo(PulseMultiSignalChartInnerImpl);
