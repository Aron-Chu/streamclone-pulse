export type { ChartGameSegment, ChartMinuteRollup, ChartPlayhead } from './types.ts'
export { PulseMultiSignalChart, type PulseMultiSignalChartProps } from './PulseMultiSignalChartPublic.tsx'
export { PulseMultiSignalChartInner } from './PulseMultiSignalChart.tsx'
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
export { CHART_THEME, emoteChartColor, emoteChartColorForKey, hexToRgba, emoteChipSelectionStyle, emoteLegendSwatchStyle, legendDotStyle } from './chartTheme.ts'
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
  chartBarBucketOpacity,
  buildCompositeOverviewSeries,
  type CompositeOverviewSignal,
} from './chartRollupUtils.ts'
