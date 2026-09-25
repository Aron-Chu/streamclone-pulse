import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { deriveLiveStats, formatHeatOffset, reactionAnalyticalOffset, toLiveStatsInputFromExtension, type LiveHeatPoint } from '@streampulse/pulse-core'
import type { ExtensionEmote, ExtensionPeak, PulsePayload } from '../shared/messages.ts'
import {
  fullHistoryActivationKey,
  hasStableFullHistoryActivation,
  hasValidatedFullHistory,
  makeFullHistoryActivation,
  type FullHistoryRequestResult,
} from '../shared/fullHistoryAuth.ts'
import {
  aggregateChartEmotes,
  buildEmoteOverlaySeries,
  chartEmptyMessage,
  describeRollupGap,
  DEFAULT_CHART_TIMELINE_WINDOW,
  emoteSelectionKey,
  findChartIndexByOffset,
  fullRollupsMissingStreamPrefix,
  MAX_PLOTTED_EMOTES,
  PLOT_PICKER_EMOTE_LIMIT,
  pruneUnavailableEmoteSelections,
  toggleEmotePlotKeys,
} from './chatActivityEmotes.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'
import { extensionRollupViewerCount, safeGameTimeline } from './extensionChartAdapter.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { PulseOverviewChart } from './PulseOverviewChart.tsx'
import { ChartReadoutBand } from './ChartReadoutBand.tsx'
import { pickRecapRollups } from './recapMomentMetrics.ts'
import { zeroFillRollupsForRecap } from './recapChartPrep.ts'
import { mergeRecapMoments, recapStreamDurationSeconds, rollupToRecapHeatPoint } from './recapChartPeaks.ts'
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { StreamActivityChartHeader } from './StreamActivityChartHeader.tsx'
import { theme } from './theme.ts'
import { useChartExpansion } from './motion/useChartExpansion.ts'
import { shouldShowChartRail } from './ChartPositionRail.tsx'
import { ChartViewportControls } from './ChartViewportControls.tsx'
import { selectVisibleChartMomentPeaks } from './chartMomentMarkers.ts'
import {
  clampViewportToCoverage,
  jumpToOffset as jumpChartViewportToOffset,
  MIN_VIEWPORT_SECONDS,
  resolveViewport,
  viewportContainsOffset,
  viewportDurationSeconds,
  zoomViewport,
  type ChartViewport,
} from './chartViewport.ts'

export interface RecapTimelineChartProps {
  payload: PulsePayload
  backendUrl: string
  peakOffsets: number[]
  catalog: ExtensionEmote[]
  pinOffsetSeconds?: number | null
  previewOffsetSeconds?: number | null
  sidebarFill?: boolean
  highlightedGameSegmentKey?: string | null
  onSelectPoint: (point: LiveHeatPoint) => void
  onClearSelection?: () => void
  onRequestFullRollups?: () => Promise<FullHistoryRequestResult>
}

export function RecapTimelineChart({
  payload,
  backendUrl,
  peakOffsets,
  catalog,
  pinOffsetSeconds = null,
  previewOffsetSeconds = null,
  sidebarFill = false,
  highlightedGameSegmentKey = null,
  onSelectPoint,
  onClearSelection,
  onRequestFullRollups,
}: RecapTimelineChartProps) {
  const activation = useMemo(
    () => makeFullHistoryActivation(payload),
    [payload.login, payload.startedAt, payload.streamId, payload.vodId],
  )
  const activationKey = fullHistoryActivationKey(activation)
  const hasFullRollups = hasValidatedFullHistory(payload, activation)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [showPeakMarkers, setShowPeakMarkers] = useState(false)
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const fullTimelineRequestedRef = useRef(false)
  const fullTimelineInFlightRef = useRef(false)
  const pendingReturnSpanRef = useRef<number | null>(null)
  const onRequestFullRollupsRef = useRef(onRequestFullRollups)
  const chartIdentity = `${activationKey}:${payload.startedAt ?? ''}`
  onRequestFullRollupsRef.current = onRequestFullRollups

  const currentOffsetSeconds = useMemo(
    () => recapStreamDurationSeconds(payload),
    [payload],
  )
  // Reject stale cross-stream timelines before they reach the chart overlay.
  const recapGames = useMemo(
    () => safeGameTimeline(payload.games, currentOffsetSeconds),
    [payload.games, currentOffsetSeconds],
  )

  const minuteRollups = useMemo(() => {
    const source = pickRecapRollups(payload)
    if (source.length === 0) return []
    if (currentOffsetSeconds <= 60) return source
    const missingBeforeOffset = Math.max(
      payload.coverageStartOffsetSeconds ?? payload.coverage?.coverageStartOffsetSeconds ?? 0,
      source[0]?.offsetSeconds ?? 0,
    )
    return zeroFillRollupsForRecap(
      source,
      0,
      currentOffsetSeconds,
      missingBeforeOffset,
      payload.coverage?.missingRanges ?? [],
    )
  }, [payload, currentOffsetSeconds])

  const chartDurationSeconds = useMemo(() => {
    const lastRollupEnd = minuteRollups.length > 0
      ? (minuteRollups[minuteRollups.length - 1]?.offsetSeconds ?? 0) + 60
      : 0
    return Math.max(currentOffsetSeconds, lastRollupEnd)
  }, [currentOffsetSeconds, minuteRollups])

  const chartOffsets = useMemo(
    () => minuteRollups.map(rollup => rollup.offsetSeconds),
    [minuteRollups],
  )

  const mergedMoments = useMemo(
    () => mergeRecapMoments(payload.recap, payload.peaks, 20, pickRecapRollups(payload)),
    [payload.peaks, payload.recap],
  )

  const chartPeakMarkers = useMemo<ExtensionPeak[]>(() => {
    const source = mergedMoments.length > 0
      ? mergedMoments
      : peakOffsets.map(offsetSeconds => ({
          offsetSeconds,
          score: 0,
          compositeScore: undefined,
          reactionScore: undefined,
          viewerMomentumScore: undefined,
          reasons: ['manual'],
          dominantSignal: 'composite',
          chatCount: undefined,
          emoteCount: undefined,
          reactionOnsetOffsetSeconds: undefined,
          reactionApexOffsetSeconds: undefined,
          seekOffsetSeconds: undefined,
          precisionSeconds: undefined,
          refinementStatus: undefined,
          refinementConfidence: undefined,
          reactionScoringVersion: undefined,
        }))
    return source.map(moment => ({
        offsetSeconds: moment.offsetSeconds,
        score: moment.score,
        compositeScore: moment.compositeScore,
        reactionScore: moment.reactionScore,
        viewerMomentumScore: moment.viewerMomentumScore,
        reasons: moment.reasons ?? [],
        reasonLabel: moment.reasons?.[0],
        dominantSignal: moment.reasons?.[0] ?? 'composite',
        chatCount: moment.chatCount,
        emoteCount: moment.emoteCount,
        reactionOnsetOffsetSeconds: moment.reactionOnsetOffsetSeconds,
        reactionApexOffsetSeconds: moment.reactionApexOffsetSeconds,
        seekOffsetSeconds: moment.seekOffsetSeconds,
        precisionSeconds: moment.precisionSeconds,
        refinementStatus: moment.refinementStatus,
        refinementConfidence: moment.refinementConfidence,
        reactionScoringVersion: moment.reactionScoringVersion,
      }))
  }, [mergedMoments, peakOffsets])

  const stats = deriveLiveStats(toLiveStatsInputFromExtension(payload))
  const rollupGapNotice = hasFullRollups ? describeRollupGap(pickRecapRollups(payload)) : null
  const sourceRollups = pickRecapRollups(payload)
  const firstRollupOffset = sourceRollups[0]?.offsetSeconds ?? 0
  const rollupSinceHint =
    firstRollupOffset > 0
      ? `Rollups since ${formatHeatOffset(firstRollupOffset)}`
      : (!hasFullRollups || fullRollupsMissingStreamPrefix(payload)) && timelineLoading
        ? 'Loading full stream…'
        : null
  const viewerSamplesAvailable = minuteRollups.some(
    rollup => extensionRollupViewerCount(rollup) !== undefined,
  )
  const viewerCapabilityExpected = payload.helixEnabled === true
    || payload.viewerStartOffsetSeconds != null
    || payload.peakViewers != null
  // Always show the viewer lane on live streams so users see the placeholder
  // when data is warming up or the backend hasn't enabled Helix sampling yet.
  const showViewerStrip = payload.isLive || viewerSamplesAvailable || viewerCapabilityExpected
  const chartCoverageStartSeconds = 0
  const [chartViewport, setChartViewport] = useState<ChartViewport>(() => resolveViewport({
    durationSeconds: chartDurationSeconds,
    zoomSeconds: DEFAULT_CHART_TIMELINE_WINDOW,
    coverageStartSeconds: chartCoverageStartSeconds,
  }))
  const chartViewportForRender = useMemo(
    () => clampViewportToCoverage(
      chartViewport,
      chartDurationSeconds,
      chartCoverageStartSeconds,
    ),
    [chartCoverageStartSeconds, chartDurationSeconds, chartViewport],
  )

  const chartPeakMarkerVisibleCount = useMemo(
    () => selectVisibleChartMomentPeaks(
      chartPeakMarkers,
      chartViewportForRender.startSeconds,
      chartViewportForRender.endSeconds,
    ).visible.length,
    [chartPeakMarkers, chartViewportForRender.endSeconds, chartViewportForRender.startSeconds],
  )

  useEffect(() => {
    setChartViewport(current => {
      const next = clampViewportToCoverage(
        current,
        chartDurationSeconds,
        chartCoverageStartSeconds,
      )
      if (next.startSeconds === current.startSeconds && next.endSeconds === current.endSeconds) return current
      return next
    })
  }, [chartCoverageStartSeconds, chartDurationSeconds])

  const visibleChartRollupCount = minuteRollups.filter(rollup => (
    rollup.offsetSeconds >= chartViewportForRender.startSeconds
    && rollup.offsetSeconds < chartViewportForRender.endSeconds
  )).length
  const chartEmpty = chartEmptyMessage({
    rollupCount: minuteRollups.length,
    visibleRollupCount: visibleChartRollupCount,
    chartWindow: 'full',
    hasFullRollups,
    confidence: stats.confidence,
    currentOffsetSeconds,
  })

  const topEmotesForPicker = useMemo(() => {
    const fromRollups = aggregateChartEmotes(minuteRollups, PLOT_PICKER_EMOTE_LIMIT)
    if (fromRollups.length > 0) return fromRollups
    return catalog.filter(emote => (emote.count ?? 0) > 0).slice(0, PLOT_PICKER_EMOTE_LIMIT)
  }, [minuteRollups, catalog])

  const timelineLoadingFlag = timelineLoading || (minuteRollups.length === 0 && Boolean(onRequestFullRollups))

  useEffect(() => {
    setSelectedEmoteKeys(current => {
      const next = pruneUnavailableEmoteSelections(current, topEmotesForPicker, minuteRollups, {
        loading: timelineLoadingFlag,
      })
      if (next.length === current.length && next.every((key, index) => key === current[index])) {
        return current
      }
      return next
    })
  }, [topEmotesForPicker, minuteRollups, timelineLoadingFlag])

  const selectedEmotesForOverlay = useMemo(
    () => topEmotesForPicker.filter(emote => selectedEmoteKeys.includes(emoteSelectionKey(emote))),
    [topEmotesForPicker, selectedEmoteKeys],
  )

  const emoteOverlays = useMemo(
    () =>
      selectedEmotesForOverlay.length > 0
        ? buildEmoteOverlaySeries(minuteRollups, selectedEmotesForOverlay, minuteRollups)
        : [],
    [minuteRollups, selectedEmotesForOverlay],
  )

  const selectedPlotColors = useMemo(() => {
    const map: Record<string, string> = {}
    selectedEmotesForOverlay.forEach((emote, index) => {
      map[emoteSelectionKey(emote)] = emoteOverlays[index]?.color ?? '#fb7185'
    })
    return map
  }, [selectedEmotesForOverlay, emoteOverlays])

  const pinChartIndex = useMemo(() => {
    if (pinOffsetSeconds == null) return null
    return findChartIndexByOffset(chartOffsets, pinOffsetSeconds, { bucketed: true })
  }, [pinOffsetSeconds, chartOffsets])

  const previewChartIndex = useMemo(() => {
    if (previewOffsetSeconds == null) return null
    return findChartIndexByOffset(chartOffsets, previewOffsetSeconds, { bucketed: true })
  }, [previewOffsetSeconds, chartOffsets])

  const pinRollup = pinChartIndex != null ? minuteRollups[pinChartIndex] : undefined
  const previewRollup = previewChartIndex != null ? minuteRollups[previewChartIndex] : undefined

  const readoutRollup = useMemo(() => {
    if (chartHoverOffsetSeconds != null) {
      const hovered = minuteRollups.find(rollup => rollup.offsetSeconds === chartHoverOffsetSeconds)
      if (hovered) return hovered
    }
    if (pinRollup) return pinRollup
    if (previewRollup) return previewRollup
    return undefined
  }, [chartHoverOffsetSeconds, minuteRollups, pinRollup, previewRollup])

  const minuteReadoutEmotes = readoutRollup?.topEmotes?.filter(emote => (emote.count ?? 0) > 0) ?? []
  const canShowStreamEmoteFallback = Boolean(
    readoutRollup
    && minuteEmoteTotal(readoutRollup) > 0
    && topEmotesForPicker.length > 0,
  )
  const readoutEmotes = minuteReadoutEmotes.length > 0
    ? minuteReadoutEmotes
    : canShowStreamEmoteFallback
      ? topEmotesForPicker
      : []
  const readoutEmoteScope = minuteReadoutEmotes.length > 0 ? 'minute' : 'stream'

  const chartInteractionRef = useRef<HTMLDivElement | null>(null)

  const handleClearChartSelection = useCallback((): void => {
    setChartHoverOffsetSeconds(null)
    onClearSelection?.()
  }, [onClearSelection])

  useEffect(() => {
    fullTimelineRequestedRef.current = false
    fullTimelineInFlightRef.current = false
    pendingReturnSpanRef.current = null
  }, [chartIdentity])

  const requestFullTimeline = useCallback((retry = false): void => {
    if (hasFullRollups || fullTimelineInFlightRef.current) return
    if (!retry && fullTimelineRequestedRef.current) return
    if (!hasStableFullHistoryActivation(activation)) return
    const request = onRequestFullRollupsRef.current
    if (!request) return
    fullTimelineRequestedRef.current = true
    fullTimelineInFlightRef.current = true
    setTimelineLoading(true)
    void request().finally(() => {
      fullTimelineInFlightRef.current = false
      setTimelineLoading(false)
    })
  }, [activation, hasFullRollups])

  useEffect(() => {
    requestFullTimeline()
  }, [activationKey, requestFullTimeline])

  useEffect(() => {
    setChartHoverOffsetSeconds(null)
    setSelectedEmoteKeys([])
    setShowPeakMarkers(false)
    setFocusedSeriesKey(null)
  }, [chartIdentity])

  useEffect(() => {
    setChartViewport(resolveViewport({
      durationSeconds: chartDurationSeconds,
      zoomSeconds: 'full',
      coverageStartSeconds: chartCoverageStartSeconds,
    }))
    // Activation changes are the only reason to reset a user's chosen range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartIdentity])

  useEffect(() => {
    if (pinOffsetSeconds != null) {
      setEmotePanelExpanded(false)
    }
    setChartHoverOffsetSeconds(null)
  }, [pinOffsetSeconds])

  const selectPointAtIndex = useCallback((index: number): void => {
    const rollup = minuteRollups[index]
    if (!rollup) return

    onSelectPoint(rollupToRecapHeatPoint(rollup, payload.startedAt, catalog))
  }, [catalog, minuteRollups, onSelectPoint, payload.startedAt])

  const handleChartSelect = useCallback((index: number): void => {
    selectPointAtIndex(index)
    setChartHoverOffsetSeconds(null)
  }, [selectPointAtIndex])

  const handleChartMomentSelect = useCallback((peak: ExtensionPeak): void => {
    // Select the moment via the same rollup-index path as bar clicks, so
    // the pin and highlight match the top moments list behavior.
    const offset = reactionAnalyticalOffset(peak)
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < minuteRollups.length; i++) {
      const dist = Math.abs(minuteRollups[i].offsetSeconds - offset)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    selectPointAtIndex(bestIdx)
    setChartHoverOffsetSeconds(null)
  }, [minuteRollups, selectPointAtIndex])

  function toggleEmotePlot(emote: ExtensionEmote): void {
    const key = emoteSelectionKey(emote)
    setSelectedEmoteKeys(current => toggleEmotePlotKeys(current, key, MAX_PLOTTED_EMOTES))
  }

  const chartRegionId = `pulse-recap-chart-${useId().replace(/:/g, '')}`
  const chartExpansion = useChartExpansion({
    identity: chartIdentity,
    heights: { collapsed: 216, expanded: 264 },
  })
  const tracesExpanded = chartExpansion.expanded
  const chartHeight = chartExpansion.height
  const hasPlottedEmotes = selectedEmotesForOverlay.length > 0

  const toggleSeriesFocus = useCallback((seriesKey: string) => {
    setFocusedSeriesKey(current => (current === seriesKey ? null : seriesKey))
  }, [])

  const handleChartViewportChange = useCallback((next: ChartViewport): void => {
    setChartViewport(clampViewportToCoverage(
      next,
      chartDurationSeconds,
      chartCoverageStartSeconds,
    ))
  }, [chartCoverageStartSeconds, chartDurationSeconds])

  const changeChartZoom = useCallback((direction: 'in' | 'out'): void => {
    if (chartDurationSeconds <= 0) return
    const availableDuration = Math.max(0, chartDurationSeconds - chartCoverageStartSeconds)
    const currentDuration = viewportDurationSeconds(chartViewportForRender)
    const nextDuration = direction === 'in'
      ? Math.max(Math.min(MIN_VIEWPORT_SECONDS, availableDuration), currentDuration / 1.5)
      : Math.min(availableDuration, currentDuration * 1.5)
    handleChartViewportChange(zoomViewport({
      viewport: chartViewportForRender,
      zoomSeconds: nextDuration,
      durationSeconds: chartDurationSeconds,
      coverageStartSeconds: chartCoverageStartSeconds,
    }))
  }, [
    chartCoverageStartSeconds,
    chartDurationSeconds,
    chartViewportForRender,
    handleChartViewportChange,
  ])

  const resetChartViewport = useCallback((): void => {
    handleChartViewportChange(resolveViewport({
      durationSeconds: chartDurationSeconds,
      zoomSeconds: 'full',
      coverageStartSeconds: chartCoverageStartSeconds,
    }))
  }, [chartCoverageStartSeconds, chartDurationSeconds, handleChartViewportChange])

  const chartRailVisible = shouldShowChartRail(
    chartViewportForRender,
    chartDurationSeconds,
    chartCoverageStartSeconds,
  )
  const chartAtAvailableRange = chartViewportForRender.startSeconds <= chartCoverageStartSeconds + 5
    && chartViewportForRender.endSeconds >= chartDurationSeconds - 5
  const selectedOutsideViewport = pinOffsetSeconds != null
    && !viewportContainsOffset(chartViewportForRender, pinOffsetSeconds)
  const returnToSelected = useCallback((): void => {
    if (pinOffsetSeconds == null || chartDurationSeconds <= 0) return
    if (!hasFullRollups && (!pinRollup || pinRollup.missing)) {
      pendingReturnSpanRef.current = viewportDurationSeconds(chartViewportForRender)
      requestFullTimeline(true)
      return
    }
    pendingReturnSpanRef.current = null
    handleChartViewportChange(jumpChartViewportToOffset(
      chartViewportForRender,
      pinOffsetSeconds,
      chartDurationSeconds,
      viewportDurationSeconds(chartViewportForRender),
      chartCoverageStartSeconds,
    ))
  }, [
    chartCoverageStartSeconds,
    chartDurationSeconds,
    chartViewportForRender,
    hasFullRollups,
    handleChartViewportChange,
    pinRollup,
    pinOffsetSeconds,
    requestFullTimeline,
  ])

  useEffect(() => {
    if (
      pendingReturnSpanRef.current == null
      || chartDurationSeconds <= 0
      || pinOffsetSeconds == null
      || (!hasFullRollups && (!pinRollup || pinRollup.missing))
    ) return
    const span = pendingReturnSpanRef.current
    pendingReturnSpanRef.current = null
    setChartViewport(current => jumpChartViewportToOffset(
      current,
      pinOffsetSeconds,
      chartDurationSeconds,
      span,
      chartCoverageStartSeconds,
    ))
  }, [chartCoverageStartSeconds, chartDurationSeconds, hasFullRollups, pinOffsetSeconds, pinRollup])
  const chartIsFullRange = chartAtAvailableRange && chartCoverageStartSeconds <= 5
  const chartRangeStatus = chartIsFullRange
    ? 'Full stream'
    : chartAtAvailableRange
      ? `Available coverage · from ${formatHeatOffset(chartCoverageStartSeconds)}`
      : `Viewing ${formatHeatOffset(chartViewportForRender.startSeconds)} – ${formatHeatOffset(chartViewportForRender.endSeconds)}`
  const chartReadoutMode = readoutRollup && chartHoverOffsetSeconds != null
    && readoutRollup.offsetSeconds !== pinOffsetSeconds
    ? 'preview'
    : pinOffsetSeconds != null
      ? 'selected'
      : readoutRollup
        ? 'preview'
        : 'idle'

  return (
    <div ref={chartInteractionRef} style={styles.block}>
      <StreamActivityChartHeader
        showViewerLegend={showViewerStrip}
        focusedSeriesKey={focusedSeriesKey}
        onToggleSeriesFocus={toggleSeriesFocus}
        leadingControl={
          <button
            type="button"
            className={`pulse-chart-toggle-btn${showPeakMarkers ? ' pulse-chart-toggle-btn-active' : ''}`}
            style={{
              ...styles.expandButton,
              ...(showPeakMarkers ? styles.expandButtonActive : null),
            }}
            data-chart-action="true"
            data-chart-moment-toggle="true"
            disabled={chartPeakMarkers.length === 0}
            aria-pressed={showPeakMarkers}
            aria-label={showPeakMarkers ? 'Hide spike markers' : 'Show spike markers'}
            title={chartPeakMarkers.length > 0
              ? `${chartPeakMarkerVisibleCount} of ${chartPeakMarkers.length} ranked recap moments in this range`
              : 'No backend spikes are available yet'}
            onClick={() => setShowPeakMarkers(current => !current)}
          >
            Spikes{chartPeakMarkers.length > 0 ? ` · ${chartPeakMarkerVisibleCount}` : ''}
          </button>
        }
        expandControl={
          <button
            type="button"
            className={`pulse-chart-expand-btn${tracesExpanded ? ' pulse-chart-expand-btn-active' : ''}`}
            style={{
              ...styles.expandButton,
              ...(tracesExpanded ? styles.expandButtonActive : null),
            }}
            onClick={() => {
              if (tracesExpanded) {
                setFocusedSeriesKey(null)
                chartExpansion.reset()
              } else {
                chartExpansion.expand()
              }
            }}
            aria-expanded={tracesExpanded}
            aria-controls={chartRegionId}
            aria-label={tracesExpanded ? 'Reset stream activity chart' : 'Expand stream activity chart'}
          >
            {tracesExpanded ? 'Reset' : 'Expand'}
          </button>
        }
        overlayLegend={
          hasPlottedEmotes ? (
            <>
              {selectedEmotesForOverlay.map((emote, index) => {
                const key = emoteSelectionKey(emote)
                const plotColor = emoteOverlays[index]?.color ?? '#fb7185'
                const overlayKey = emoteOverlays[index]?.key ?? key
                const isFocused = focusedSeriesKey === overlayKey
                const isDimmed = focusedSeriesKey != null && !isFocused
                return (
                  <button
                    key={key}
                    type="button"
                    className="pulse-chart-overlay-legend-chip"
                    data-chart-action="true"
                    style={{
                      ...styles.overlayLegendChip,
                      borderColor: plotColor,
                      boxShadow: `inset 2px 0 0 ${plotColor}`,
                      opacity: isDimmed ? 0.4 : 1,
                    }}
                    aria-label={emote.name}
                    aria-pressed={isFocused}
                    title={isFocused ? 'Show all series' : `Highlight ${emote.name}`}
                    onClick={() => toggleSeriesFocus(overlayKey)}
                  >
                    <PulseEmoteImg
                      emote={emote}
                      backendUrl={backendUrl}
                      width={18}
                      height={18}
                      style={styles.overlayLegendEmoteImg}
                    />
                  </button>
                )
              })}
            </>
          ) : undefined
        }
      />

      <div style={styles.chartSurface} data-chart-surface="true">
        <ChartReadoutBand
          mode={chartReadoutMode}
          offsetSeconds={readoutRollup?.offsetSeconds ?? pinOffsetSeconds}
          viewerValue={readoutRollup ? extensionRollupViewerCount(readoutRollup) : null}
          chatValue={readoutRollup?.chatCount}
          emoteValue={readoutRollup ? minuteEmoteTotal(readoutRollup) : null}
          viewerVisible={showViewerStrip}
          topEmotes={readoutEmotes}
          backendUrl={backendUrl}
          emoteScope={readoutEmoteScope}
          onClearSelection={handleClearChartSelection}
        />
        <div style={styles.chartStack}>
          <PulseOverviewChart
            rollups={minuteRollups}
            games={recapGames}
            backendUrl={backendUrl}
            interactionResetKey={`${payload.login}:${payload.streamId ?? payload.vodId ?? ''}`}
            durationSeconds={chartDurationSeconds}
            streamStartedAt={payload.startedAt}
            height={chartHeight}
            chartRegionId={chartRegionId}
            activityExpansionProgress={chartExpansion.progress}
            selectedIndex={pinChartIndex}
            previewIndex={previewChartIndex}
            showViewerStrip={showViewerStrip}
            viewerLaneExpected={payload.isLive || viewerCapabilityExpected}
            viewerPeak={payload.peakViewers ?? null}
            activityExpanded={tracesExpanded}
            normalizeOverlaySeries={hasPlottedEmotes}
            focusedSeriesKey={focusedSeriesKey}
            onFocusedSeriesKeyChange={setFocusedSeriesKey}
            onSelectIndex={handleChartSelect}
            onSelectMoment={handleChartMomentSelect}
            onClearSelection={handleClearChartSelection}
            onHoverOffsetChange={setChartHoverOffsetSeconds}
            viewport={chartViewportForRender}
            coverageStartSeconds={chartCoverageStartSeconds}
            onViewportChange={handleChartViewportChange}
            highlightedGameSegmentKey={highlightedGameSegmentKey}
            overlayLines={emoteOverlays}
            peakMarkers={chartPeakMarkers}
            showPeakMarkers={showPeakMarkers}
            emptyMessage={chartEmpty || 'Loading full stream rollups…'}
            // Full history is enrichment for recap too: keep any recent/partial
            // rollups drawable while the one-shot request is pending or fails.
            loading={(timelineLoading && minuteRollups.length === 0) || (minuteRollups.length === 0 && Boolean(onRequestFullRollups))}
            isLive={false}
          />
        </div>
      </div>
        {chartRailVisible ? (
          <ChartViewportControls
            viewport={chartViewportForRender}
            durationSeconds={chartDurationSeconds}
            coverageStartSeconds={chartCoverageStartSeconds}
            rangeLabel={chartRangeStatus}
            coverageHint={rollupSinceHint}
            selectedOffsetSeconds={pinOffsetSeconds}
            onViewportChange={handleChartViewportChange}
            onReturnToSelected={returnToSelected}
            onZoomIn={() => changeChartZoom('in')}
            onZoomOut={() => changeChartZoom('out')}
            onReset={resetChartViewport}
            zoomOutDisabled={chartAtAvailableRange}
            resetDisabled={chartAtAvailableRange}
            zoomInDisabled={viewportDurationSeconds(chartViewportForRender) <= Math.min(MIN_VIEWPORT_SECONDS, Math.max(0, chartDurationSeconds - chartCoverageStartSeconds))}
          />
        ) : null}

      {topEmotesForPicker.length > 0 ? (
        <div data-chart-action="true">
          <SevenTvEmotePanel
            expanded={emotePanelExpanded}
            onToggleExpanded={() => setEmotePanelExpanded(open => !open)}
            backendUrl={backendUrl}
            rollups={minuteRollups}
            topEmotes={topEmotesForPicker}
            selectedKeys={selectedEmoteKeys}
            onToggleEmote={toggleEmotePlot}
            onClearPlots={() => setSelectedEmoteKeys([])}
            selectedOffsetSeconds={pinRollup?.offsetSeconds ?? null}
            sidebarCompact
            selectedPlotColors={selectedPlotColors}
            maxSelected={MAX_PLOTTED_EMOTES}
            rollupsLoading={timelineLoadingFlag}
          />
        </div>
      ) : null}

      {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  block: { display: 'grid', gap: 6 },
  chartSurface: { minWidth: 0, width: '100%' },
  chartStack: { display: 'grid', gap: 0 },
  expandButton: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.03em',
    padding: '4px 8px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  expandButtonActive: {
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(167, 139, 250, 0.35)',
    color: '#ddd6fe',
  },
  overlayLegendChip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    display: 'inline-flex',
    flexShrink: 0,
    padding: '2px 5px',
  },
  overlayLegendEmoteImg: { display: 'block', objectFit: 'contain' },
  gapNotice: { color: theme.textMuted, fontSize: 10, fontWeight: 600, lineHeight: 1.4, margin: 0 },
}
