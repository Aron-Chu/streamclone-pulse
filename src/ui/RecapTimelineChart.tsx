import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { deriveLiveStats, formatHeatOffset, toLiveStatsInputFromExtension, type LiveHeatPoint } from '@streampulse/pulse-core'
import type { ExtensionEmote, PulsePayload } from '../shared/messages.ts'
import {
  aggregateChartEmotes,
  buildEmoteOverlaySeries,
  chartEmptyMessage,
  describeRollupGap,
  emoteSelectionKey,
  findChartIndexByOffset,
  fullRollupsMissingStreamPrefix,
  hasFullTimelineRollups,
  MAX_PLOTTED_EMOTES,
  PLOT_PICKER_EMOTE_LIMIT,
  pruneUnavailableEmoteSelections,
  toggleEmotePlotKeys,
} from './chatActivityEmotes.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'
import { downsampleRollupsForChart } from './extensionChartPoints.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { PulseOverviewChart } from './PulseOverviewChart.tsx'
import { pickRecapRollups } from './recapMomentMetrics.ts'
import { zeroFillRollupsForRecap } from './recapChartPrep.ts'
import { mergeRecapMoments, recapStreamDurationSeconds, resolveRecapPointFromRollup } from './recapChartPeaks.ts'
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { StreamActivityChartHeader } from './StreamActivityChartHeader.tsx'
import { theme } from './theme.ts'
import { useChartExpansion } from './motion/useChartExpansion.ts'

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
  onRequestFullRollups?: () => Promise<void>
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
  onRequestFullRollups,
}: RecapTimelineChartProps) {
  const hasFullRollups = hasFullTimelineRollups(payload)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const fullTimelineRequestedRef = useRef(false)
  const onRequestFullRollupsRef = useRef(onRequestFullRollups)
  const chartIdentity = `${payload.login}:${payload.streamId ?? ''}:${payload.vodId ?? ''}:${payload.startedAt ?? ''}`
  onRequestFullRollupsRef.current = onRequestFullRollups

  const currentOffsetSeconds = useMemo(
    () => recapStreamDurationSeconds(payload),
    [payload],
  )

  const minuteRollups = useMemo(() => {
    const source = pickRecapRollups(payload)
    if (source.length === 0) return []
    if (currentOffsetSeconds <= 60) return source
    return zeroFillRollupsForRecap(source, 0, currentOffsetSeconds)
  }, [payload, currentOffsetSeconds])

  const displayRollups = useMemo(
    () => downsampleRollupsForChart(minuteRollups),
    [minuteRollups],
  )

  const chartOffsets = useMemo(
    () => displayRollups.map(rollup => rollup.offsetSeconds),
    [displayRollups],
  )

  const mergedMoments = useMemo(
    () => mergeRecapMoments(payload.recap, payload.peaks, 20, pickRecapRollups(payload)),
    [payload.peaks, payload.recap],
  )

  const stats = deriveLiveStats(toLiveStatsInputFromExtension(payload))
  const chartEmpty = chartEmptyMessage({
    rollupCount: minuteRollups.length,
    chartWindow: 'full',
    hasFullRollups,
    confidence: stats.confidence,
    currentOffsetSeconds,
  })
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
        ? buildEmoteOverlaySeries(displayRollups, selectedEmotesForOverlay, minuteRollups)
        : [],
    [displayRollups, minuteRollups, selectedEmotesForOverlay],
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

  const pinRollup = pinChartIndex != null ? displayRollups[pinChartIndex] : undefined
  const previewRollup = previewChartIndex != null ? displayRollups[previewChartIndex] : undefined

  const readoutRollup = useMemo(() => {
    if (pinRollup) return pinRollup
    if (chartHoverOffsetSeconds != null) {
      return displayRollups.find(rollup => rollup.offsetSeconds === chartHoverOffsetSeconds)
    }
    if (previewRollup) return previewRollup
    return undefined
  }, [chartHoverOffsetSeconds, displayRollups, pinRollup, previewRollup])

  const showChartReadout = Boolean(
    readoutRollup
      && (pinOffsetSeconds != null || chartHoverOffsetSeconds != null || previewOffsetSeconds != null),
  )

  const chartInteractionRef = useRef<HTMLDivElement | null>(null)

  function handleClearChartHover(): void {
    setChartHoverOffsetSeconds(null)
  }

  useEffect(() => {
    fullTimelineRequestedRef.current = false
  }, [chartIdentity])

  useEffect(() => {
    if (
      (hasFullRollups && !fullRollupsMissingStreamPrefix(payload))
      || fullTimelineRequestedRef.current
    ) {
      return
    }
    const request = onRequestFullRollupsRef.current
    if (!request) return
    fullTimelineRequestedRef.current = true
    setTimelineLoading(true)
    void request().finally(() => {
      setTimelineLoading(false)
      fullTimelineRequestedRef.current = false
    })
  }, [hasFullRollups, payload.streamId])

  useEffect(() => {
    setChartHoverOffsetSeconds(null)
    setSelectedEmoteKeys([])
    setFocusedSeriesKey(null)
  }, [chartIdentity])

  useEffect(() => {
    setChartHoverOffsetSeconds(null)
  }, [pinOffsetSeconds])

  function selectPointAtIndex(index: number): void {
    const rollup = displayRollups[index]
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
  }

  function handleChartSelect(index: number): void {
    selectPointAtIndex(index)
    setChartHoverOffsetSeconds(null)
  }

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

  return (
    <div style={styles.block}>
      <StreamActivityChartHeader
        showViewerLegend={showViewerStrip}
        focusedSeriesKey={focusedSeriesKey}
        onToggleSeriesFocus={toggleSeriesFocus}
        rightControl={
          <div style={styles.rangeMetaWrap}>
            <span style={styles.rangeMeta}>Full stream</span>
            {rollupSinceHint ? <span style={styles.rollupSince}>{rollupSinceHint}</span> : null}
          </div>
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
          rollups={displayRollups}
          games={payload.games}
          durationSeconds={currentOffsetSeconds}
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
          highlightedGameSegmentKey={highlightedGameSegmentKey}
          overlayLines={emoteOverlays}
          emptyMessage={chartEmpty || 'Loading full stream rollups…'}
          loading={timelineLoading || (minuteRollups.length === 0 && Boolean(onRequestFullRollups))}
          isLive={false}
        />
      </div>

      {topEmotesForPicker.length > 0 ? (
        <SevenTvEmotePanel
          backendUrl={backendUrl}
          rollups={minuteRollups}
          topEmotes={topEmotesForPicker}
          selectedKeys={selectedEmoteKeys}
          onToggleEmote={toggleEmotePlot}
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
  rangeMetaWrap: { display: 'grid', gap: 2, justifyItems: 'end' },
  rangeMeta: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  rollupSince: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 1.3,
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
