import { useMemo } from 'react'
import type { ChartGameSegment, ChartMinuteRollup, ChartPlayhead, ChartReactionPoint } from './types.ts'
import { normalizeGameSegments } from './gameSegments.ts'
import { gamesNormalizeDurationSeconds } from './gameSegmentChart.ts'
import { rollupsForChart } from './chartSession.ts'
import {
  PulseMultiSignalChartInner,
  type ChartDragPanMode,
  type ChartLineWeightMode,
} from './PulseMultiSignalChart.tsx'
import type { ChartViewport } from './chartViewport.ts'

export interface PulseMultiSignalChartProps {
  rollups: ChartMinuteRollup[]
  /** Optional full-resolution viewer source for idle/detail geometry; defaults to `rollups`. */
  detailRollups?: ChartMinuteRollup[]
  games?: ChartGameSegment[]
  reactionPoints?: ChartReactionPoint[]
  streamStartedAt?: string
  chartStreamId?: string | null
  peakViewersFallback?: number
  avgViewersFallback?: number
  viewerSource?: string
  selectedRollupIndex?: number | null
  previewRollupIndex?: number | null
  selectedOffsetSeconds?: number | null
  previewOffsetSeconds?: number | null
  onSelectRollupIndex?: (index: number | null) => void
  /** Select a raw stream-relative offset without snapping to the display LOD. */
  onSelectOffset?: (offsetSeconds: number) => void
  /** Select an authored reaction window at its refined stream-relative offset. */
  onSelectReactionMoment?: (moment: ChartReactionPoint) => void
  /** Preview an authored reaction window while pointing at its lane. */
  onPreviewReactionMoment?: (moment: ChartReactionPoint | null) => void
  selectedEmoteKeys?: Set<string>
  showSpikes?: boolean
  onShowSpikesChange?: (value: boolean) => void
  activityExpanded?: boolean
  onActivityExpandedChange?: (value: boolean) => void
  isLive?: boolean
  height?: number
  playhead?: ChartPlayhead | null
  loading?: boolean
  emptyMessage?: string
  syncing?: boolean
  variant?: 'console' | 'compact'
  motionEnabled?: boolean
  durationSeconds?: number
  chromeless?: boolean
  highlightedGameSegmentKey?: string | null
  viewport?: ChartViewport | null
  onViewportChange?: (viewport: ChartViewport) => void
  viewportDomainStartSeconds?: number
  dragPanMode?: ChartDragPanMode
  lineWeightMode?: ChartLineWeightMode
}

export function PulseMultiSignalChart({
  rollups: allRollups,
  detailRollups: detailRollupsProp,
  games = [],
  reactionPoints = [],
  streamStartedAt,
  chartStreamId = null,
  peakViewersFallback = 0,
  avgViewersFallback = 0,
  viewerSource,
  selectedRollupIndex = null,
  previewRollupIndex = null,
  selectedOffsetSeconds = null,
  previewOffsetSeconds = null,
  onSelectRollupIndex,
  onSelectOffset,
  onSelectReactionMoment,
  onPreviewReactionMoment,
  selectedEmoteKeys = new Set(),
  showSpikes,
  onShowSpikesChange,
  activityExpanded,
  onActivityExpandedChange,
  isLive = false,
  height,
  playhead = null,
  loading = false,
  emptyMessage = 'Chart data not available yet.',
  syncing = false,
  variant = 'compact',
  motionEnabled = true,
  durationSeconds = 0,
  chromeless = false,
  highlightedGameSegmentKey = null,
  viewport,
  onViewportChange,
  viewportDomainStartSeconds = 0,
  dragPanMode = 'off',
  lineWeightMode = 'fixed',
}: PulseMultiSignalChartProps) {
  const chartRollups = useMemo(() => rollupsForChart(allRollups, isLive), [allRollups, isLive])
  const detailRollups = useMemo(
    () => detailRollupsProp?.length ? detailRollupsProp : allRollups,
    [allRollups, detailRollupsProp],
  )
  const selectedRollup = selectedRollupIndex != null ? chartRollups[selectedRollupIndex] ?? null : null
  const previewRollup = previewRollupIndex != null ? chartRollups[previewRollupIndex] ?? null : null
  const chartOffsets = useMemo(() => {
    const startMs = streamStartedAt ? Date.parse(streamStartedAt) : NaN
    return chartRollups.map((rollup, index) => {
      const minuteMs = Date.parse(rollup.minuteTs)
      if (Number.isFinite(startMs) && Number.isFinite(minuteMs)) {
        return Math.max(0, Math.floor((minuteMs - startMs) / 1000))
      }
      return index * 60
    })
  }, [chartRollups, streamStartedAt])
  const chartGames = useMemo(() => {
    const span = gamesNormalizeDurationSeconds(chartOffsets, chartRollups.length, durationSeconds)
    return normalizeGameSegments(games, span)
  }, [games, durationSeconds, chartOffsets, chartRollups.length])

  if (loading && chartRollups.length === 0) {
    return (
      <div className="pulse-chart-empty" style={{ minHeight: height ?? 200, display: 'grid', placeItems: 'center', color: '#71717a', fontSize: 12 }}>
        Loading chart…
      </div>
    )
  }

  if (chartRollups.length === 0) {
    return (
      <div className="pulse-chart-empty" style={{ minHeight: height ?? 200, display: 'grid', placeItems: 'center', color: '#71717a', fontSize: 12, textAlign: 'center', padding: 12 }}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <PulseMultiSignalChartInner
      rollups={chartRollups}
      detailRollups={detailRollups}
      games={chartGames}
      reactionPoints={reactionPoints}
      streamStartedAt={streamStartedAt}
      chartStreamId={chartStreamId}
      peakViewersFallback={peakViewersFallback}
      avgViewersFallback={avgViewersFallback}
      viewerSource={viewerSource}
      selectedEmotes={selectedEmoteKeys}
       selectedRollup={selectedRollup}
       previewRollup={previewRollup}
       selectedOffsetSeconds={selectedOffsetSeconds}
       previewOffsetSeconds={previewOffsetSeconds}
      onSelectRollup={rollup => {
        if (!onSelectRollupIndex) return
        if (!rollup) {
          onSelectRollupIndex(null)
          return
        }
        const idx = chartRollups.findIndex(point => point.minuteTs === rollup.minuteTs)
        onSelectRollupIndex(idx >= 0 ? idx : null)
      }}
      onSelectOffset={onSelectOffset}
      onSelectReactionMoment={onSelectReactionMoment}
      onPreviewReactionMoment={onPreviewReactionMoment}
       isLive={isLive}
       syncing={syncing}
       showSpikes={showSpikes}
       onShowSpikesChange={onShowSpikesChange}
       activityExpanded={activityExpanded}
       onActivityExpandedChange={onActivityExpandedChange}
      height={height}
      playhead={playhead}
      variant={variant}
      motionEnabled={motionEnabled}
      chromeless={chromeless}
      highlightedGameSegmentKey={highlightedGameSegmentKey}
       durationSeconds={durationSeconds}
       viewport={viewport}
       onViewportChange={onViewportChange}
       viewportDomainStartSeconds={viewportDomainStartSeconds}
       dragPanMode={dragPanMode}
       lineWeightMode={lineWeightMode}
     />
  )
}
