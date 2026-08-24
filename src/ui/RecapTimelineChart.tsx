import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { deriveLiveStats, formatHeatOffset, toLiveStatsInputFromExtension, type LiveHeatPoint } from '@streampulse/pulse-core'
import type { ExtensionEmote, PulsePayload } from '../shared/messages.ts'
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
  emoteSelectionKey,
  findChartIndexByOffset,
  fullRollupsMissingStreamPrefix,
  MAX_PLOTTED_EMOTES,
  PLOT_PICKER_EMOTE_LIMIT,
  pruneUnavailableEmoteSelections,
  toggleEmotePlotKeys,
} from './chatActivityEmotes.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'
import { safeGameTimeline } from './extensionChartAdapter.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { PulseOverviewChart } from './PulseOverviewChart.tsx'
import { pickRecapRollups } from './recapMomentMetrics.ts'
import { zeroFillRollupsForRecap } from './recapChartPrep.ts'
import { mergeRecapMoments, recapStreamDurationSeconds, resolveRecapPointFromRollup } from './recapChartPeaks.ts'
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { StreamActivityChartHeader } from './StreamActivityChartHeader.tsx'
import { theme } from './theme.ts'
import { useChartExpansion } from './motion/useChartExpansion.ts'
import { ChartPositionRail, shouldShowChartRail } from './ChartPositionRail.tsx'
import {
  clampViewportToCoverage,
  MIN_VIEWPORT_SECONDS,
  resolveViewport,
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

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function RecapTimelineChart({
  payload,
  backendUrl,
  peakOffsets: _peakOffsets,
  catalog,
  pinOffsetSeconds = null,
  previewOffsetSeconds = null,
  sidebarFill: _sidebarFill = false,
  highlightedGameSegmentKey = null,
  onSelectPoint,
  onClearSelection,
  onRequestFullRollups,
}: RecapTimelineChartProps) {
  const activation = makeFullHistoryActivation(payload)
  const activationKey = fullHistoryActivationKey(activation)
  const hasFullRollups = hasValidatedFullHistory(payload, activation)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const fullTimelineRequestedRef = useRef(false)
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
    return zeroFillRollupsForRecap(source, 0, currentOffsetSeconds)
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
  const showViewerStrip = minuteRollups.some(rollup => (rollup.viewerCount ?? 0) > 0)
  const chartCoverageStartSeconds = Math.max(
    0,
    payload.coverageStartOffsetSeconds ?? payload.coverage?.coverageStartOffsetSeconds ?? 0,
    sourceRollups[0]?.offsetSeconds ?? 0,
  )
  const [chartViewport, setChartViewport] = useState<ChartViewport>(() => resolveViewport({
    durationSeconds: chartDurationSeconds,
    zoomSeconds: 'full',
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
    if (pinRollup) return pinRollup
    if (chartHoverOffsetSeconds != null) {
      return minuteRollups.find(rollup => rollup.offsetSeconds === chartHoverOffsetSeconds)
    }
    if (previewRollup) return previewRollup
    return undefined
  }, [chartHoverOffsetSeconds, minuteRollups, pinRollup, previewRollup])

  const showChartReadout = Boolean(
    readoutRollup
      && (pinOffsetSeconds != null || chartHoverOffsetSeconds != null || previewOffsetSeconds != null),
  )

  const chartInteractionRef = useRef<HTMLDivElement | null>(null)

  const handleClearChartHover = useCallback((): void => {
    setChartHoverOffsetSeconds(null)
    onClearSelection?.()
  }, [onClearSelection])

  useEffect(() => {
    fullTimelineRequestedRef.current = false
  }, [chartIdentity])

  useEffect(() => {
    if (hasFullRollups || fullTimelineRequestedRef.current) return
    if (!hasStableFullHistoryActivation(activation)) return
    const request = onRequestFullRollupsRef.current
    if (!request) return
    fullTimelineRequestedRef.current = true
    setTimelineLoading(true)
    void request().finally(() => setTimelineLoading(false))
  }, [activation, activationKey, hasFullRollups])

  useEffect(() => {
    setChartHoverOffsetSeconds(null)
    setSelectedEmoteKeys([])
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

    onSelectPoint(
      resolveRecapPointFromRollup({
        rollup,
        moments: mergedMoments,
        catalog,
        startedAt: payload.startedAt,
        rollups: minuteRollups,
        peaks: payload.peaks,
      }),
    )
  }, [catalog, mergedMoments, minuteRollups, onSelectPoint, payload.peaks, payload.startedAt])

  const handleChartSelect = useCallback((index: number): void => {
    selectPointAtIndex(index)
    setChartHoverOffsetSeconds(null)
  }, [selectPointAtIndex])

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
  }, [chartCoverageStartSeconds, chartDurationSeconds, chartViewportForRender, handleChartViewportChange])

  const resetChartViewport = useCallback((): void => {
    handleChartViewportChange(resolveViewport({
      durationSeconds: chartDurationSeconds,
      zoomSeconds: 'full',
      coverageStartSeconds: chartCoverageStartSeconds,
    }))
  }, [chartCoverageStartSeconds, chartDurationSeconds, handleChartViewportChange])

  const chartRailVisible = shouldShowChartRail(chartViewportForRender, chartDurationSeconds)
  const chartAtAvailableRange = chartViewportForRender.startSeconds <= chartCoverageStartSeconds + 5
    && chartViewportForRender.endSeconds >= chartDurationSeconds - 5
  const chartIsFullRange = chartAtAvailableRange && chartCoverageStartSeconds <= 5
  const chartRangeStatus = chartIsFullRange
    ? 'Full stream'
    : chartAtAvailableRange
      ? `Available coverage · from ${formatHeatOffset(chartCoverageStartSeconds)}`
      : `Viewing ${formatHeatOffset(chartViewportForRender.startSeconds)} – ${formatHeatOffset(chartViewportForRender.endSeconds)}`

  return (
    <div style={styles.block}>
      <StreamActivityChartHeader
        showViewerLegend={showViewerStrip}
        focusedSeriesKey={focusedSeriesKey}
        onToggleSeriesFocus={toggleSeriesFocus}
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

      <div ref={chartInteractionRef} style={styles.chartStack}>
        {showChartReadout && readoutRollup ? (
          <p style={styles.readout} aria-live="polite">
            <span style={styles.readoutTime}>
              {formatHeatOffset(pinOffsetSeconds ?? readoutRollup.offsetSeconds)}
            </span>
            <span style={styles.readoutSep}>·</span>
            <span>chat {formatCompactNumber(readoutRollup.chatCount ?? 0)}/min</span>
            <span style={styles.readoutSep}>·</span>
            <span>emotes {formatCompactNumber(minuteEmoteTotal(readoutRollup))}/min</span>
          </p>
        ) : null}
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
          activityExpanded={tracesExpanded}
          normalizeOverlaySeries={hasPlottedEmotes}
          focusedSeriesKey={focusedSeriesKey}
          onFocusedSeriesKeyChange={setFocusedSeriesKey}
          onSelectIndex={handleChartSelect}
          onClearSelection={handleClearChartHover}
          clearSelectionBoundaryRef={chartInteractionRef}
          onHoverOffsetChange={setChartHoverOffsetSeconds}
          viewport={chartViewportForRender}
          coverageStartSeconds={chartCoverageStartSeconds}
          onViewportChange={handleChartViewportChange}
          highlightedGameSegmentKey={highlightedGameSegmentKey}
          overlayLines={emoteOverlays}
          emptyMessage={chartEmpty || 'Loading full stream rollups…'}
          // Full history is enrichment for recap too: keep any recent/partial
          // rollups drawable while the one-shot request is pending or fails.
          loading={(timelineLoading && minuteRollups.length === 0) || (minuteRollups.length === 0 && Boolean(onRequestFullRollups))}
          isLive={false}
        />
        <div style={styles.chartViewportControls} data-chart-viewport-controls>
          <div style={styles.chartViewportMeta} data-chart-viewport-meta>
            <div style={styles.chartViewportMetaRow}>
              <span style={styles.chartRangeStatus} data-chart-visible-range aria-live="polite">
                {chartRangeStatus}
              </span>
              {rollupSinceHint ? <span style={styles.rollupSince}>{rollupSinceHint}</span> : null}
            </div>
          </div>
          {chartRailVisible ? (
            <div style={styles.chartViewportRailRow}>
              <div style={styles.chartRailRow}>
                <ChartPositionRail
                  viewport={chartViewportForRender}
                  durationSeconds={chartDurationSeconds}
                  onViewportChange={handleChartViewportChange}
                  coverageStartSeconds={chartCoverageStartSeconds}
                  ariaLabel="Recap chart zoom and position"
                  hideRangeLabel
                />
              </div>
              <div style={styles.chartZoomControls} aria-label="Recap chart zoom controls">
                <button
                  type="button"
                  data-chart-zoom-out
                  style={styles.chartZoomButton}
                  disabled={viewportDurationSeconds(chartViewportForRender) >= Math.max(0, chartDurationSeconds - chartCoverageStartSeconds) - 5}
                  aria-label="Zoom out recap chart"
                  onClick={() => changeChartZoom('out')}
                >
                  −
                </button>
                <button
                  type="button"
                  data-chart-zoom-reset
                  style={styles.chartZoomReset}
                  disabled={chartAtAvailableRange}
                  onClick={resetChartViewport}
                >
                  Reset
                </button>
                <button
                  type="button"
                  data-chart-zoom-in
                  style={styles.chartZoomButton}
                  disabled={viewportDurationSeconds(chartViewportForRender) <= Math.min(MIN_VIEWPORT_SECONDS, Math.max(0, chartDurationSeconds - chartCoverageStartSeconds))}
                  aria-label="Zoom in recap chart"
                  onClick={() => changeChartZoom('in')}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {topEmotesForPicker.length > 0 ? (
        <SevenTvEmotePanel
          expanded={emotePanelExpanded}
          onToggleExpanded={() => setEmotePanelExpanded(open => !open)}
          backendUrl={backendUrl}
          rollups={minuteRollups}
          topEmotes={topEmotesForPicker}
          selectedKeys={selectedEmoteKeys}
          onToggleEmote={toggleEmotePlot}
          selectedOffsetSeconds={pinRollup?.offsetSeconds ?? null}
          sidebarCompact
          selectedPlotColors={selectedPlotColors}
          maxSelected={MAX_PLOTTED_EMOTES}
          rollupsLoading={timelineLoadingFlag}
        />
      ) : null}

      {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  block: { display: 'grid', gap: 6 },
  chartStack: { display: 'grid', gap: 0 },
  chartViewportControls: {
    display: 'grid',
    gap: 4,
    marginTop: 4,
    minWidth: 0,
  },
  chartViewportMeta: { display: 'grid', gap: 2, minWidth: 0 },
  chartViewportMetaRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    minHeight: 14,
    minWidth: 0,
  },
  chartRangeStatus: {
    color: theme.textMuted,
    flex: '1 1 auto',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.03em',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  chartViewportRailRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    minWidth: 0,
  },
  chartRailRow: { flex: '1 1 auto', minWidth: 0 },
  chartZoomControls: { alignItems: 'center', display: 'inline-flex', gap: 4, flexShrink: 0 },
  chartZoomButton: {
    alignItems: 'center',
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(167, 139, 250, 0.32)',
    borderRadius: 6,
    color: '#ddd6fe',
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 900,
    height: 24,
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
    width: 24,
  },
  chartZoomReset: {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 800,
    height: 24,
    padding: '0 7px',
  },
  rollupSince: {
    color: theme.textMuted,
    flex: '0 0 auto',
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  readout: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.4,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  readoutTime: { color: theme.textPrimary, fontWeight: 800 },
  readoutSep: { color: theme.textMuted, margin: '0 4px' },
  toolbarHint: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 700,
  },
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
