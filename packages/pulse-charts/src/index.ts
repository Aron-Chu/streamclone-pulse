export type { ChartGameSegment, ChartMinuteRollup, ChartPlayhead, ChartReactionPoint } from './types.ts'
export { PulseMultiSignalChart, type PulseMultiSignalChartProps } from './PulseMultiSignalChartPublic.tsx'
export { PulseMultiSignalChartInner, type ChartDragPanMode, type ChartLayoutMode } from './PulseMultiSignalChart.tsx'
export { normalizeGameSegments, hasMeaningfulGameSegments, gameSegmentKey, gameSegmentOverlapsOffsetRange, gameSegmentVisibleSecondsInRange } from './gameSegments.ts'
export {
  CHART_PLOT_PAD_LEFT,
  CHART_PLOT_PAD_RIGHT,
  resolveGamesPlayedTimelineRange,
  buildGamesPlayedTimelineSlots,
  type GamesPlayedTimelineRange,
  type GamesPlayedTimelineSlot,
  type GamesPlayedTimelineGap,
  type GamesPlayedTimelineSegmentSlot,
} from './gamesPlayedTimeline.ts'
export {
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
  gameSegmentPlotBoundsByTimestampScale,
  gamesNormalizeDurationSeconds,
  plotXForOffsetSeconds,
} from './gameSegmentChart.ts'
export {
  GameSegmentOverlay,
  shouldRenderActiveGameCap,
  activeGameCapX,
  activeGameCapTitle,
  ACTIVE_GAME_CAP_DASHARRAY,
  type GameSegmentOverlayProps,
} from './GameSegmentOverlay.tsx'
export { rollupsForChart } from './chartSession.ts'
export { buildChartSeries, type ChartSeries } from './chartSeries.ts'
export { useSmoothedScalar, type ScalarMotionOptions } from './useSmoothedScalar.ts'
export { MAX_PLOTTED_EMOTES } from './emotePlotSelection.ts'
export { viewerScaleBounds, type ViewerScaleAxis } from './viewerScale.ts'
export {
  viewerHistoryValues,
  resolveViewerInteractionState,
  type ViewerInteractionState,
} from './viewerInteraction.ts'
export {
  buildViewerGeometry,
  buildViewerMorphGeometry,
  buildViewerOverviewAreaPath,
  buildViewerOverviewPath,
  buildViewerDetailPath,
  buildViewerTimestampScale,
  projectValuesToTimestamps,
  reduceViewerSegment,
  reduceViewerOverviewSegment,
  viewerDetailPointBudget,
  viewerIdlePointBudget,
  viewerPointAtTimestamp,
  type ViewerGeometryOptions,
  type ViewerGeometry,
  type ViewerPoint,
  type ViewerSegment,
  type ViewerTimestampScale,
  type ViewerTimedValue,
} from './viewerGeometry.ts'
export {
  CHART_THEME,
  CHART_LINE_WIDTH,
  CHART_MOTION,
  adaptiveChartLineWidth,
  chartLineWidth,
  emoteChartColor,
  emoteChartColorForKey,
  hexToRgba,
  emoteChipSelectionStyle,
  emoteLegendSwatchStyle,
  legendDotStyle,
} from './chartTheme.ts'
export {
  buildRenderBucketRanges,
  buildRenderBuckets,
  type RenderBucketRange,
  type RenderSignalPoint,
  type RenderSignalBucket,
  type RenderBuckets,
} from './renderBuckets.ts'
export {
  contiguousSegmentsForRange,
  contiguousPathRunsAcrossBuckets,
  composeRenderView,
  pinsAddressableInRange,
  type ContiguousSegment,
  type RenderViewSignalBucket,
  type ComposedRenderView,
} from './renderView.ts'
export {
  buildPresentationTrend,
  decimatePresentationPoints,
  monotoneCubicAreaPath,
  monotoneCubicPath,
  presentationPointBudget,
  presentationTrendPathD,
  resolvePresentationStep,
  resolveSemanticLodMode,
  INSPECTION_AFTER_OPACITY,
  type BuildPresentationTrendOptions,
  type PresentationTrend,
  type PresentationTrendPoint,
  type PresentationTrendSegment,
  type SemanticLodMode,
} from './presentationTrend.ts'
export {
  chatIntervalSelectionFromActivityBar,
} from './chatIntervalSelection.ts'
export {
  buildReactionLaneGeometry,
  findReactionMomentAtPlotX,
  type ReactionLaneGeometry,
  type ReactionLaneGeometryOptions,
} from './reactionLane.ts'
export {
  MIN_CHART_VIEWPORT_SECONDS,
  CHART_WHEEL_MAX_RATIO,
  CHART_DRAG_INTENT_PX,
  chartViewportPresets,
  chartWheelZoomRatio,
  dragPanChartViewport,
  fullChartViewport,
  normalizeChartViewport,
  panChartViewport,
  viewportCenterSeconds,
  viewportDurationSeconds,
  wheelZoomChartViewport,
  zoomChartViewport,
  type ChartViewport,
} from './chartViewport.ts'
export {
  LONG_STREAM_OVERVIEW_SECONDS,
  MIN_RAIL_OVERVIEW_SECONDS,
  shouldShowChartRail,
  isFollowingLive,
  jumpViewportToOffset,
  magnitudeActivitySeries,
  railGeometry,
  resizeViewportEdge,
} from './ChartPositionRail.tsx'
export { ChartPositionRail, type ChartPositionRailProps } from './ChartPositionRail.tsx'
export {
  clampTimeChipX,
  estimateTimeChipWidth,
  formatChartMinuteChip,
  hoverBandFromBars,
  intervalBandFromTimestamps,
} from './ChartMotionChrome.tsx'
export { ChartMotionChrome, type ChartMotionChromeProps } from './ChartMotionChrome.tsx'
export {
  buildChartHitRegions,
  chartHitRegionAtX,
  type ChartHitPoint,
  type ChartHitRegion,
} from './chartHitRegions.ts'
export {
  count,
  vodClock,
  formatVodClock,
  minuteEmoteTotal,
  rollupHasMinuteData,
  rollupsHaveViewerData,
  analyzeViewerCoverage,
  viewerSourceLabel,
  chartViewerValue,
  viewerValue,
  viewerLatestKpiValue,
  viewerObservedValue,
  viewerReadoutValue,
  buildCompositeOverviewSeries,
  chartBarBucketOpacity,
  type CompositeOverviewSignal,
} from './chartRollupUtils.ts'
