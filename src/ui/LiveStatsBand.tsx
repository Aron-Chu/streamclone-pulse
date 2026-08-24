import { useEffect, useId, useMemo, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  deriveLiveStats,
  formatHeatOffset,
  toLiveStatsInputFromExtension,
  trendArrowGlyph,
  type LiveConfidenceState,
  type LiveHeatPoint,
  type LiveStats,
  type LiveViewerMetadata,
  type TrendDirection,
} from '@streampulse/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import {
  fullHistoryActivationKey,
  hasStableFullHistoryActivation,
  hasValidatedFullHistory,
  makeFullHistoryActivation,
  type FullHistoryRequestResult,
} from '../shared/fullHistoryAuth.ts'
import {
  getDefaultChartWindow,
  migrateDefaultChartWindowToRecentV2Once,
  setDefaultChartWindow,
  type DefaultChartWindow,
} from '../shared/storage.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { GamesPlayedStrip } from './GamesPlayedStrip.tsx'
import { PulseOverviewChart } from './PulseOverviewChart.tsx'
import {
  aggregateChartEmotes,
  buildEmoteOverlaySeries,
  pruneUnavailableEmoteSelections,
  selectedEmotesInPlotOrder,
  CHART_WINDOW_OPTIONS,
  chartEmptyMessage,
  chartWindowNeedsFullFetch,
  describeRollupGap,
  emoteAveragesFromRollups,
  emoteSelectionKey,
  findChartIndexByOffset,
  fullRollupsMissingStreamPrefix,
  MAX_PLOTTED_EMOTES,
  PLOT_PICKER_EMOTE_LIMIT,
  prepareChartRollups,
  plottedCoverageLabel,
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
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { StreamActivityChartHeader } from './StreamActivityChartHeader.tsx'
import { theme } from './theme.ts'
import { resolveCoverageStartHint } from './coverageStartHint.ts'
import { useChartExpansion } from './motion/useChartExpansion.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'
import {
  MIN_MEANINGFUL_CHART_DURATION_SECONDS,
  shouldShowChartRail,
} from './ChartPositionRail.tsx'
import { ChartToolbar, ChartViewportControls } from './ChartViewportControls.tsx'
import {
  advanceFollowingLiveViewport,
  clampViewportToCoverage,
  MIN_VIEWPORT_SECONDS,
  resolveViewport,
  viewportDurationSeconds,
  zoomViewport,
  type ChartViewport,
} from './chartViewport.ts'

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
  onRequestFullTimeline?: () => Promise<FullHistoryRequestResult>
  onChartWindowChange?: (window: ChartTimelineWindow) => void
  onPinOffset?: (offsetSeconds: number | null) => void
  onSaveMoment?: (point: LiveHeatPoint) => void
  saveMomentBusy?: boolean
  pinOffsetSeconds?: number | null
  previewOffsetSeconds?: number | null
  hasVodContext?: boolean
  coverageTier?: string | null
  liveMetadata?: LiveViewerMetadata | null
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
    color: '#a78bfa',
  },
}

const COMPACT_NUMBER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const STANDARD_NUMBER = new Intl.NumberFormat('en-US', {
  notation: 'standard',
  maximumFractionDigits: 1,
})
const METRIC_MOTION_MS = 180

function formatSignedDelta(delta: number | null): string {
  if (delta === null) return '—'
  if (delta === 0) return '0'
  return delta > 0 ? `+${delta.toLocaleString()}` : `-${Math.abs(delta).toLocaleString()}`
}

function formatNumber(value: number): string {
  return (value >= 10_000 ? COMPACT_NUMBER : STANDARD_NUMBER).format(value)
}

function formatMaybeNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : '—'
}

function useCountUp(value: number, duration = METRIC_MOTION_MS): number {
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)
  const fromRef = useRef(value)
  const startRef = useRef(0)
  const reducedMotion = prefersReducedMotion()
  displayRef.current = display

  useEffect(() => {
    if (reducedMotion) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    fromRef.current = displayRef.current
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
  }, [duration, reducedMotion, value])

  return display
}

function AnimatedMetric({
  value,
  format,
  valueStyle,
}: {
  value: number | null
  format?: (value: number) => string
  valueStyle?: CSSProperties
}) {
  const animated = useCountUp(value ?? 0)
  return (
    <span style={{ ...styles.metricValue, ...valueStyle }}>
      {value == null ? '—' : format ? format(animated) : formatNumber(animated)}
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
  liveMetadata = null,
  demoMode = false,
}: LiveStatsBandProps) {
  const chartInteractionRef = useRef<HTMLDivElement | null>(null)
  const statsInput = useMemo(
    () => ({
      ...toLiveStatsInputFromExtension(payload),
      liveMetadata,
    }),
    [payload, liveMetadata],
  )
  const stats: LiveStats = useMemo(
    () => deriveLiveStats(statsInput),
    [statsInput],
  )
  const confidenceStyle = CONFIDENCE_STYLES[stats.confidence]
  const activation = useMemo(
    () =>
      makeFullHistoryActivation({
        login: payload.login,
        streamId: payload.streamId,
        vodId: payload.vodId,
      }),
    [payload.login, payload.streamId, payload.vodId],
  )
  const activationKey = fullHistoryActivationKey(activation)
  const hasFullRollups = hasValidatedFullHistory(payload, activation)
  const effectiveCurrentOffsetSeconds = Math.max(
    0,
    currentOffsetSeconds,
    payload.currentOffsetSeconds ?? 0,
  )
  const [chartWindow, setChartWindow] = useState<ChartTimelineWindow>('60m')
  const [chartViewport, setChartViewport] = useState<ChartViewport>(() => resolveViewport({ durationSeconds: effectiveCurrentOffsetSeconds, zoomSeconds: 'full' }))
  const chartViewportUserChangedRef = useRef(false)
  const previousChartDurationRef = useRef(effectiveCurrentOffsetSeconds)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [fullTimelineFailed, setFullTimelineFailed] = useState(false)
  /** Explicit Full requests are de-duplicated per activation; retries are still user-triggered. */
  const fullTimelineRequestedKeyRef = useRef<string | null>(null)
  const fullTimelineInFlightKeyRef = useRef<string | null>(null)
  /** After the user picks a range, ignore late async default hydration for this stream. */
  const chartWindowUserPickedRef = useRef(false)
  const [activationSeen, setActivationSeen] = useState(activation)
  if (fullHistoryActivationKey(activationSeen) !== activationKey) {
    setActivationSeen(activation)
    chartWindowUserPickedRef.current = false
    fullTimelineRequestedKeyRef.current = null
    fullTimelineInFlightKeyRef.current = null
    // A pending request from the previous surface must not leave the new
    // activation's explicit Full action disabled. Its eventual result is
    // still ignored by the activation guard below.
    setTimelineLoading(false)
    setFullTimelineFailed(false)
  }
  const sparklineBlockRef = useRef<HTMLDivElement | null>(null)
  const onRequestFullTimelineRef = useRef(onRequestFullTimeline)
  onRequestFullTimelineRef.current = onRequestFullTimeline

  useEffect(() => {
    if (demoMode) {
      setChartWindow('60m')
      return
    }
    let mounted = true
    const hydrateFor = activationKey
    void (async () => {
      try {
        // One-time v2: every pre-v2 preference (including Full) → 60m.
        await migrateDefaultChartWindowToRecentV2Once()
        const window = await getDefaultChartWindow()
        if (!mounted) return
        // Drop late hydration after stream/channel change.
        if (hydrateFor !== activationKey) return
        // First click Full→30m was getting overwritten when this async finished.
        if (chartWindowUserPickedRef.current) return
        if (fullTimeline) {
          setChartWindow('full')
          return
        }
        // Stored range is only a display preference. Full history is fetched by
        // an explicit user action below, never by activation or rerender.
        setChartWindow(window)
      } catch {
        // Storage denied / extension context invalidated — keep in-memory default.
      }
    })()
    return () => {
      mounted = false
    }
  }, [activationKey, fullTimeline, demoMode])

  const rollups = useMemo(
    () =>
      prepareChartRollups(payload, {
        chartWindow,
        currentOffsetSeconds: effectiveCurrentOffsetSeconds,
        coverageStartOffsetSeconds,
        activation,
      }),
    [payload, chartWindow, effectiveCurrentOffsetSeconds, coverageStartOffsetSeconds, activation],
  )
  const displayRollups = useMemo(() => downsampleRollupsForChart(rollups), [rollups])
  // Pin/preview indexes must match the chart's source domain (raw prepared rollups).
  const chartOffsets = useMemo(
    () => rollups.map(rollup => rollup.offsetSeconds),
    [rollups],
  )
  const rollupGapNotice = chartWindow === 'full' && hasFullRollups ? describeRollupGap(rollups) : null
  const needsFullRollups =
    chartWindowNeedsFullFetch(chartWindow, payload, effectiveCurrentOffsetSeconds, activation)
    && (!hasFullRollups || fullRollupsMissingStreamPrefix(payload, activation))
  // Full history is optional enrichment. Keep recent points rendered while the
  // activation-scoped request is pending or has failed.
  const chartLoading = timelineLoading && rollups.length === 0
  const canShowFullTimeline = hasFullRollups || fullTimeline || currentOffsetSeconds > 0
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)

  const handleClearChartSelection = useCallback((): void => {
    onPinOffset?.(null)
    setChartHoverOffsetSeconds(null)
  }, [onPinOffset])

  useEffect(() => {
    setHoveredGameKey(null)
  }, [payload.streamId, chartWindow])

  useEffect(() => {
    chartViewportUserChangedRef.current = false
    previousChartDurationRef.current = effectiveCurrentOffsetSeconds
    setChartViewport(resolveViewport({ durationSeconds: effectiveCurrentOffsetSeconds, zoomSeconds: 'full' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the stream/VOD activation changes
  }, [activationKey])

  useEffect(() => {
    const previousDurationSeconds = previousChartDurationRef.current
    previousChartDurationRef.current = effectiveCurrentOffsetSeconds
    setChartViewport(current => {
      if (!chartViewportUserChangedRef.current) {
        return resolveViewport({ durationSeconds: effectiveCurrentOffsetSeconds, zoomSeconds: 'full' })
      }
      return advanceFollowingLiveViewport({
        viewport: current,
        previousDurationSeconds,
        durationSeconds: effectiveCurrentOffsetSeconds,
      })
    })
  }, [effectiveCurrentOffsetSeconds])

  useEffect(() => {
    if (!fullTimeline) return
    // Only force Full when the user has not already chosen another range.
    if (chartWindowUserPickedRef.current) return
    setChartWindow('full')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activation-scoped unlock uses current activation
  }, [fullTimeline, activationKey])

  const requestFullTimeline = useCallback((retry = false): void => {
    const request = onRequestFullTimelineRef.current
    if (!request || !hasStableFullHistoryActivation(activation)) return
    if (hasValidatedFullHistory(payload, activation)) return
    if (fullTimelineInFlightKeyRef.current === activationKey) return
    if (!retry && fullTimelineRequestedKeyRef.current === activationKey) return

    handleClearChartSelection()
    if (!retry) fullTimelineRequestedKeyRef.current = activationKey
    fullTimelineInFlightKeyRef.current = activationKey
    setTimelineLoading(true)
    setFullTimelineFailed(false)
    void request()
      .then(result => {
        if (fullHistoryActivationKey(activation) !== activationKey) return
        if (result.ok && hasValidatedFullHistory(result.payload, activation)) {
          setFullTimelineFailed(false)
          if (!chartWindowUserPickedRef.current) setChartWindow('full')
          return
        }
        setFullTimelineFailed(true)
      })
      .catch(() => {
        if (fullHistoryActivationKey(activation) === activationKey) setFullTimelineFailed(true)
      })
      .finally(() => {
        if (fullTimelineInFlightKeyRef.current === activationKey) {
          fullTimelineInFlightKeyRef.current = null
          setTimelineLoading(false)
        }
      })
  }, [activation, activationKey, handleClearChartSelection, payload])

  const handleChartWindowChange = (window: ChartTimelineWindow): void => {
    handleClearChartSelection()
    chartWindowUserPickedRef.current = true
    setChartWindow(window)
    // Persist the user's fallback/pre-load preference. Polling remains recent.
    if (!demoMode) {
      void setDefaultChartWindow(window as DefaultChartWindow)
    }
    onChartWindowChange?.(window)
    if (window === 'full') requestFullTimeline()
  }

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
    previewChartIndex != null ? rollups[previewChartIndex] : undefined

  const selectedRollup =
    pinChartIndex != null ? rollups[pinChartIndex] : undefined

  const minuteAtRollup = useMemo(() => {
    if (selectedRollup) return selectedRollup
    if (chartHoverOffsetSeconds != null) {
      return rollups.find(rollup => rollup.offsetSeconds === chartHoverOffsetSeconds)
    }
    if (previewRollup) return previewRollup
    return undefined
  }, [selectedRollup, chartHoverOffsetSeconds, rollups, previewRollup])

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

  useEffect(() => {
    setSelectedEmoteKeys(current => {
      const next = pruneUnavailableEmoteSelections(current, topEmotesForChips, rollups, {
        loading: chartLoading,
      })
      if (next.length === current.length && next.every((key, index) => key === current[index])) {
        return current
      }
      return next
    })
  }, [topEmotesForChips, rollups, chartLoading])

  const selectedEmotesForOverlay = useMemo(
    () => selectedEmotesInPlotOrder(topEmotesForChips, selectedEmoteKeys),
    [topEmotesForChips, selectedEmoteKeys],
  )
  const emoteOverlays = useMemo(
    () =>
      selectedEmotesForOverlay.length > 0
        ? buildEmoteOverlaySeries(rollups, selectedEmotesForOverlay, rollups)
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

  const chartRailRollups = useMemo(
    () => (hasFullRollups ? payload.fullRollups ?? [] : rollups),
    [hasFullRollups, payload.fullRollups, rollups],
  )
  const chartRailDurationSeconds = useMemo(() => {
    // Include the trailing minute span of the last rollup so the final "Now"
    // bucket is never dropped by viewport bucketing (Aug-16 rollupSpan.end).
    const lastRollupEnd =
      chartRailRollups.length > 0
        ? (chartRailRollups[chartRailRollups.length - 1]?.offsetSeconds ?? 0) + 60
        : 0
    return Math.max(
      currentOffsetSeconds,
      payload.currentOffsetSeconds ?? 0,
      lastRollupEnd,
    )
  }, [currentOffsetSeconds, payload.currentOffsetSeconds, chartRailRollups])
  const chartCoverageStartSeconds = Math.max(
    0,
    coverageStartOffsetSeconds,
    payload.coverageStartOffsetSeconds ?? payload.coverage?.coverageStartOffsetSeconds ?? 0,
    chartRailRollups[0]?.offsetSeconds ?? 0,
  )
  // Keep viewport navigation available as soon as the chart has a usable
  // minute, including short streams. Full-history fallback still uses the
  // recent rollups that are already on screen.
  const chartHasMeaningfulData = rollups.some(rollup => !rollup.missing)
  const chartUsesViewport =
    hasFullRollups
    || chartWindow === 'full'
    || (needsFullRollups && !hasFullRollups)
    || effectiveCurrentOffsetSeconds >= MIN_VIEWPORT_SECONDS
    || chartRailDurationSeconds >= MIN_MEANINGFUL_CHART_DURATION_SECONDS

  const chartViewportForRender = useMemo(
    () => clampViewportToCoverage(
      chartViewport,
      chartRailDurationSeconds,
      chartCoverageStartSeconds,
    ),
    [chartCoverageStartSeconds, chartRailDurationSeconds, chartViewport],
  )

  // Repair a stale viewport as soon as rollup coverage changes. The derived
  // value above prevents a blank frame; this effect keeps future interactions
  // and persisted state on the same invariant.
  useEffect(() => {
    setChartViewport(current => {
      const next = clampViewportToCoverage(
        current,
        chartRailDurationSeconds,
        chartCoverageStartSeconds,
      )
      if (
        next.startSeconds === current.startSeconds
        && next.endSeconds === current.endSeconds
      ) return current
      return next
    })
  }, [chartCoverageStartSeconds, chartRailDurationSeconds])

  const visibleChartRollupCount = chartUsesViewport
    ? rollups.filter(rollup => (
        rollup.offsetSeconds >= chartViewportForRender.startSeconds
        && rollup.offsetSeconds < chartViewportForRender.endSeconds
      )).length
    : rollups.length

  const chartEmpty = chartEmptyMessage({
    rollupCount: rollups.length,
    visibleRollupCount: visibleChartRollupCount,
    chartWindow,
    hasFullRollups,
    confidence: stats.confidence,
    currentOffsetSeconds: effectiveCurrentOffsetSeconds,
    awaitingFullRollups: timelineLoading && needsFullRollups,
  })

  const handleChartViewportChange = useCallback((next: ChartViewport): void => {
    chartViewportUserChangedRef.current = true
    setChartViewport(clampViewportToCoverage(
      next,
      chartRailDurationSeconds,
      chartCoverageStartSeconds,
    ))
  }, [chartCoverageStartSeconds, chartRailDurationSeconds])

  const changeChartZoom = useCallback((direction: 'in' | 'out'): void => {
    if (chartRailDurationSeconds <= 0) return
    handleClearChartSelection()
    const currentDuration = viewportDurationSeconds(chartViewportForRender)
    const availableDuration = Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds)
    const nextDuration = direction === 'in'
      ? Math.max(Math.min(MIN_VIEWPORT_SECONDS, availableDuration), currentDuration / 1.5)
      : Math.min(availableDuration, currentDuration * 1.5)
    handleChartViewportChange(
      zoomViewport({
        viewport: chartViewportForRender,
        zoomSeconds: nextDuration,
        durationSeconds: chartRailDurationSeconds,
        coverageStartSeconds: chartCoverageStartSeconds,
      }),
    )
  }, [
    chartCoverageStartSeconds,
    chartRailDurationSeconds,
    chartViewportForRender,
    handleClearChartSelection,
    handleChartViewportChange,
  ])

  const resetChartViewport = useCallback((): void => {
    if (chartRailDurationSeconds <= 0) return
    handleClearChartSelection()
    handleChartViewportChange(
      resolveViewport({
        durationSeconds: chartRailDurationSeconds,
        zoomSeconds: 'full',
        coverageStartSeconds: chartCoverageStartSeconds,
      }),
    )
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, handleClearChartSelection, handleChartViewportChange])

  const visibleRange = useMemo(
    () => chartVisibleRangeFromRollups(displayRollups),
    [displayRollups],
  )
  const gamesVisibleRange = chartWindow === 'full' ? null : visibleRange

  const chartHighlightedGameKeyValue = useMemo(
    () => chartHighlightedGameKey(hoveredGameKey, chartGames, currentOffsetSeconds, gamesVisibleRange),
    [hoveredGameKey, chartGames, currentOffsetSeconds, gamesVisibleRange],
  )

  const handleChartSelect = useCallback((index: number): void => {
    const rollup = rollups[index]
    if (!rollup || rollup.missing) return
    // Preserve plotted emote overlays across chart selections.
    setFocusedSeriesKey(null)
    onPinOffset?.(rollup.offsetSeconds)
    setChartHoverOffsetSeconds(null)
  }, [onPinOffset, rollups])

  // A linked VOD can arrive asynchronously for the same stream. Keep that
  // enrichment on the same chart surface; a real stream/route/mode change
  // still resets all ephemeral chart choices.
  const chartIdentity = [
    payload.login,
    payload.streamId ?? (payload.vodId ?? ''),
    payload.startedAt ?? '',
    isLive ? 'live' : 'recap',
    payload.mode ?? '',
  ].join(':')
  const chartRegionId = `pulse-live-chart-${useId().replace(/:/g, '')}`
  const chartExpansion = useChartExpansion({
    identity: chartIdentity,
    heights: {
      collapsed: sidebarFill ? 216 : 184,
      expanded: (sidebarFill ? 216 : 184) + 48,
    },
  })
  const activityExpanded = chartExpansion.expanded
  const chartHeight = chartExpansion.height

  useEffect(() => {
    setFocusedSeriesKey(null)
    setSelectedEmoteKeys([])
    setEmotePanelExpanded(false)
    setChartHoverOffsetSeconds(null)
    onPinOffset?.(null)
    // Reset coupled chart selection state only when the surface identity
    // changes. Same-stream VOD enrichment intentionally keeps this identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartIdentity])

  function resetChartExpansion(): void {
    handleClearChartSelection()
    setFocusedSeriesKey(null)
    chartExpansion.reset()
  }

  const metricsStyle = sidebarFill
    ? { ...styles.metrics, ...styles.metricsSidebar }
    : compact
      ? { ...styles.metrics, ...styles.metricsCompact }
      : styles.metrics

  function toggleEmotePanelKey(emote: (typeof topEmotesForChips)[number]): void {
    handleClearChartSelection()
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
  const viewerSamplesAvailable = rollups.some(
    rollup => !rollup.missing && typeof rollup.viewerCount === 'number',
  )
  // Helix-enabled live payloads can legitimately arrive before their first
  // viewer sample. Reserve the lane in that case so the chart does not jump
  // when the first sample arrives; the chart status lane explains the gap.
  const viewerLaneExpected = isLive && (
    payload.helixEnabled === true
    || payload.viewerStartOffsetSeconds != null
    || payload.peakViewers != null
  )
  const showViewerStrip = viewerSamplesAvailable || viewerLaneExpected
  const viewerPeak = Math.max(0, payload.peakViewers ?? 0, stats.currentViewers ?? 0)
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
  const chartRailVisible =
    chartUsesViewport
    && chartHasMeaningfulData
    && shouldShowChartRail(chartViewportForRender, chartRailDurationSeconds)
  const chartAtAvailableRange =
    chartRailDurationSeconds <= 0
    || (chartViewportForRender.startSeconds <= chartCoverageStartSeconds + 5
      && chartViewportForRender.endSeconds >= chartRailDurationSeconds - 5)
  const chartIsFullRange =
    chartAtAvailableRange && chartCoverageStartSeconds <= 5
  const chartRangeStatus = chartIsFullRange
    ? 'Full stream'
    : chartAtAvailableRange
      ? `Available coverage · from ${formatHeatOffset(chartCoverageStartSeconds)}`
      : `Viewing ${formatHeatOffset(chartViewportForRender.startSeconds)} – ${formatHeatOffset(chartViewportForRender.endSeconds)}`
  const readoutChat = minuteAtRollup && !minuteAtRollup.missing ? minuteAtRollup.chatCount : null
  const readoutEmotes = minuteAtRollup && !minuteAtRollup.missing
    ? minuteEmoteTotal(minuteAtRollup)
    : null
  const readoutViewers = minuteAtRollup && !minuteAtRollup.missing
    ? minuteAtRollup.viewerCount
    : null
  const chartStatusText = [
    emoteSyncLabel,
    emoteChartHint,
    viewerLaneExpected && !viewerSamplesAvailable ? 'Viewer data unavailable' : null,
  ].filter(Boolean).join(' · ')

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
            {stats.viewerState === 'stale' ? ' · stale' : stats.viewerState === 'unknown' ? ' · unavailable' : ''}
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

      <div
        style={styles.chartStatusLane}
        data-chart-status-lane="true"
        aria-live="polite"
        title={chartStatusText || undefined}
      >
        {chartStatusText ? (
          <span style={{ ...styles.chartStatusText, ...emoteSyncStyle }}>{chartStatusText}</span>
        ) : null}
      </div>

      <div ref={sparklineBlockRef} style={styles.sparklineBlock}>
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
                data-chart-action="true"
                onClick={() => {
                  handleClearChartSelection()
                  if (activityExpanded) resetChartExpansion()
                  else chartExpansion.expand()
                }}
                aria-expanded={activityExpanded}
                aria-controls={chartRegionId}
                aria-label={activityExpanded ? 'Reset stream activity chart' : 'Expand stream activity chart'}
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
                        data-chart-action="true"
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
        </div>
        <GamesPlayedStrip
          games={chartGames}
          activationKey={activationKey}
          durationSeconds={chartRailDurationSeconds}
          highlightedKey={chartHighlightedGameKeyValue}
          onHighlightKey={setHoveredGameKey}
          visibleRange={gamesVisibleRange}
          plotPadLeft={4}
          plotPadRight={12}
        />
        <ChartToolbar
          rangeValue={chartWindow}
          rangeOptions={CHART_WINDOW_OPTIONS}
          rangeDisabled={timelineLoading || demoMode}
          onRangeChange={handleChartWindowChange}
          auxiliaryControls={
            <>
              {showPartialRangeStatus ? (
                <button
                  type="button"
                  style={styles.streamStartLink}
                  disabled={timelineLoading || demoMode}
                  title="Show the entire broadcast on the chart (does not change live poll)"
                  onClick={() => handleChartWindowChange('full')}
                >
                  Full stream
                </button>
              ) : null}
              {!showPartialRangeStatus && needsFullRollups && !fullTimelineFailed && onRequestFullTimeline ? (
                <button
                  type="button"
                  data-testid="load-full-history"
                  style={styles.streamStartLink}
                  disabled={timelineLoading || demoMode}
                  title="Load the full stream chart (live polling remains recent)"
                  onClick={() => requestFullTimeline()}
                >
                  {timelineLoading ? 'Loading…' : 'Load full history'}
                </button>
              ) : null}
              {fullTimelineFailed && onRequestFullTimeline ? (
                <button
                  type="button"
                  data-testid="load-full-history"
                  style={styles.streamStartLink}
                  disabled={timelineLoading || demoMode}
                  title="Retry this activation's one-shot full-history request. Live polling remains recent."
                  onClick={() => requestFullTimeline(true)}
                >
                  {timelineLoading ? 'Loading…' : 'Retry full history'}
                </button>
              ) : null}
            </>
          }
        />
        <div ref={chartInteractionRef} style={styles.chartStack}>
          <div
            style={{
              ...styles.chartReadoutSlot,
              opacity: showChartReadout ? 1 : 0,
            }}
            aria-live="polite"
            aria-hidden={!showChartReadout}
          >
            <p
              style={styles.chartReadout}
              data-chart-readout="true"
              title={showChartReadout ? undefined : 'Chart readout appears when you hover or select a minute'}
            >
              <span style={styles.chartReadoutTime}>
                {formatHeatOffset(minuteAtOffsetSeconds)}
              </span>
              {readoutViewers != null ? (
                <>
                  <span style={styles.chartReadoutSep}>·</span>
                  <span>viewers {formatMaybeNumber(readoutViewers)}</span>
                </>
              ) : null}
              <span style={styles.chartReadoutSep}>·</span>
              <span>chat {formatMaybeNumber(readoutChat)}/min</span>
              <span style={styles.chartReadoutSep}>·</span>
              <span>emotes {formatMaybeNumber(readoutEmotes)}/min</span>
            </p>
          </div>
          <PulseOverviewChart
            rollups={rollups}
            games={chartGames}
            backendUrl={backendUrl}
            interactionResetKey={chartIdentity}
            durationSeconds={chartRailDurationSeconds}
            streamStartedAt={payload.startedAt}
            height={chartHeight}
            chartRegionId={chartRegionId}
            activityExpansionProgress={chartExpansion.progress}
            selectedIndex={demoMode ? null : pinChartIndex}
            previewIndex={demoMode ? null : previewChartIndex}
            showViewerStrip={showViewerStrip}
            viewerPeak={viewerPeak}
            activityExpanded={activityExpanded}
            normalizeOverlaySeries={selectedEmotesForOverlay.length > 0}
            focusedSeriesKey={demoMode ? null : focusedSeriesKey}
            onFocusedSeriesKeyChange={demoMode ? undefined : setFocusedSeriesKey}
            onSelectIndex={demoMode ? undefined : handleChartSelect}
            onClearSelection={demoMode ? undefined : handleClearChartSelection}
            clearSelectionBoundaryRef={chartInteractionRef}
            onHoverOffsetChange={setChartHoverOffsetSeconds}
            viewport={chartUsesViewport ? chartViewportForRender : undefined}
            coverageStartSeconds={chartCoverageStartSeconds}
            onViewportChange={chartUsesViewport ? handleChartViewportChange : undefined}
            onJumpToOffset={onJumpToOffset}
            highlightedGameSegmentKey={chartHighlightedGameKeyValue}
            overlayLines={emoteOverlays}
            emptyMessage={chartEmpty}
            loading={chartLoading}
            isLive={isLive}
            emoteSyncTone={emoteSyncTone}
          />
        </div>
        {chartRailVisible ? (
          <ChartViewportControls
            viewport={chartViewportForRender}
            durationSeconds={chartRailDurationSeconds}
            coverageStartSeconds={chartCoverageStartSeconds}
            rangeLabel={chartRangeStatus}
            hasMeaningfulData={chartHasMeaningfulData}
            disabled={timelineLoading || demoMode}
            zoomOutDisabled={
              viewportDurationSeconds(chartViewportForRender)
              >= Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds) - 5
            }
            resetDisabled={chartAtAvailableRange}
            zoomInDisabled={
              viewportDurationSeconds(chartViewportForRender)
              <= Math.min(
                MIN_VIEWPORT_SECONDS,
                Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds),
              )
            }
            onViewportChange={handleChartViewportChange}
            onJumpToOffset={onJumpToOffset}
            onZoomIn={() => changeChartZoom('in')}
            onZoomOut={() => changeChartZoom('out')}
            onReset={resetChartViewport}
            coverageHint={
              showCoverageStartHint || sparseActivityWarmup || lateViewerSamples || (showLoadFromStart && onLoadFromStart) ? (
                <>
                  {showCoverageStartHint ? (
                    <span style={coverageHint.tone === 'warn' ? styles.timelineHintWarn : undefined}>
                      {coverageHint.text}
                    </span>
                  ) : null}
                  {showCoverageStartHint && sparseActivityWarmup ? <span style={styles.timelineHintSep}> · </span> : null}
                  {sparseActivityWarmup && firstActivityOffsetSeconds != null ? (
                    <span>Activity chart from {formatHeatOffset(firstActivityOffsetSeconds)}</span>
                  ) : null}
                  {(showCoverageStartHint || sparseActivityWarmup) && lateViewerSamples ? (
                    <span style={styles.timelineHintSep}> · </span>
                  ) : null}
                  {lateViewerSamples ? (
                    <span>Viewer samples from {formatHeatOffset(viewerStartOffsetSeconds)}</span>
                  ) : null}
                  {(showCoverageStartHint || sparseActivityWarmup || lateViewerSamples) && showLoadFromStart && onLoadFromStart ? (
                    <span style={styles.timelineHintSep}> · </span>
                  ) : null}
                  {showLoadFromStart && onLoadFromStart ? (
                  <button
                    type="button"
                    style={styles.streamStartLink}
                    data-chart-action="true"
                    disabled={loadFromStartBusy}
                      title="Expand the activity chart from stream start and jump the player when a VOD is available."
                      onClick={() => {
                        handleClearChartSelection()
                        onLoadFromStart()
                      }}
                    >
                      {loadFromStartBusy ? 'Loading…' : 'Load full stream chart'}
                    </button>
                  ) : null}
                </>
              ) : null
            }
          />
        ) : null}
        {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
        {topEmotesForChips.length > 0 ? (
          <div data-chart-action="true">
            <SevenTvEmotePanel
              expanded={emotePanelExpanded}
              onToggleExpanded={demoMode ? () => undefined : () => {
                handleClearChartSelection()
                setEmotePanelExpanded(open => !open)
              }}
              backendUrl={backendUrl}
              rollups={rollups}
              topEmotes={topEmotesForChips}
              selectedKeys={selectedEmoteKeys}
              onToggleEmote={toggleEmotePanelKey}
              selectedOffsetSeconds={selectedOffsetSeconds}
              sidebarCompact
              selectedPlotColors={selectedPlotColors}
              maxSelected={MAX_PLOTTED_EMOTES}
              rollupsLoading={chartLoading}
            />
          </div>
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
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  metricValue: { fontSize: 22, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' },
  metricValueRow: { alignItems: 'flex-end', display: 'flex', gap: 5, minWidth: 0, overflow: 'hidden' },
  metricRow: { alignItems: 'center', display: 'flex', gap: 4 },
  metricMeta: {
    color: theme.textSecondary,
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '14px',
    minHeight: 14,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metricHintBelow: { color: theme.textMuted, fontSize: 9, fontWeight: 600, lineHeight: 1.35, margin: '0 0 8px' },
  metricHint: { color: theme.textMuted, fontSize: 9, fontWeight: 600, lineHeight: 1.35 },
  providerRate: { marginRight: 8 },
  trendArrow: { fontSize: 11, fontWeight: 900 },
  emoteSyncNote: { fontSize: 10, fontWeight: 700, margin: '8px 0 0' },
  chartStatusLane: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'flex',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: '14px',
    minHeight: 14,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chartStatusText: {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  timelineHint: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'flex',
    flexWrap: 'nowrap',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
    left: 6,
    minHeight: 18,
    pointerEvents: 'none',
    position: 'absolute',
    right: 6,
    top: 1,
    zIndex: 2,
  },
  chartReadout: {
    color: theme.textSecondary,
    display: 'flex',
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    gap: 4,
    lineHeight: '18px',
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  chartReadoutTime: { color: theme.textPrimary, fontWeight: 800 },
  chartReadoutSep: { color: theme.textMuted },
  chartRangeRow: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'nowrap',
    gap: 8,
    justifyContent: 'flex-start',
    margin: 0,
    minHeight: 26,
    minWidth: 0,
    overflow: 'hidden',
  },
  chartRangeStatus: {
    color: theme.textSecondary,
    flex: '1 1 auto',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.35,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  partialRangeHint: {
    color: theme.textMuted,
    flex: '0 0 auto',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    minWidth: 0,
    textAlign: 'right',
    whiteSpace: 'nowrap',
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
    border: '1.5px solid #a78bfa',
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
  chartViewportControls: {
    display: 'grid',
    gap: 4,
    marginTop: 4,
    minWidth: 0,
  },
  chartViewportMeta: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
  },
  chartViewportMetaRow: {
    alignItems: 'center',
    display: 'flex',
    minWidth: 0,
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
    border: '1px solid rgba(167, 139, 250, 0.35)',
    color: '#ddd6fe',
  },
}
