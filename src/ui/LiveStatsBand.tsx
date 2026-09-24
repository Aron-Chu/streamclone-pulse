import { useEffect, useId, useMemo, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  deriveLiveStats,
  formatHeatOffset,
  reactionAnalyticalOffset,
  toLiveStatsInputFromExtension,
  trendArrowGlyph,
  type LiveConfidenceState,
  type LiveStats,
  type LiveViewerMetadata,
  type TrendDirection,
} from '@streampulse/pulse-core'
import type { ExtensionPeak, ExtensionRollup, PulsePayload } from '../shared/messages.ts'
import {
  fullHistoryActivationKey,
  hasStableFullHistoryActivation,
  hasValidatedFullHistory,
  makeFullHistoryActivation,
  type FullHistoryRequestResult,
} from '../shared/fullHistoryAuth.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { GamesPlayedStrip } from './GamesPlayedStrip.tsx'
import { PulseOverviewChart } from './PulseOverviewChart.tsx'
import { ChartReadoutBand, type ChartReadoutMode } from './ChartReadoutBand.tsx'
import { ChartMinuteInspectCard } from './ChartMinuteInspectCard.tsx'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'
import { SavedMoments } from './SavedMoments.tsx'
import { resolvePinnedMomentPoint } from './chartSelectedMoment.ts'
import { usePinnedCardHold } from './pinnedCardExit.ts'
import {
  aggregateChartEmotes,
  buildEmoteOverlaySeries,
  CHART_WINDOW_SECONDS,
  DEFAULT_CHART_TIMELINE_WINDOW,
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
  resolveChartCoverageStartSeconds,
  toggleEmotePlotKeys,
  type ChartTimelineWindow,
} from './chatActivityEmotes.ts'
import { downsampleRollupsForChart } from './extensionChartPoints.ts'
import {
  chartHighlightedGameKey,
  chartVisibleRangeFromRollups,
  extensionGamesForOverviewChart,
  extensionRollupViewerCount,
} from './extensionChartAdapter.ts'
import { firstViewerOffsetSeconds, firstActiveRollupOffset, minuteEmoteTotal } from './chartRollupUtils.ts'
import { LiveMetricIcon } from './liveMetricIcons.tsx'
import { emoteSyncStatusLabel, emoteSyncStatusTone } from './emoteSync.ts'
import { overlayGhostChipButton, overlayTextLinkButton } from './momentReasonStyles.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { resolveMostReactedHeat, sortLiveHeatPoints } from './mostReacted.ts'
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
import { classifyViewerAvailability } from './viewerAvailability.ts'
import { selectVisibleChartMomentPeaks } from './chartMomentMarkers.ts'
import {
  advanceFollowingLiveViewport,
  clampViewportToCoverage,
  clampViewportToMaxSpan,
  isFollowingLive,
  jumpToOffset as jumpChartViewportToOffset,
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
  /** When false, explain that the extension—not the backend—has paused refreshes. */
  autoUpdate?: boolean
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
  /** Raw bucket selected on the chart; used when no ranked moment matches it. */
  onChartMinuteSelect?: (rollup: ExtensionRollup | null) => void
  /** Controlled raw bucket snapshot retained when its range is no longer loaded. */
  chartMinuteSelection?: ExtensionRollup | null
  /** Ranked backend moment selected from an opt-in chart marker. */
  onMomentSelect?: (peak: ExtensionPeak) => void
  pinOffsetSeconds?: number | null
  /** Transient ranked-moment preview supplied by the owning Overlay surface. */
  previewOffsetSeconds?: number | null
  /** Ranked-moment origin for the shared chart inspector; null means a raw chart minute. */
  selectedMomentOffsetSeconds?: number | null
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

function formatFreshnessAge(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'stale'
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds)}s ago`
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
  autoUpdate = true,
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
  onChartMinuteSelect,
  chartMinuteSelection = null,
  onMomentSelect,
  pinOffsetSeconds = null,
  previewOffsetSeconds = null,
  selectedMomentOffsetSeconds = null,
  hasVodContext = false,
  coverageTier = null,
  liveMetadata = null,
  demoMode = false,
}: LiveStatsBandProps) {
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
        startedAt: payload.startedAt,
      }),
    [payload.login, payload.streamId, payload.vodId, payload.startedAt],
  )
  const activationKey = fullHistoryActivationKey(activation)
  const hasFullRollups = hasValidatedFullHistory(payload, activation)
  const effectiveCurrentOffsetSeconds = Math.max(
    0,
    currentOffsetSeconds,
    payload.currentOffsetSeconds ?? 0,
  )
  const [chartWindow, setChartWindow] = useState<ChartTimelineWindow>(DEFAULT_CHART_TIMELINE_WINDOW)
  const chartWindowRef = useRef(chartWindow)
  chartWindowRef.current = chartWindow
  const [chartViewport, setChartViewport] = useState<ChartViewport>(() => resolveViewport({ durationSeconds: effectiveCurrentOffsetSeconds, zoomSeconds: 'full' }))
  const chartViewportUserChangedRef = useRef(false)
  const chartWindowAppliedRef = useRef<ChartTimelineWindow | null>(null)
  const previousChartDurationRef = useRef(effectiveCurrentOffsetSeconds)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [fullTimelineFailed, setFullTimelineFailed] = useState(false)
  /** Explicit Full requests are de-duplicated per activation; retries are still user-triggered. */
  const fullTimelineRequestedKeyRef = useRef<string | null>(null)
  const fullTimelineInFlightKeyRef = useRef<string | null>(null)
  const fullTimelineRequestGenerationRef = useRef(0)
  const fullTimelineCategoryKeyRef = useRef(
    `${activationKey}|${payload.category?.trim().toLowerCase() ?? ''}`,
  )
  /** Range changes belong to this stream, not the next activation's startup. */
  const chartWindowUserPickedRef = useRef(false)
  const pendingReturnSpanRef = useRef<number | null>(null)
  const [activationSeen, setActivationSeen] = useState(activation)
  if (fullHistoryActivationKey(activationSeen) !== activationKey) {
    setActivationSeen(activation)
    chartWindowUserPickedRef.current = false
    chartWindowAppliedRef.current = null
    chartWindowRef.current = DEFAULT_CHART_TIMELINE_WINDOW
    setChartWindow(DEFAULT_CHART_TIMELINE_WINDOW)
    fullTimelineRequestedKeyRef.current = null
    fullTimelineInFlightKeyRef.current = null
    fullTimelineRequestGenerationRef.current += 1
    pendingReturnSpanRef.current = null
    // A pending request from the previous surface must not leave the new
    // activation's explicit Full action disabled. Its eventual result is
    // still ignored by the activation guard below.
    setTimelineLoading(false)
    setFullTimelineFailed(false)
  }
  const sparklineBlockRef = useRef<HTMLDivElement | null>(null)
  const onRequestFullTimelineRef = useRef(onRequestFullTimeline)
  onRequestFullTimelineRef.current = onRequestFullTimeline

  useEffect(() => () => {
    fullTimelineRequestGenerationRef.current += 1
  }, [])

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
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  // Spike markers are an optional annotation layer; keep the default chart
  // focused on the activity lines and let the user opt in per stream.
  const [showPeakMarkers, setShowPeakMarkers] = useState(false)
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  // Transient chart hover offset. The chart reports bucket changes (and null on
  // pointer-out), so this is local UI state and is never lifted to the host.
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)

  const handleClearChartSelection = useCallback((): void => {
    pendingReturnSpanRef.current = null
    setChartHoverOffsetSeconds(null)
    onPinOffset?.(null)
    onChartMinuteSelect?.(null)
  }, [onChartMinuteSelect, onPinOffset])

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
    if (!retry && hasValidatedFullHistory(payload, activation)) return
    if (fullTimelineInFlightKeyRef.current === activationKey) return
    if (!retry && fullTimelineRequestedKeyRef.current === activationKey) return

    if (!retry) fullTimelineRequestedKeyRef.current = activationKey
    fullTimelineInFlightKeyRef.current = activationKey
    const requestGeneration = ++fullTimelineRequestGenerationRef.current
    setTimelineLoading(true)
    setFullTimelineFailed(false)
    void request()
      .then(result => {
        if (fullTimelineRequestGenerationRef.current !== requestGeneration) return
        if (result.ok && hasValidatedFullHistory(result.payload, activation)) {
          setFullTimelineFailed(false)
          // History enriches the data; it must not undo a newer range, pan, or zoom.
          if (chartWindowRef.current !== 'full' || chartViewportUserChangedRef.current) return
          const fullRollups = result.payload.fullRollups ?? []
          const lastFullRollupEnd = fullRollups.length > 0
            ? (fullRollups[fullRollups.length - 1]?.offsetSeconds ?? 0) + 60
            : 0
          const fullDuration = Math.max(
            result.payload.currentOffsetSeconds ?? 0,
            lastFullRollupEnd,
          )
          chartWindowAppliedRef.current = 'full'
          // Full is a live-following viewport, not a fixed-length window. If
          // this stays true, the next poll advances the old full span by the
          // new tail delta and silently drops the stream prefix (00:00:33,
          // 00:00:59, ...). Keep it anchored to coverage start until the user
          // actually zooms or pans.
          chartViewportUserChangedRef.current = false
          setChartViewport(resolveViewport({
            durationSeconds: fullDuration,
            zoomSeconds: 'full',
            coverageStartSeconds: 0,
          }))
          return
        }
        setFullTimelineFailed(true)
      })
      .catch(() => {
        if (fullTimelineRequestGenerationRef.current === requestGeneration) setFullTimelineFailed(true)
      })
      .finally(() => {
        if (fullTimelineRequestGenerationRef.current === requestGeneration) {
          fullTimelineInFlightKeyRef.current = null
          setTimelineLoading(false)
        }
      })
  }, [activation, activationKey, payload])

  useEffect(() => {
    if (
      demoMode
      || !needsFullRollups
      || fullTimeline
      || hasFullRollups
    ) return
    requestFullTimeline()
  }, [activationKey, demoMode, fullTimeline, hasFullRollups, needsFullRollups, requestFullTimeline])

  useEffect(() => {
    const category = payload.category?.trim().toLowerCase() ?? ''
    const nextKey = `${activationKey}|${category}`
    const previousKey = fullTimelineCategoryKeyRef.current
    fullTimelineCategoryKeyRef.current = nextKey
    if (
      !isLive
      || !hasFullRollups
      || !category
      || previousKey === nextKey
      || !previousKey.startsWith(`${activationKey}|`)
    ) return
    // Recent polls update the current category but may omit the historical
    // games array. Refresh Full once per category transition so Games Played
    // catches up without turning recurring polling into window=full traffic.
    requestFullTimeline(true)
  }, [activationKey, hasFullRollups, isLive, payload.category, requestFullTimeline])

  useEffect(() => {
    onPinOffset?.(null)
    onChartMinuteSelect?.(null)
    setChartHoverOffsetSeconds(null)
  }, [onChartMinuteSelect, onPinOffset, payload.streamId])

  const pinChartIndex = useMemo(() => {
    if (pinOffsetSeconds == null) return null
    const index = findChartIndexByOffset(chartOffsets, pinOffsetSeconds, {
      bucketed: chartWindow === 'full',
    })
    // A controlled raw-minute selection must never drift to a nearby bucket
    // merely because a narrower range rebuilt the chart at another cadence.
    if (
      index != null
      && chartMinuteSelection?.offsetSeconds === pinOffsetSeconds
      && rollups[index]?.offsetSeconds !== pinOffsetSeconds
    ) return null
    return index
  }, [chartMinuteSelection, pinOffsetSeconds, chartOffsets, chartWindow, rollups])

  const previewChartIndex = useMemo(() => {
    if (previewOffsetSeconds == null) return null
    return findChartIndexByOffset(chartOffsets, previewOffsetSeconds, {
      bucketed: chartWindow === 'full',
    })
  }, [previewOffsetSeconds, chartOffsets, chartWindow])

  const selectedRollup = chartMinuteSelection?.offsetSeconds === pinOffsetSeconds
    ? chartMinuteSelection
    : pinChartIndex != null
      ? rollups[pinChartIndex]
      : undefined

  // Hover preview. The chart reports a bucket change (not every pointer pixel),
  // so this re-renders once per bucket without changing the committed pin.
  const hoverChartIndex = useMemo(() => {
    if (chartHoverOffsetSeconds == null) return null
    return findChartIndexByOffset(chartOffsets, chartHoverOffsetSeconds, {
      bucketed: chartWindow === 'full',
    })
  }, [chartHoverOffsetSeconds, chartOffsets, chartWindow])

  const previewRollupIndex = hoverChartIndex
  // Chart hover only. The Top Moments row coupling also reports a preview index
  // (`previewOffsetSeconds`), but that row sits below the chart: opening a card
  // for it would shift the row out from under the pointer. Chart hover is safe
  // because the plot itself does not move.
  const selectedMomentPoint = useMemo(
    () => resolvePinnedMomentPoint({
      pinOffsetSeconds: selectedMomentOffsetSeconds,
      heatPoints: resolveMostReactedHeat(payload).points,
    }),
    [payload, selectedMomentOffsetSeconds],
  )

  // Clearing the pin used to unmount the inspector on the same frame, so it
  // vanished and the content below snapped up. Hold the last contents for one
  // exit window and let CSS fade and collapse them.
  const inspectorInput = useMemo(
    () => (pinOffsetSeconds != null && selectedRollup
      ? { rollup: selectedRollup, moment: selectedMomentPoint }
      : null),
    [pinOffsetSeconds, selectedRollup, selectedMomentPoint],
  )
  const inspectorHold = usePinnedCardHold(inspectorInput, prefersReducedMotion())

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

  const readoutRollup = useMemo(() => {
    if (chartHoverOffsetSeconds != null) {
      const hovered = rollups.find(rollup => rollup.offsetSeconds === chartHoverOffsetSeconds)
      if (hovered) return hovered
      if (hoverChartIndex != null && rollups[hoverChartIndex]) {
        return rollups[hoverChartIndex]
      }
    }
    if (selectedRollup) return selectedRollup
    if (previewOffsetSeconds != null && previewChartIndex != null) {
      return rollups[previewChartIndex]
    }
    return undefined
  }, [chartHoverOffsetSeconds, rollups, hoverChartIndex, selectedRollup, previewOffsetSeconds, previewChartIndex])

  const minuteReadoutEmotes = readoutRollup?.topEmotes?.filter(emote => (emote.count ?? 0) > 0) ?? []
  const canShowStreamEmoteFallback = Boolean(
    readoutRollup
    && minuteEmoteTotal(readoutRollup) > 0
    && topEmotesForChips.length > 0,
  )
  const readoutEmotes = minuteReadoutEmotes.length > 0
    ? minuteReadoutEmotes
    : canShowStreamEmoteFallback
      ? topEmotesForChips
      : []
  const readoutEmoteScope = minuteReadoutEmotes.length > 0 ? 'minute' : 'stream'

  const chartReadoutMode: ChartReadoutMode = readoutRollup && chartHoverOffsetSeconds != null
    && readoutRollup.offsetSeconds !== pinOffsetSeconds
    ? 'preview'
    : pinOffsetSeconds != null
      ? 'selected'
      : readoutRollup
        ? 'preview'
        : 'idle'

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

  const { chartPeakMarkers, chartPeakMarkerTotal } = useMemo(() => {
    const heat = resolveMostReactedHeat(payload)
    const ranked = sortLiveHeatPoints(heat.points, 'reaction')
    const selected: ExtensionPeak[] = ranked.map(point => ({
      offsetSeconds: point.offsetSeconds,
      score: point.score,
      compositeScore: point.compositeScore,
      reactionScore: point.reactionScore,
      viewerMomentumScore: point.viewerMomentumScore,
      reasons: [point.reason],
      reasonLabel: point.reasonLabel,
      dominantSignal: point.reason,
      chatCount: point.chatCount,
      emoteCount: point.emoteCount,
      topEmotes: point.topEmotes.map(emote => ({
        name: emote.name,
        imageUrl: emote.imageUrl,
        count: emote.count,
        provider: emote.provider,
      })),
      reactionOnsetOffsetSeconds: point.reactionOnsetOffsetSeconds,
      reactionApexOffsetSeconds: point.reactionApexOffsetSeconds,
      seekOffsetSeconds: point.seekOffsetSeconds,
      precisionSeconds: point.precisionSeconds,
      refinementStatus: point.refinementStatus,
      refinementConfidence: point.refinementConfidence,
      reactionScoringVersion: point.reactionScoringVersion,
    }))
    return {
      chartPeakMarkers: selected,
      chartPeakMarkerTotal: ranked.length,
    }
  }, [payload])

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
    // A recent-only payload does not describe the uncovered stream prefix.
    // Its rail must therefore end at the last loaded bucket, not at the
    // stream clock, or the thumb falsely claims full-stream coverage.
    return hasFullRollups
      ? Math.max(currentOffsetSeconds, payload.currentOffsetSeconds ?? 0, lastRollupEnd)
      : lastRollupEnd
  }, [currentOffsetSeconds, hasFullRollups, payload.currentOffsetSeconds, chartRailRollups])
  const chartCoverageStartSeconds = chartWindow === 'full'
    ? 0
    : hasFullRollups
      ? resolveChartCoverageStartSeconds(
        payload,
        coverageStartOffsetSeconds,
        chartRailRollups[0]?.offsetSeconds,
      )
      : Math.max(0, chartRailRollups[0]?.offsetSeconds ?? 0)
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
    () => clampViewportToMaxSpan(
      chartViewport,
      chartRailDurationSeconds,
      chartWindow === 'full' ? 'full' : CHART_WINDOW_SECONDS[chartWindow],
      chartCoverageStartSeconds,
    ),
    [chartCoverageStartSeconds, chartRailDurationSeconds, chartViewport, chartWindow],
  )

  const chartPeakMarkerVisibleCount = useMemo(() => {
    return selectVisibleChartMomentPeaks(
      chartPeakMarkers,
      chartViewportForRender.startSeconds,
      chartViewportForRender.endSeconds,
    ).visible.length
  }, [chartPeakMarkers, chartViewportForRender.endSeconds, chartViewportForRender.startSeconds])

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
      const capped = clampViewportToMaxSpan(
        next,
        chartRailDurationSeconds,
        chartWindow === 'full' ? 'full' : CHART_WINDOW_SECONDS[chartWindow],
        chartCoverageStartSeconds,
      )
      if (
        capped.startSeconds === current.startSeconds
        && capped.endSeconds === current.endSeconds
      ) return current
      return capped
    })
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, chartWindow])

  // The range selector is a viewport preset. Apply it once per selected range
  // so live polling advances a following viewport without resetting a user's
  // pan/drag position on every payload update.
  useEffect(() => {
    if (chartRailDurationSeconds <= 0 || chartWindowAppliedRef.current === chartWindow) return
    chartWindowAppliedRef.current = chartWindow
    chartViewportUserChangedRef.current = chartWindow !== 'full'
    const zoomSeconds = chartWindow === 'full' ? 'full' : CHART_WINDOW_SECONDS[chartWindow]
    setChartViewport(resolveViewport({
      durationSeconds: chartRailDurationSeconds,
      zoomSeconds,
      anchorSeconds: chartRailDurationSeconds,
      followEnd: true,
      coverageStartSeconds: chartCoverageStartSeconds,
    }))
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, chartWindow])

  const handleChartWindowChange = useCallback((window: ChartTimelineWindow): void => {
    chartWindowUserPickedRef.current = true
    const reselected = chartWindowRef.current === window
    chartWindowRef.current = window
    chartWindowAppliedRef.current = reselected && chartRailDurationSeconds > 0 ? window : null
    chartViewportUserChangedRef.current = window !== 'full'
    pendingReturnSpanRef.current = null
    // A new preset needs its own rollups and coverage bounds from the next
    // render. Only a reselected preset can safely reuse the current domain.
    if (reselected) {
      setChartViewport(resolveViewport({
        durationSeconds: chartRailDurationSeconds,
        zoomSeconds: window === 'full' ? 'full' : CHART_WINDOW_SECONDS[window],
        anchorSeconds: chartRailDurationSeconds,
        coverageStartSeconds: chartCoverageStartSeconds,
      }))
    }
    setChartWindow(window)
    onChartWindowChange?.(window)
    if (chartWindowNeedsFullFetch(window, payload, effectiveCurrentOffsetSeconds, activation)) requestFullTimeline()
  }, [activation, chartCoverageStartSeconds, chartRailDurationSeconds, effectiveCurrentOffsetSeconds, onChartWindowChange, payload, requestFullTimeline])

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
    const clamped = clampViewportToMaxSpan(
      next,
      chartRailDurationSeconds,
      chartWindow === 'full' ? 'full' : CHART_WINDOW_SECONDS[chartWindow],
      chartCoverageStartSeconds,
    )
    const availableDuration = Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds)
    const isFullFollowingViewport = chartWindow === 'full'
      && viewportDurationSeconds(clamped) >= availableDuration - 5
    chartViewportUserChangedRef.current = !isFullFollowingViewport
    setChartViewport(clamped)
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, chartWindow])

  const changeChartZoom = useCallback((direction: 'in' | 'out'): void => {
    if (chartRailDurationSeconds <= 0) return
    const currentDuration = viewportDurationSeconds(chartViewportForRender)
    const availableDuration = Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds)
    const maxRangeDuration = chartWindow === 'full'
      ? availableDuration
      : Math.min(CHART_WINDOW_SECONDS[chartWindow], availableDuration)
    const nextDuration = direction === 'in'
      ? Math.max(Math.min(MIN_VIEWPORT_SECONDS, availableDuration), currentDuration / 1.5)
      : Math.min(maxRangeDuration, currentDuration * 1.5)
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
    chartWindow,
    chartViewportForRender,
    handleChartViewportChange,
  ])

  const resetChartViewport = useCallback((): void => {
    if (chartRailDurationSeconds <= 0) return
    handleChartViewportChange(
      resolveViewport({
        durationSeconds: chartRailDurationSeconds,
        zoomSeconds: chartWindow === 'full' ? 'full' : CHART_WINDOW_SECONDS[chartWindow],
        anchorSeconds: chartRailDurationSeconds,
        followEnd: true,
        coverageStartSeconds: chartCoverageStartSeconds,
      }),
    )
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, chartWindow, handleChartViewportChange])

  const returnToSelected = useCallback((): void => {
    if (pinOffsetSeconds == null || chartRailDurationSeconds <= 0) return
    const span = viewportDurationSeconds(chartViewportForRender)
    if (pinChartIndex == null) {
      pendingReturnSpanRef.current = span
      if (chartWindow !== 'full') {
        chartWindowUserPickedRef.current = true
        chartWindowAppliedRef.current = null
        setChartWindow('full')
        onChartWindowChange?.('full')
      }
      if (!hasFullRollups && onRequestFullTimelineRef.current) {
        requestFullTimeline(fullTimelineFailed)
      }
      return
    }
    pendingReturnSpanRef.current = null
    chartViewportUserChangedRef.current = true
    handleChartViewportChange(jumpChartViewportToOffset(
      chartViewportForRender,
      pinOffsetSeconds,
      chartRailDurationSeconds,
      span,
      chartCoverageStartSeconds,
    ))
  }, [
    chartCoverageStartSeconds,
    chartRailDurationSeconds,
    chartViewportForRender,
    chartWindow,
    fullTimelineFailed,
    handleChartViewportChange,
    hasFullRollups,
    onChartWindowChange,
    pinChartIndex,
    pinOffsetSeconds,
    requestFullTimeline,
  ])

  useEffect(() => {
    if (
      pendingReturnSpanRef.current == null
      || !hasFullRollups
      || pinChartIndex == null
      || pinOffsetSeconds == null
      || chartRailDurationSeconds <= 0
    ) return
    const span = pendingReturnSpanRef.current
    pendingReturnSpanRef.current = null
    chartViewportUserChangedRef.current = true
    setChartViewport(current => jumpChartViewportToOffset(
      current,
      pinOffsetSeconds,
      chartRailDurationSeconds,
      span,
      chartCoverageStartSeconds,
    ))
  }, [chartCoverageStartSeconds, chartRailDurationSeconds, hasFullRollups, pinChartIndex, pinOffsetSeconds])

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
    // Bucket selection is independent of legend focus and plotted overlays.
    onPinOffset?.(rollup.offsetSeconds)
    onChartMinuteSelect?.(rollup)
  }, [onChartMinuteSelect, onPinOffset, rollups])

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
    setShowPeakMarkers(false)
    setEmotePanelExpanded(false)
    onPinOffset?.(null)
    onChartMinuteSelect?.(null)
    // Reset coupled chart selection state only when the surface identity
    // changes. Same-stream VOD enrichment intentionally keeps this identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Use the prepared chart source for viewer availability as well as drawing.
  // It contains validated full history when available and preserves real
  // recent Helix samples merged into that source when the full response is
  // sparse. Reading payload.fullRollups directly here made the viewer lane
  // disappear immediately after a successful Full request that omitted its
  // newest samples.
  const viewerSourceRollups = rollups
  const viewerSamples = useMemo(
    () => viewerSourceRollups.filter(
      rollup => extensionRollupViewerCount(rollup) !== undefined,
    ),
    [viewerSourceRollups],
  )
  const viewerSamplesAvailable = viewerSamples.length > 0
  const viewerSamplesInRange = viewerSamples.filter(
    rollup => rollup.offsetSeconds >= chartViewportForRender.startSeconds
      && rollup.offsetSeconds < chartViewportForRender.endSeconds,
  )
  // Helix-enabled live payloads can legitimately arrive before their first
  // viewer sample. Reserve the lane only during a short warm-up; a long empty
  // lane is misleading when the provider has stopped producing samples.
  const viewerLaneExpected = isLive && (
    payload.helixEnabled === true
    || payload.viewerStartOffsetSeconds != null
    || payload.peakViewers != null
  )
  const viewerWarming = viewerLaneExpected
    && !viewerSamplesAvailable
    && effectiveCurrentOffsetSeconds <= 3 * 60
  const viewerAvailability = classifyViewerAvailability({
    sampleCount: viewerSamples.length,
    samplesInRange: viewerSamplesInRange.length,
    isLive,
    latestSampleOffsetSeconds: viewerSamples[viewerSamples.length - 1]?.offsetSeconds,
    currentOffsetSeconds: effectiveCurrentOffsetSeconds,
  })
  // Always show the viewer lane on live streams so the placeholder is visible
  // when data is warming up or the backend hasn't enabled Helix sampling.
  const showViewerStrip = isLive || viewerAvailability === 'visible' || viewerAvailability === 'paused' || viewerWarming
  // Only real sampled points determine the viewer axis. Headline metadata is
  // intentionally excluded so a stale snapshot cannot reshape the graph.
  const viewerPeak = viewerSamples.length > 0
    ? Math.max(...viewerSamples.map(rollup => extensionRollupViewerCount(rollup) ?? 0))
    : 0
  const viewerStartOffsetSeconds = Math.max(
    0,
    viewerSamples[0]?.offsetSeconds
      ?? payload.viewerStartOffsetSeconds
      ?? firstViewerOffsetSeconds(rollups),
  )
  const viewerEndOffsetSeconds = viewerSamples[viewerSamples.length - 1]?.offsetSeconds ?? null
  const viewerPaused = viewerAvailability === 'paused'
  // The chart itself is the healthy-state proof. Keep the header badge for
  // actionable or degraded states where it tells the user what changed.
  const showConfidenceBadge = viewerPaused || stats.confidence !== 'Synced'
  const viewerTimelineHint = viewerSamplesAvailable && viewerEndOffsetSeconds != null
    ? isLive
      ? `Viewer data from ${formatHeatOffset(viewerStartOffsetSeconds)} · ${!autoUpdate || viewerPaused ? 'latest sample ' + formatHeatOffset(viewerEndOffsetSeconds) : 'sampling now'}`
      : `Viewer data ${formatHeatOffset(viewerStartOffsetSeconds)}–${formatHeatOffset(viewerEndOffsetSeconds)}`
    : null
  const viewerUnavailableDetail = viewerSamplesAvailable && viewerEndOffsetSeconds != null
    ? isLive
      ? `Viewer tracking began at ${formatHeatOffset(viewerStartOffsetSeconds)}. This minute is outside the sampled viewer data.`
      : `Viewer tracking ran from ${formatHeatOffset(viewerStartOffsetSeconds)} to ${formatHeatOffset(viewerEndOffsetSeconds)} for this stream.`
    : 'Viewer count was not sampled for this minute.'
  const viewerStatusText = !autoUpdate && isLive
    ? 'Viewer updates paused'
    : viewerWarming
      ? 'Viewer data warming'
      : viewerAvailability === 'historical'
        ? 'Viewer samples outside this range'
        : viewerAvailability === 'paused'
          ? 'Viewer timeline delayed'
          : viewerAvailability === 'absent' && viewerLaneExpected
        ? 'Viewer data unavailable'
        : null
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
    && shouldShowChartRail(
      chartViewportForRender,
      chartRailDurationSeconds,
      chartCoverageStartSeconds,
    )
  const chartAtAvailableRange =
    chartRailDurationSeconds <= 0
    || (chartViewportForRender.startSeconds <= chartCoverageStartSeconds + 5
      && chartViewportForRender.endSeconds >= chartRailDurationSeconds - 5)
  const chartMaxRangeDuration = chartWindow === 'full'
    ? Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds)
    : Math.min(
      CHART_WINDOW_SECONDS[chartWindow],
      Math.max(0, chartRailDurationSeconds - chartCoverageStartSeconds),
    )
  const chartAtRangeLimit = chartMaxRangeDuration <= 0
    || viewportDurationSeconds(chartViewportForRender) >= chartMaxRangeDuration - 5
  const chartIsFullRange = chartWindow === 'full' && chartAtAvailableRange
  const chartRangeStatus = chartIsFullRange
    ? 'Full stream'
    : chartAtAvailableRange
      ? `Available coverage · ${formatHeatOffset(chartCoverageStartSeconds)}–${formatHeatOffset(chartRailDurationSeconds)}`
      : `Viewing ${formatHeatOffset(chartViewportForRender.startSeconds)} – ${formatHeatOffset(chartViewportForRender.endSeconds)}`
  const chartStatusText = [
    emoteSyncLabel,
    emoteChartHint,
    viewerStatusText,
  ].filter(Boolean).join(' · ')
  const viewerMetricValue = stats.viewerState === 'stale' ? null : stats.currentViewers
  const viewerMetricMeta = stats.viewerState === 'stale' && liveMetadata?.viewerCount != null
    ? `Last known ${formatNumber(liveMetadata.viewerCount)} · ${formatFreshnessAge(liveMetadata.freshnessSeconds)}`
    : `${formatSignedDelta(stats.viewerDelta5m)} · 5m${stats.viewerState === 'unknown' ? ' · unavailable' : ''}`

  return (
    <PulseSectionCard
      title="Live now"
      titleTone="muted"
      style={{ marginBottom: sidebarFill ? 10 : 14, width: '100%' }}
      meta={
        <span style={styles.headerMeta}>
          {onOpenFullAnalytics && !demoMode ? (
            <button type="button" style={styles.analyticsHeaderLink} onClick={onOpenFullAnalytics}>
              Stream analytics →
            </button>
          ) : null}
          {showConfidenceBadge ? (
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
              data-chart-confidence={stats.confidence}
            >
              {viewerPaused ? 'Viewer history delayed' : stats.confidence}
            </span>
          ) : null}
        </span>
      }
    >
      <div style={metricsStyle}>
        <div style={styles.metric}>
          <span style={styles.metricLabel}>Viewers</span>
          <span style={styles.metricValueRow}>
            <LiveMetricIcon kind="viewers" />
            <AnimatedMetric value={viewerMetricValue} format={formatNumber} valueStyle={sidebarFill ? styles.metricValueSidebar : undefined} />
          </span>
          <span style={{ ...styles.metricMeta, color: stats.viewerState === 'stale' ? '#fcd34d' : theme.textMuted }}>
            {viewerMetricMeta}
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

      {!demoMode && chartPeakMarkers[0] && onMomentSelect ? (
        <button type="button" data-featured-moment="true" data-chart-action="true"
          // Same pairing SavedMoments uses: the chip styles already carry the
          // transition and accent hover, this button just never had the class.
          className="pulse-action-chip pulse-action-chip-primary"
          style={{ ...overlayGhostChipButton, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', whiteSpace: 'normal' }}
          onClick={() => onMomentSelect(chartPeakMarkers[0])}>
          <span style={{ flex: 1 }}>Strongest loaded moment · {formatHeatOffset(chartPeakMarkers[0].offsetSeconds)}</span>
          {chartPeakMarkers[0].topEmotes?.slice(0, 3).map(emote => <span key={emote.name} title={emote.name} style={{ width: 20, height: 20, overflow: 'hidden', flexShrink: 0 }}><PulseEmoteImg emote={emote} backendUrl={backendUrl} width={20} height={20} /></span>)}
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
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
          // Full-history enrichment is independent from the visible preset.
          // Keep the selector usable so users can move between every range
          // while an optional background request is still settling.
          rangeDisabled={demoMode}
          onRangeChange={handleChartWindowChange}
          auxiliaryControls={
            <>
              {showPartialRangeStatus ? (
                <button
                  type="button"
                  data-testid="show-full-stream"
                  style={styles.streamStartLink}
                  disabled={demoMode}
                  aria-label="Show full stream"
                  title="Show the entire broadcast on the chart (does not change live poll)"
                  onClick={() => handleChartWindowChange('full')}
                >
                  Full
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
          expandControl={
            <div style={styles.chartToolbarActions}>
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
                data-chart-moment-total={chartPeakMarkerTotal}
                title={chartPeakMarkers.length > 0
                  ? `${chartPeakMarkerVisibleCount} of ${chartPeakMarkerTotal} ranked moments in this range`
                  : 'No backend spikes are available yet'}
                onClick={() => setShowPeakMarkers(current => !current)}
              >
                Spikes{chartPeakMarkers.length > 0
                  ? ` · ${chartPeakMarkerVisibleCount}`
                  : ''}
              </button>
              <button
                type="button"
                className={`pulse-chart-expand-btn${activityExpanded ? ' pulse-chart-expand-btn-active' : ''}`}
                style={{
                  ...styles.expandButton,
                  ...(activityExpanded ? styles.expandButtonActive : null),
                }}
                data-chart-action="true"
                onClick={() => {
                  if (activityExpanded) resetChartExpansion()
                  else chartExpansion.expand()
                }}
                aria-expanded={activityExpanded}
                aria-controls={chartRegionId}
                aria-label={activityExpanded ? 'Reset stream activity chart' : 'Expand stream activity chart'}
              >
                {activityExpanded ? 'Reset' : 'Expand'}
              </button>
            </div>
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
            onClearSelection={demoMode ? undefined : handleClearChartSelection}
          />
          <div style={styles.chartStack}>
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
              viewerLaneExpected={viewerLaneExpected}
              viewerLaneCompact={!autoUpdate || viewerAvailability === 'paused'}
              viewerUpdatesPaused={!autoUpdate}
              viewerPeak={viewerPeak}
              viewerSampleStartOffsetSeconds={viewerSamplesAvailable ? viewerStartOffsetSeconds : null}
              viewerSampleEndOffsetSeconds={viewerEndOffsetSeconds}
              viewerSampleWindowComplete={!isLive}
              activityExpanded={activityExpanded}
              normalizeOverlaySeries={selectedEmotesForOverlay.length > 0}
              focusedSeriesKey={demoMode ? null : focusedSeriesKey}
              onFocusedSeriesKeyChange={demoMode ? undefined : setFocusedSeriesKey}
              onSelectIndex={demoMode ? undefined : handleChartSelect}
              onClearSelection={demoMode ? undefined : handleClearChartSelection}
              onHoverOffsetChange={demoMode ? undefined : setChartHoverOffsetSeconds}
              viewport={chartUsesViewport ? chartViewportForRender : undefined}
              coverageStartSeconds={chartCoverageStartSeconds}
              onViewportChange={chartUsesViewport ? handleChartViewportChange : undefined}
              onJumpToOffset={onJumpToOffset}
              highlightedGameSegmentKey={chartHighlightedGameKeyValue}
              overlayLines={emoteOverlays}
              peakMarkers={chartPeakMarkers}
              showPeakMarkers={showPeakMarkers}
              onSelectMoment={demoMode ? undefined : onMomentSelect}
              emptyMessage={chartEmpty}
              loading={chartLoading}
              isLive={isLive}
              emoteSyncTone={emoteSyncTone}
            />
          </div>
          {inspectorHold.point ? (
            <div
              className={inspectorHold.exiting ? 'pulse-moment-card-exit' : undefined}
              style={styles.chartInspector}
              data-chart-inspector-owner="activity-chart"
              data-chart-inspector-kind={inspectorHold.point.moment ? 'moment' : 'minute'}
              data-chart-inspector-exiting={inspectorHold.exiting ? 'true' : undefined}
              aria-live="polite"
            >
              {inspectorHold.point.moment ? (
                <SelectedMomentCard
                  point={inspectorHold.point.moment}
                  backendUrl={backendUrl}
                  compact
                  jumpLabel={hasVodContext || payload.vodId ? 'Jump in VOD' : 'Jump in player'}
                  onJump={point => onJumpToOffset?.(reactionAnalyticalOffset(point))}
                  onAnalytics={point => onOpenAnalytics?.(reactionAnalyticalOffset(point))}
                  onClear={handleClearChartSelection}
                  viewerUnavailableDetail={viewerUnavailableDetail}
                />
              ) : (
                <ChartMinuteInspectCard
                  rollup={inspectorHold.point.rollup}
                  backendUrl={backendUrl}
                  jumpLabel={hasVodContext || payload.vodId ? 'Jump in VOD' : 'Jump in player'}
                  onJump={onJumpToOffset}
                  onAnalytics={onOpenAnalytics}
                  onClose={handleClearChartSelection}
                  viewerUnavailableDetail={viewerUnavailableDetail}
                />
              )}
            </div>
          ) : null}
        </div>
        {chartRailVisible ? (
          <ChartViewportControls
            viewport={chartViewportForRender}
            durationSeconds={chartRailDurationSeconds}
            coverageStartSeconds={chartCoverageStartSeconds}
            rangeLabel={chartRangeStatus}
            hasMeaningfulData={chartHasMeaningfulData}
            disabled={demoMode}
            zoomOutDisabled={
              chartAtRangeLimit
            }
            resetDisabled={chartAtRangeLimit && isFollowingLive(chartViewportForRender, chartRailDurationSeconds)}
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
            selectedOffsetSeconds={pinOffsetSeconds}
            onReturnToSelected={returnToSelected}
            coverageHint={
              showCoverageStartHint || sparseActivityWarmup || viewerTimelineHint || (showLoadFromStart && onLoadFromStart) ? (
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
                  {(showCoverageStartHint || sparseActivityWarmup) && viewerTimelineHint ? (
                    <span style={styles.timelineHintSep}> · </span>
                  ) : null}
                  {viewerTimelineHint ? (
                    <span>{viewerTimelineHint}</span>
                  ) : null}
                  {(showCoverageStartHint || sparseActivityWarmup || viewerTimelineHint) && showLoadFromStart && onLoadFromStart ? (
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
        {!demoMode ? <SavedMoments login={payload.login} streamId={payload.streamId} vodId={payload.vodId ?? undefined} selected={selectedMomentPoint} /> : null}
        {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
        {topEmotesForChips.length > 0 ? (
          <div data-chart-action="true">
            <SevenTvEmotePanel
              expanded={emotePanelExpanded}
              onToggleExpanded={demoMode ? () => undefined : () => setEmotePanelExpanded(open => !open)}
              backendUrl={backendUrl}
              rollups={rollups}
              topEmotes={topEmotesForChips}
              selectedKeys={selectedEmoteKeys}
              onToggleEmote={toggleEmotePanelKey}
              onClearPlots={() => setSelectedEmoteKeys([])}
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
  trendArrow: { fontSize: 11, fontWeight: 900 },
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
  timelineHintWarn: {
    color: '#fcd34d',
  },
  timelineHintSep: { color: theme.textMuted },
  streamStartLink: {
    ...overlayTextLinkButton,
    fontSize: 10,
  },
  chartSurface: {
    minWidth: 0,
    width: '100%',
  },
  chartInspector: {
    marginTop: 8,
    minWidth: 0,
    width: '100%',
  },
  chartLeadIn: {
    display: 'grid',
    gap: 4,
  },
  chartToolbarActions: {
    alignItems: 'center',
    display: 'inline-flex',
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
