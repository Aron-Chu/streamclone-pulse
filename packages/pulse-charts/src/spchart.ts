/**
 * `@streampulse/pulse-charts/spchart`: the analytics timeline chart core
 * (hub and session). Hand-written React SVG; no chart library. Not exported
 * from index.ts or extension.ts. Contract: ./sp/types.ts.
 */
export type * from './sp/types.ts'
export { SpChart } from './sp/SpChart.tsx'
export { createSpViewportStore, SP_EASE } from './sp/viewportStore.ts'
export { createSpHoverStore } from './sp/hoverStore.ts'
export { overviewPath, type SpOverview } from './sp/overview.ts'
export { clusterPins, pinClusterSpan, type SpPinCluster } from './sp/pins.ts'
export { bandBox, type SpBandBox } from './sp/band.ts'
export { spLayout, panelY, SP_BAND_PX, SP_AXIS_PX, SP_TICK_COLUMN } from './sp/layout.ts'
export { niceTicks, compact, formatInt, elapsedTicks, clockTicks, formatElapsed, formatClock } from './sp/scale.ts'
export { buildSpLevels, pickSpLevel, barAt, barWidthPx, SP_RECT_CAP } from './sp/bars.ts'
export { laneLayout, laneTick, laneFigure, laneWidth, SP_LANE_HEAD, SP_LANE_GAP, SP_LANE_WIDTH } from './sp/lanes.ts'
export { pickBarLevel, type BarLevelOptions } from './barPyramid.ts'
