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
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { StreamActivityChartHeader } from './StreamActivityChartHeader.tsx'
import { theme } from './theme.ts'
import { resolveCoverageStartHint } from './coverageStartHint.ts'
import { useChartExpansion } from './motion/useChartExpansion.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'
import { ChartPositionRail, LONG_STREAM_OVERVIEW_SECONDS, shouldShowChartRail } from './ChartPositionRail.tsx'
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
  if (delta === null) return '-'
  if (delta === 0) return '0'
  return delta > 0 ? `+${delta.toLocaleString()}` : `-${Math.abs(delta).toLocaleString()}`
}

function formatNumber(value: number): string {
  return (value >= 10_000 ? COMPACT_NUMBER : STANDARD_NUMBER).format(value)
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
  const stats: LiveStats = useMemo(
    () => deriveLiveStats(toLiveStatsInputFromExtension(payload)),
    [payload],
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
  /** Exactly one automatic Full request latch per stable activation key. */
  const fullTimelineAutoRequestedKeyRef = useRef<string | null>(null)
  const fullTimelineInFlightKeyRef = useRef<string | null>(null)
  /** After the user picks a range, ignore late async default hydration for this stream. */
  const chartWindowUserPickedRef = useRef(false)
  const [activationSeen, setActivationSeen] = useState(activation)
  if (fullHistoryActivationKey(activationSeen) !== activationKey) {
    setActivationSeen(activation)
    chartWindowUserPickedRef.current = false
    fullTimelineAutoRequestedKeyRef.current = null
    fullTimelineInFlightKeyRef.current = null
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
        // Stored range is a truthful startup fallback while Full loads automatically.
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
  // The startup preference can remain on a recent range while its one-shot
  // Full request is pending. Keep the full-domain viewport/rail visible in
  // that fallback state so the chart never loses its navigation affordance.
  const chartUsesViewport =
    hasFullRollups
    || chartWindow === 'full'
    || (needsFullRollups && !hasFullRollups)
    || effectiveCurrentOffsetSeconds >= LONG_STREAM_OVERVIEW_SECONDS
  // Full history is optional enrichment. Keep recent points rendered while the
  // activation-scoped request is pending or has failed.
  const chartLoading = timelineLoading && rollups.length === 0
  const canShowFullTimeline = hasFullRollups || fullTimeline || currentOffsetSeconds > 0
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)

  const handleChartWindowChange = (window: ChartTimelineWindow): void => {
    chartWindowUserPickedRef.current = true
    setChartWindow(window)
    // Persist the user's fallback/pre-load preference. Polling remains recent.
    if (!demoMode) {
      void setDefaultChartWindow(window as DefaultChartWindow)
    }
    onChartWindowChange?.(window)
  }

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

  const requestFullTimeline = useCallback((automatic: boolean): void => {
    const request = onRequestFullTimelineRef.current
    if (!request || !hasStableFullHistoryActivation(activation)) return
    if (fullTimelineInFlightKeyRef.current === activationKey) return
    if (automatic && fullTimelineAutoRequestedKeyRef.current === activationKey) return

    if (automatic) fullTimelineAutoRequestedKeyRef.current = activationKey
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
  }, [activation, activationKey])

  useEffect(() => {
    if (!hasStableFullHistoryActivation(activation)) return
    if (hasValidatedFullHistory(payload, activation)) {
      setFullTimelineFailed(false)
      if (!chartWindowUserPickedRef.current) setChartWindow('full')
      return
    }
    requestFullTimeline(true)
  }, [activation, activationKey, payload, requestFullTimeline])

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
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, chartViewportForRender, handleChartViewportChange])

  const resetChartViewport = useCallback((): void => {
    if (chartRailDurationSeconds <= 0) return
    handleChartViewportChange(
      resolveViewport({
        durationSeconds: chartRailDurationSeconds,
        zoomSeconds: 'full',
        coverageStartSeconds: chartCoverageStartSeconds,
      }),
    )
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, handleChartViewportChange])

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

  const handleClearChartSelection = useCallback((): void => {
    onPinOffset?.(null)
    setChartHoverOffsetSeconds(null)
  }, [onPinOffset])

  const chartIdentity = `${payload.login}:${payload.streamId ?? ''}:${payload.vodId ?? ''}:${payload.startedAt ?? ''}`
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
  }, [chartIdentity])

  function resetChartExpansion(): void {
    setFocusedSeriesKey(null)
    chartExpansion.reset()
  }

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
  const chartRailVisible =
    chartUsesViewport
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
                onClick={() => (activityExpanded ? resetChartExpansion() : chartExpansion.expand())}
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
          <div style={styles.chartRangeRow} data-chart-range-controls>
            <span style={styles.chartRangeStatus} data-chart-visible-range aria-live="polite">
              {chartRangeStatus}
            </span>
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
            {fullTimelineFailed && onRequestFullTimeline ? (
              <button
                type="button"
                data-testid="load-full-history"
                style={styles.streamStartLink}
                disabled={timelineLoading || demoMode}
                title="Retry this activation's one-shot full-history request. Live polling remains recent."
                onClick={() => requestFullTimeline(false)}
              >
                {timelineLoading ? 'Loading…' : 'Retry full history'}
              </button>
            ) : null}
          </div>
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
        <div ref={chartInteractionRef} style={styles.chartStack}>
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
            {chartRailVisible ? (
              <div style={styles.chartViewportControls} data-chart-viewport-controls>
                <div style={styles.chartRailRow}>
                  <ChartPositionRail
                    viewport={chartViewportForRender}
                    durationSeconds={chartRailDurationSeconds}
                    onViewportChange={handleChartViewportChange}
                    onJumpToOffset={onJumpToOffset}
                    disabled={timelineLoading || demoMode}
                    coverageStartSeconds={chartCoverageStartSeconds}
                    ariaLabel="Chart zoom and position"
                    hideRangeLabel
                  />
                </div>
                <div style={styles.chartZoomControls} aria-label="Chart zoom controls">
                  <button
                    type="button"
                    data-chart-zoom-out
                    style={styles.chartZoomButton}
                    disabled={timelineLoading || demoMode || viewportDurationSeconds(chartViewportForRender) >= Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds) - 5}
                    aria-label="Zoom out chart"
                    onClick={() => changeChartZoom('out')}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    data-chart-zoom-reset
                    style={styles.chartZoomReset}
                    disabled={timelineLoading || demoMode || chartAtAvailableRange}
                    onClick={resetChartViewport}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    data-chart-zoom-in
                    style={styles.chartZoomButton}
                    disabled={timelineLoading || demoMode || viewportDurationSeconds(chartViewportForRender) <= Math.min(MIN_VIEWPORT_SECONDS, Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds))}
                    aria-label="Zoom in chart"
                    onClick={() => changeChartZoom('in')}
                  >
                    +
                  </button>
                </div>
              </div>
            ) : null}
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
            rollupsLoading={chartLoading}
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
    justifyContent: 'space-between',
    margin: 0,
    minHeight: 26,
  },
  chartRangeStatus: {
    color: theme.textSecondary,
    flex: '1 1 150px',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.35,
    minWidth: 0,
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
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    marginTop: 2,
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
