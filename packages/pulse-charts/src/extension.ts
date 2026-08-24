/**
 * Curated surface for the StreamPulse extension bundle.
 *
 * The extension must not pull portal-only chart machinery (PulseMultiSignalChart
 * and friends) into its content script, so the extension Vite alias points at
 * this module instead of the full package index. Keep this list limited to what
 * `src/` actually imports from '@streampulse/pulse-charts'.
 */
export type { ChartGameSegment, ChartMinuteRollup } from './types.ts'
export {
  gameSegmentKey,
  gameSegmentOverlapsOffsetRange,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
} from './gameSegments.ts'
export {
  buildGamesPlayedTimelineSlots,
  resolveGamesPlayedTimelineRange,
  type GamesPlayedTimelineGap,
  type GamesPlayedTimelineRange,
  type GamesPlayedTimelineSegmentSlot,
  type GamesPlayedTimelineSlot,
} from './gamesPlayedTimeline.ts'
export {
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
} from './gameSegmentChart.ts'
export { viewerScaleBounds } from './viewerScale.ts'
export {
  buildViewerGeometry,
  buildViewerOverviewAreaPath,
  type ViewerTimedValue,
} from './viewerGeometry.ts'
export { GameSegmentOverlay } from './GameSegmentOverlay.tsx'
