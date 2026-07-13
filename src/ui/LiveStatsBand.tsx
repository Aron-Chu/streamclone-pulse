import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  deriveLiveStats,
  formatHeatOffset,
  toLiveStatsInputFromExtension,
  trendArrowGlyph,
  type LiveConfidenceState,
  type LiveHeatPoint,
  type LiveStats,
  type TrendDirection,
} from '@streampulse/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import { getDefaultChartWindow, migrateDefaultChartWindowToFullOnce } from '../shared/storage.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { GamesPlayedStrip } from './GamesPlayedStrip.tsx'
import { PulseOverviewChart } from './PulseOverviewChart.tsx'
import {
  aggregateChartEmotes,
  buildEmoteOverlaySeries,
  CHART_WINDOW_OPTIONS,
  chartEmptyMessage,
  chartTimelineWindowLabel,
  chartWindowNeedsFullFetch,
  describeRollupGap,
  emoteAveragesFromRollups,
  emoteSelectionKey,
  findChartIndexByOffset,
  fullRollupsMissingStreamPrefix,
  hasFullTimelineRollups,
  MAX_PLOTTED_EMOTES,
  PLOT_PICKER_EMOTE_LIMIT,
  prepareChartRollups,
  toggleEmotePlotKeys,
  type ChartTimelineWindow,
} from './chatActivityEmotes.ts'
import { downsampleRollupsForChart } from './extensionChartPoints.ts'
import {
  chartHighlightedGameKey,
  chartVisibleRangeFromRollups,
  extensionGamesForOverviewChart,
} from './extensionChartAdapter.ts'
import { firstViewerOffsetSeconds, firstActiveRollupOffset, minuteEmoteTotal } from './chartRollupUtils.ts'
import { LiveMetricIcon } from './liveMetricIcons.tsx'
import { emoteSyncStatusLabel, emoteSyncStatusTone } from './emoteSync.ts'
import { overlayTextLinkButton } from './momentReasonStyles.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { StreamActivityChartHeader } from './StreamActivityChartHeader.tsx'
import { theme } from './theme.ts'
import { resolveCoverageStartHint } from './coverageStartHint.ts'

export interface LiveStatsBandProps {
  payload: PulsePayload
  backendUrl: string
  sidebarFill?: boolean
  compact?: boolean
  coverageStartOffsetSeconds?: number
  currentOffsetSeconds?: number
  isLive?: boolean
  fullTimeline?: boolean
  showLoadFromStart?: boolean
  loadFromStartBusy?: boolean
  onLoadFromStart?: () => void
  onJumpToOffset?: (offsetSeconds: number) => void
  onOpenAnalytics?: (offsetSeconds: number) => void
  onOpenFullAnalytics?: () => void
  onRequestFullTimeline?: () => Promise<void>
  onChartWindowChange?: (window: ChartTimelineWindow) => void
  onPinOffset?: (offsetSeconds: number | null) => void
  onSaveMoment?: (point: LiveHeatPoint) => void
  saveMomentBusy?: boolean
  pinOffsetSeconds?: number | null
  previewOffsetSeconds?: number | null
  hasVodContext?: boolean
  coverageTier?: string | null
  /** Marketing landing — read-only panel with no navigation or chart pinning. */
  demoMode?: boolean
}

const CONFIDENCE_STYLES: Record<
  LiveConfidenceState,
  { background: string; border: string; color: string }
> = {
  Synced: {
    background: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(52, 211, 153, 0.3)',
    color: '#6ee7b7',
  },
  Collecting: {
    background: 'rgba(139, 92, 246, 0.15)',
    border: 'rgba(167, 139, 250, 0.3)',
    color: '#c4b5fd',
  },
  'Waiting for first minute': {
    background: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(251, 191, 36, 0.3)',
    color: '#fcd34d',
  },
  'Stats only': {
    background: 'rgba(113, 113, 122, 0.15)',
    border: 'rgba(161, 161, 170, 0.3)',
    color: '#d4d4d8',
  },
}

function formatSignedDelta(delta: number | null): string {
  if (delta === null) return '-'
  if (delta === 0) return '0'
  return delta > 0 ? `+${delta.toLocaleString()}` : `-${Math.abs(delta).toLocaleString()}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function useCountUp(value: number, duration = 420): number {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const startRef = useRef(0)

  useEffect(() => {
    fromRef.current = display
    startRef.current = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration)
      const eased = 1 - (1 - t) ** 3
      setDisplay(Math.round(fromRef.current + (value - fromRef.current) * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return display
}

function AnimatedMetric({
  value,
  format,
  valueStyle,
}: {
  value: number
  format?: (value: number) => string
  valueStyle?: CSSProperties
}) {
  const animated = useCountUp(value)
  return (
    <span style={{ ...styles.metricValue, ...valueStyle }}>
      {format ? format(animated) : formatNumber(animated)}
    </span>
  )
}

function TrendArrow({ trend }: { trend: TrendDirection }) {
  const color = trend === 'up' ? '#34d399' : trend === 'down' ? '#f87171' : theme.textMuted
  return (
    <span style={{ ...styles.trendArrow, color }} aria-hidden>
      {trendArrowGlyph(trend)}
    </span>
  )
}

export function LiveStatsBand({
  payload,
  backendUrl,
  sidebarFill = false,
  compact = false,
  coverageStartOffsetSeconds = 0,
  currentOffsetSeconds = 0,
  isLive = false,
  fullTimeline = false,
  showLoadFromStart = false,
  loadFromStartBusy = false,
  onLoadFromStart,
  onJumpToOffset,
  onOpenAnalytics,
  onOpenFullAnalytics,
  onRequestFullTimeline,
  onChartWindowChange,
  onPinOffset,
  onSaveMoment,
  saveMomentBusy = false,
  pinOffsetSeconds = null,
  previewOffsetSeconds = null,
  hasVodContext = false,
  coverageTier = null,
  demoMode = false,
}: LiveStatsBandProps) {
  const chartInteractionRef = useRef<HTMLDivElement | null>(null)
  const stats: LiveStats = deriveLiveStats(toLiveStatsInputFromExtension(payload))
  const confidenceStyle = CONFIDENCE_STYLES[stats.confidence]
  const hasFullRollups = hasFullTimelineRollups(payload)
  const [chartWindow, setChartWindow] = useState<ChartTimelineWindow>('full')
  const [timelineLoading, setTimelineLoading] = useState(false)
  const fullTimelineRequestedRef = useRef(false)
  /** After the user picks a range, ignore late async default hydration for this stream. */
  const chartWindowUserPickedRef = useRef(false)
  const sparklineBlockRef = useRef<HTMLDivElement | null>(null)
  const onRequestFullTimelineRef = useRef(onRequestFullTimeline)
  onRequestFullTimelineRef.current = onRequestFullTimeline

  useEffect(() => {
    chartWindowUserPickedRef.current = false
  }, [payload.streamId])

  useEffect(() => {
    if (demoMode) {
      setChartWindow('60m')
      return
    }
    let mounted = true
    void (async () => {
      try {
        // One-time: legacy sticky windows → Full stream (poll stays recent).
        await migrateDefaultChartWindowToFullOnce()
        const window = await getDefaultChartWindow()
        if (!mounted) return
        // First click Full→30m was getting overwritten when this async finished.
        if (chartWindowUserPickedRef.current) return
        if (fullTimeline) {
          setChartWindow('full')
          return
        }
        // Default product range is Full stream (live poll stays recent; Full is chart UI only).
        setChartWindow(window)
      } catch {
        // Storage denied / extension context invalidated — keep in-memory default.
      }
    })()
    return () => {
      mounted = false
    }
  }, [payload.streamId, payload.login, fullTimeline, demoMode])

  const rollups = useMemo(
    () =>
      prepareChartRollups(payload, {
        chartWindow,
        currentOffsetSeconds,
        coverageStartOffsetSeconds,
      }),
    [payload, chartWindow, currentOffsetSeconds, coverageStartOffsetSeconds],
  )
  const displayRollups = useMemo(() => downsampleRollupsForChart(rollups), [rollups])
  const chartOffsets = useMemo(
    () => displayRollups.map(rollup => rollup.offsetSeconds),
    [displayRollups],
  )
  const rollupGapNotice = chartWindow === 'full' && hasFullRollups ? describeRollupGap(rollups) : null
  const awaitingFullRollups =
    chartWindowNeedsFullFetch(chartWindow, payload, currentOffsetSeconds)
    && (!hasFullRollups || fullRollupsMissingStreamPrefix(payload))
  // Only block the chart while a full-timeline request is in flight, or when we
  // have nothing provisional to draw. Never stay on "Loading timeline…" forever
  // if window=full returns without fullRollups (mock / degraded BFF).
  const chartLoading = timelineLoading || (awaitingFullRollups && rollups.length === 0)
  const chartEmpty = chartEmptyMessage({
    rollupCount: rollups.length,
    chartWindow,
    hasFullRollups,
    confidence: stats.confidence,
    currentOffsetSeconds,
    awaitingFullRollups,
  })
  const canShowFullTimeline = hasFullRollups || fullTimeline || currentOffsetSeconds > 0
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)

  useEffect(() => {
    if (!fullTimeline) return
    // Only force Full when the user has not already chosen another range.
    if (chartWindowUserPickedRef.current) return
    setChartWindow('full')
  }, [fullTimeline])

  const handleChartWindowChange = (window: ChartTimelineWindow): void => {
    chartWindowUserPickedRef.current = true
    setChartWindow(window)
    onChartWindowChange?.(window)
  }

  useEffect(() => {
    fullTimelineRequestedRef.current = false
    setHoveredGameKey(null)
  }, [payload.streamId, chartWindow])

  useEffect(() => {
    if (!chartWindowNeedsFullFetch(chartWindow, payload, currentOffsetSeconds)) {
      return
    }
    if (
      (hasFullRollups && !fullRollupsMissingStreamPrefix(payload))
      || fullTimelineRequestedRef.current
    ) {
      return
    }
    const request = onRequestFullTimelineRef.current
    if (!request) return
    fullTimelineRequestedRef.current = true
    setTimelineLoading(true)
    void request().finally(() => {
      setTimelineLoading(false)
      fullTimelineRequestedRef.current = false
    })
  }, [chartWindow, currentOffsetSeconds, hasFullRollups, payload])

  useEffect(() => {
    onPinOffset?.(null)
  }, [payload.streamId, onPinOffset])

  const pinChartIndex = useMemo(() => {
    if (pinOffsetSeconds == null) return null
    return findChartIndexByOffset(chartOffsets, pinOffsetSeconds, {
      bucketed: chartWindow === 'full',
    })
  }, [pinOffsetSeconds, chartOffsets, chartWindow])

  const previewChartIndex = useMemo(() => {
    if (previewOffsetSeconds == null) return null
    return findChartIndexByOffset(chartOffsets, previewOffsetSeconds, {
      bucketed: chartWindow === 'full',
    })
  }, [previewOffsetSeconds, chartOffsets, chartWindow])

  const previewRollup =
    previewChartIndex != null ? displayRollups[previewChartIndex] : undefined

  const selectedRollup =
    pinChartIndex != null ? displayRollups[pinChartIndex] : undefined

  const minuteAtRollup = useMemo(() => {
    if (selectedRollup) return selectedRollup
    if (chartHoverOffsetSeconds != null) {
      return displayRollups.find(rollup => rollup.offsetSeconds === chartHoverOffsetSeconds)
    }
    if (previewRollup) return previewRollup
    return undefined
  }, [selectedRollup, chartHoverOffsetSeconds, displayRollups, previewRollup])

  const minuteAtOffsetSeconds = minuteAtRollup?.offsetSeconds ?? 0
  const showChartReadout = Boolean(
    minuteAtRollup && (pinOffsetSeconds != null || chartHoverOffsetSeconds != null),
  )

  useEffect(() => {
    if (pinChartIndex != null) {
      setEmotePanelExpanded(false)
    }
  }, [pinChartIndex])

  const topEmotesForChips = useMemo(() => {
    const fromRollups = aggregateChartEmotes(rollups, PLOT_PICKER_EMOTE_LIMIT)
    if (fromRollups.length > 0) return fromRollups
    return (payload.topEmotes?.length ? payload.topEmotes : stats.topEmotes).slice(0, PLOT_PICKER_EMOTE_LIMIT)
  }, [payload.topEmotes, rollups, stats.topEmotes])

  const selectedEmotesForOverlay = useMemo(
    () =>
      topEmotesForChips.filter(emote => selectedEmoteKeys.includes(emoteSelectionKey(emote))),
    [topEmotesForChips, selectedEmoteKeys],
  )
  const emoteOverlays = useMemo(
    () =>
      selectedEmotesForOverlay.length > 0
        ? buildEmoteOverlaySeries(displayRollups, selectedEmotesForOverlay, rollups)
        : [],
    [displayRollups, rollups, selectedEmotesForOverlay],
  )

  const selectedPlotColors = useMemo(() => {
    const map: Record<string, string> = {}
    selectedEmotesForOverlay.forEach((emote, index) => {
      map[emoteSelectionKey(emote)] = emoteOverlays[index]?.color ?? '#fb7185'
    })
    return map
  }, [selectedEmotesForOverlay, emoteOverlays])

  useEffect(() => {
    if (selectedEmotesForOverlay.length > 0) {
      setActivityExpanded(true)
    }
  }, [selectedEmotesForOverlay.length])

  const toggleSeriesFocus = useCallback((seriesKey: string) => {
    setFocusedSeriesKey(current => (current === seriesKey ? null : seriesKey))
  }, [])

  const emoteSyncTone = emoteSyncStatusTone(payload.emoteSync)
  const emoteAvg5m = emoteAveragesFromRollups(rollups, 5)
  const emoteSyncStyle =
    emoteSyncTone === 'ok'
      ? { color: '#6ee7b7' }
      : emoteSyncTone === 'warn'
        ? { color: '#fcd34d' }
        : { color: theme.textMuted }

  const emoteSyncLabel = emoteSyncStatusLabel(payload.emoteSync)
  const selectedOffsetSeconds = selectedRollup?.offsetSeconds ?? null

  const chartGames = useMemo(
    () => extensionGamesForOverviewChart(payload.games, payload.category, currentOffsetSeconds),
    [payload.games, payload.category, currentOffsetSeconds],
  )

  const visibleRange = useMemo(
    () => chartVisibleRangeFromRollups(displayRollups),
    [displayRollups],
  )

  const chartHighlightedGameKeyValue = useMemo(
    () => chartHighlightedGameKey(hoveredGameKey, chartGames, currentOffsetSeconds, visibleRange),
    [hoveredGameKey, chartGames, currentOffsetSeconds, visibleRange],
  )

  function handleChartSelect(index: number): void {
    const rollup = displayRollups[index]
    if (!rollup || rollup.missing) return
    setSelectedEmoteKeys([])
    setFocusedSeriesKey(null)
    onPinOffset?.(rollup.offsetSeconds)
    setChartHoverOffsetSeconds(null)
  }

  function handleClearChartSelection(): void {
    onPinOffset?.(null)
    setChartHoverOffsetSeconds(null)
  }

  const chartHeight = sidebarFill ? 216 : 184

  const metricsStyle = sidebarFill
    ? { ...styles.metrics, ...styles.metricsSidebar }
    : compact
      ? { ...styles.metrics, ...styles.metricsCompact }
      : styles.metrics

  function toggleEmotePanelKey(emote: (typeof topEmotesForChips)[number]): void {
    const key = emoteSelectionKey(emote)
    setSelectedEmoteKeys(current => toggleEmotePlotKeys(current, key, MAX_PLOTTED_EMOTES))
  }

  const emoteMetaLine = (() => {
    if (stats.hasProviderSplit) {
      return stats.emoteProviderRates
        .map(rate => `${rate.provider === 'Other' ? 'Other' : rate.provider} ${formatNumber(rate.perMinute)}`)
        .join(' · ')
    }
    if (emoteAvg5m.minutes > 0) {
      const avg = `${formatNumber(emoteAvg5m.sevenTvPerMin)} 7TV avg · 5m`
      return emoteAvg5m.totalPerMin !== emoteAvg5m.sevenTvPerMin
        ? `${avg} · ${formatNumber(emoteAvg5m.totalPerMin)} total`
        : avg
    }
    return 'No emotes this minute'
  })()
  const emoteChartHint =
    rollups.some(r => (r.totalEmoteCount ?? 0) > 0) && stats.totalEmotePerMin === 0
      ? 'Chart uses full stream; metric is latest minute.'
      : null

  const coverageHint = resolveCoverageStartHint({
    coverageStartOffsetSeconds,
    trackedFromStart: payload.coverage?.trackedFromStart,
    canBackfill: payload.coverage?.canBackfill,
    coverageTier,
    tracking: payload.tracking,
    isLive,
  })
  const showCoverageStartHint =
    coverageHint.show && (chartWindow === 'full' || !fullTimeline)
  const showViewerStrip = rollups.some(rollup => (rollup.viewerCount ?? 0) > 0)
  const viewerStartOffsetSeconds = Math.max(
    0,
    payload.viewerStartOffsetSeconds ?? firstViewerOffsetSeconds(rollups),
  )
  const lateViewerSamples =
    showViewerStrip
    && viewerStartOffsetSeconds > coverageStartOffsetSeconds + 60
  const firstActivityOffsetSeconds = useMemo(
    () => firstActiveRollupOffset(rollups),
    [rollups],
  )
  const sparseActivityWarmup =
    chartWindow === 'full'
    && firstActivityOffsetSeconds != null
    && firstActivityOffsetSeconds > coverageStartOffsetSeconds + 10 * 60
  const showPartialRangeStatus = chartWindow !== 'full'

  return (
    <PulseSectionCard
      title="Live now"
      titleTone="muted"
      style={{ marginBottom: sidebarFill ? 10 : 14, width: '100%' }}
      meta={
        <span style={styles.headerMeta}>
          {onOpenFullAnalytics && !demoMode ? (
            <button type="button" style={styles.analyticsHeaderLink} onClick={onOpenFullAnalytics}>
              Open full analytics →
            </button>
          ) : null}
          <span
            style={{
              background: confidenceStyle.background,
              border: `1px solid ${confidenceStyle.border}`,
              borderRadius: 999,
              color: confidenceStyle.color,
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
            }}
          >
            {stats.confidence}
          </span>
        </span>
      }
    >
      <div style={metricsStyle}>
        <div style={styles.metric}>
          <span style={styles.metricLabel}>Viewers</span>
          <span style={styles.metricValueRow}>
            <LiveMetricIcon kind="viewers" />
            <AnimatedMetric value={stats.currentViewers} format={formatNumber} valueStyle={sidebarFill ? styles.metricValueSidebar : undefined} />
          </span>
          <span
            style={{
              ...styles.metricMeta,
              color:
                stats.viewerDelta5m === null
                  ? theme.textMuted
                  : stats.viewerDelta5m > 0
                    ? '#34d399'
                    : stats.viewerDelta5m < 0
                      ? '#f87171'
                      : theme.textMuted,
            }}
          >
            {formatSignedDelta(stats.viewerDelta5m)} · 5m
          </span>
        </div>
        <div style={styles.metric}>
          <span style={styles.metricLabel}>Chat / min</span>
          <span style={styles.metricValueRow}>
            <LiveMetricIcon kind="chat" />
            <AnimatedMetric value={stats.chatPerMin1m} format={formatNumber} valueStyle={sidebarFill ? styles.metricValueSidebar : undefined} />
            <TrendArrow trend={stats.chatTrend} />
          </span>
          <span style={styles.metricMeta}>
            {formatNumber(stats.chatPerMin5m)} avg · 5m
          </span>
        </div>
        <div style={styles.metric}>
          <span style={styles.metricLabel}>Emotes / min</span>
          <span style={styles.metricValueRow}>
            <LiveMetricIcon kind="emotes" />
            <AnimatedMetric value={stats.totalEmotePerMin} format={formatNumber} valueStyle={sidebarFill ? styles.metricValueSidebar : undefined} />
          </span>
          <span style={styles.metricMeta}>{emoteMetaLine}</span>
        </div>
      </div>

      {emoteChartHint ? <p style={styles.metricHintBelow}>{emoteChartHint}</p> : null}

      {emoteSyncLabel ? (
        <p style={{ ...styles.emoteSyncNote, ...emoteSyncStyle }}>{emoteSyncLabel}</p>
      ) : null}

      <div ref={sparklineBlockRef} style={styles.sparklineBlock}>
        <GamesPlayedStrip
          games={chartGames}
          durationSeconds={currentOffsetSeconds}
          highlightedKey={hoveredGameKey}
          onHighlightKey={setHoveredGameKey}
          visibleRange={visibleRange}
          plotPadLeft={4}
          plotPadRight={12}
        />
        <div style={styles.chartReadoutSlot}>
          <p
            style={{
              ...styles.chartReadout,
              opacity: showChartReadout ? 1 : 0,
            }}
            aria-live="polite"
            aria-hidden={!showChartReadout}
          >
            <span style={styles.chartReadoutTime}>
              {formatHeatOffset(minuteAtOffsetSeconds)}
            </span>
            <span style={styles.chartReadoutSep}>·</span>
            <span>chat {formatNumber(minuteAtRollup?.chatCount ?? 0)}/min</span>
            <span style={styles.chartReadoutSep}>·</span>
            <span>
              emotes {formatNumber(minuteAtRollup ? minuteEmoteTotal(minuteAtRollup) : 0)}/min
            </span>
          </p>
        </div>
        <div style={styles.chartLeadIn}>
          <StreamActivityChartHeader
            showViewerLegend={showViewerStrip}
            focusedSeriesKey={focusedSeriesKey}
            onToggleSeriesFocus={toggleSeriesFocus}
            expandControl={
              <button
                type="button"
                className={`pulse-chart-expand-btn${activityExpanded ? ' pulse-chart-expand-btn-active' : ''}`}
                style={{
                  ...styles.expandButton,
                  ...(activityExpanded ? styles.expandButtonActive : null),
                }}
                onClick={() => setActivityExpanded(value => !value)}
                aria-pressed={activityExpanded}
              >
                {activityExpanded ? 'Reset' : 'Expand'}
              </button>
            }
            overlayLegend={
              selectedEmotesForOverlay.length > 0 ? (
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
                          ...styles.overlayLegendChipImg,
                          borderColor: plotColor,
                          boxShadow: `inset 2px 0 0 ${plotColor}`,
                          opacity: isDimmed ? 0.4 : 1,
                          cursor: 'pointer',
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
          {(showCoverageStartHint || sparseActivityWarmup || lateViewerSamples || (showLoadFromStart && onLoadFromStart)) ? (
            <p style={styles.timelineHint}>
              {showCoverageStartHint ? (
                <span
                  style={
                    coverageHint.tone === 'warn'
                      ? styles.timelineHintWarn
                      : undefined
                  }
                >
                  {coverageHint.text}
                </span>
              ) : null}
              {showCoverageStartHint && sparseActivityWarmup ? (
                <span style={styles.timelineHintSep}> · </span>
              ) : null}
              {sparseActivityWarmup && firstActivityOffsetSeconds != null ? (
                <span>Activity chart from {formatHeatOffset(firstActivityOffsetSeconds)}</span>
              ) : null}
              {(showCoverageStartHint || sparseActivityWarmup) && lateViewerSamples ? (
                <span style={styles.timelineHintSep}> · </span>
              ) : null}
              {lateViewerSamples ? (
                <span>Viewer samples from {formatHeatOffset(viewerStartOffsetSeconds)}</span>
              ) : null}
              {(showCoverageStartHint || sparseActivityWarmup || lateViewerSamples) ? (
                showLoadFromStart && onLoadFromStart ? (
                  <span style={styles.timelineHintSep}> · </span>
                ) : null
              ) : null}
              {showLoadFromStart && onLoadFromStart ? (
                <button
                  type="button"
                  style={styles.streamStartLink}
                  disabled={loadFromStartBusy}
                  title="Expand the activity chart from stream start and jump the player when a VOD is available."
                  onClick={onLoadFromStart}
                >
                  {loadFromStartBusy ? 'Loading…' : 'Load full stream chart'}
                </button>
              ) : null}
            </p>
          ) : null}
          <div style={styles.chartRangeRow}>
            <PulseThemedSelect
              label="Range"
              value={chartWindow}
              options={CHART_WINDOW_OPTIONS}
              disabled={timelineLoading || demoMode}
              ariaLabel="Chart time range"
              onChange={handleChartWindowChange}
            />
            {showPartialRangeStatus ? (
              <span style={styles.partialRangeHint} aria-live="polite">
                Showing last {chartTimelineWindowLabel(chartWindow)}
                <span style={styles.timelineHintSep}> · </span>
                <button
                  type="button"
                  style={styles.streamStartLink}
                  disabled={timelineLoading || demoMode}
                  title="Show the entire broadcast on the chart (does not change live poll)"
                  onClick={() => handleChartWindowChange('full')}
                >
                  Full stream
                </button>
              </span>
            ) : null}
          </div>
        </div>
        <div ref={chartInteractionRef} style={{ ...styles.chartStack, ...(demoMode ? { pointerEvents: 'none' as const } : undefined) }}>
          <PulseOverviewChart
            rollups={displayRollups}
            games={chartGames}
            durationSeconds={currentOffsetSeconds}
            streamStartedAt={payload.startedAt}
            height={chartHeight}
            selectedIndex={demoMode ? null : pinChartIndex}
            previewIndex={demoMode ? null : previewChartIndex}
            showViewerStrip={showViewerStrip}
            activityExpanded={activityExpanded}
            normalizeOverlaySeries={activityExpanded && selectedEmotesForOverlay.length > 0}
            focusedSeriesKey={demoMode ? null : focusedSeriesKey}
            onFocusedSeriesKeyChange={demoMode ? undefined : setFocusedSeriesKey}
            onSelectIndex={demoMode ? undefined : handleChartSelect}
            onClearSelection={demoMode ? undefined : handleClearChartSelection}
            clearSelectionBoundaryRef={chartInteractionRef}
            onHoverOffsetChange={setChartHoverOffsetSeconds}
            highlightedGameSegmentKey={chartHighlightedGameKeyValue}
            overlayLines={emoteOverlays}
            emptyMessage={chartEmpty}
            loading={chartLoading}
            isLive={isLive}
            emoteSyncTone={emoteSyncTone}
          />
        </div>
        {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
        {topEmotesForChips.length > 0 ? (
          <SevenTvEmotePanel
            expanded={emotePanelExpanded}
            onToggleExpanded={demoMode ? () => undefined : () => setEmotePanelExpanded(open => !open)}
            backendUrl={backendUrl}
            rollups={rollups}
            topEmotes={topEmotesForChips}
            selectedKeys={selectedEmoteKeys}
            onToggleEmote={toggleEmotePanelKey}
            selectedOffsetSeconds={selectedOffsetSeconds}
            sidebarCompact
            selectedPlotColors={selectedPlotColors}
            maxSelected={MAX_PLOTTED_EMOTES}
          />
        ) : null}
      </div>
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  metrics: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    marginBottom: 10,
    width: '100%',
    alignItems: 'end',
  },
  metricsSidebar: { gap: 6, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  metricsCompact: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  metric: { display: 'grid', gap: 2, minWidth: 0 },
  metricValueSidebar: { fontSize: 18, lineHeight: 1.05 },
  metricLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  metricValue: { fontSize: 22, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' },
  metricValueRow: { alignItems: 'flex-end', display: 'flex', gap: 5, minWidth: 0 },
  metricRow: { alignItems: 'center', display: 'flex', gap: 4 },
  metricMeta: { color: theme.textSecondary, fontSize: 10, fontWeight: 600, minHeight: 14 },
  metricHintBelow: { color: theme.textMuted, fontSize: 9, fontWeight: 600, lineHeight: 1.35, margin: '0 0 8px' },
  metricHint: { color: theme.textMuted, fontSize: 9, fontWeight: 600, lineHeight: 1.35 },
  providerRate: { marginRight: 8 },
  trendArrow: { fontSize: 11, fontWeight: 900 },
  emoteSyncNote: { fontSize: 10, fontWeight: 700, margin: '8px 0 0' },
  timelineHint: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  timelineHintWarn: {
    color: '#fcd34d',
  },
  timelineHintSep: { color: theme.textMuted },
  streamStartLink: {
    ...overlayTextLinkButton,
    fontSize: 10,
  },
  chartReadoutSlot: {
    alignItems: 'center',
    display: 'flex',
    minHeight: 20,
    margin: 0,
  },
  chartReadout: {
    color: theme.textSecondary,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    gap: 4,
    lineHeight: '20px',
    margin: 0,
    minHeight: 20,
    width: '100%',
  },
  chartReadoutTime: { color: theme.textPrimary, fontWeight: 800 },
  chartReadoutSep: { color: theme.textMuted },
  chartRangeRow: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    margin: 0,
    minHeight: 26,
  },
  partialRangeHint: {
    color: theme.textMuted,
    flex: '1 1 180px',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    minWidth: 0,
    textAlign: 'right',
  },
  chartLeadIn: {
    display: 'grid',
    gap: 4,
  },
  sparklineBlock: {
    display: 'grid',
    gap: 6,
    marginTop: 8,
    minWidth: 0,
    overflow: 'visible',
    width: '100%',
  },
  gapNotice: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  sparklineHeader: { display: 'grid', gap: 6, minWidth: 0, overflow: 'visible' },
  sparklineHeaderTop: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  overlayLegendRow: { display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 },
  overlayLegendChip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    color: theme.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    font: 'inherit',
    gap: 5,
    padding: '3px 7px',
  },
  overlayLegendChipImg: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    display: 'inline-flex',
    flexShrink: 0,
    padding: '2px 5px',
  },
  overlayLegendEmoteImg: { display: 'block', objectFit: 'contain' },
  overlayLegendChipHidden: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    opacity: 0.55,
  },
  overlayLegendChipAlt: {
    background: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(167, 139, 250, 0.14)',
  },
  overlayLegendDot: { borderRadius: 999, flexShrink: 0, height: 7, width: 7 },
  overlayLegendName: { color: theme.textSecondary, fontSize: 9, fontWeight: 700 },
  overlayLegendNameHidden: { color: theme.textMuted },
  sparklineLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  chartLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    minWidth: 0,
  },
  chartLegendItem: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'inline-flex',
    fontSize: 9,
    fontWeight: 700,
    gap: 4,
  },
  chartLegendDot: {
    borderRadius: 999,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  chartLegendStroke: {
    background: 'transparent',
    border: '1.5px solid #d4d4d8',
    borderRadius: 1,
    flexShrink: 0,
    height: 0,
    width: 10,
  },
  chartStack: {
    minWidth: 0,
    position: 'relative',
    width: '100%',
  },
  headerMeta: {
    alignItems: 'center',
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  analyticsHeaderLink: {
    background: 'transparent',
    border: 0,
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 800,
    padding: '2px 0',
    whiteSpace: 'nowrap',
  },
  sparklineHeaderControls: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 6,
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
    padding: '5px 8px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  expandButtonActive: {
    background: 'rgba(139, 92, 246, 0.12)',
    borderColor: 'rgba(167, 139, 250, 0.35)',
    color: '#ddd6fe',
  },
}
