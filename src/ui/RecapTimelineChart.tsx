import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { deriveLiveStats, formatHeatOffset, MAX_TOP_EMOTES, toLiveStatsInputFromExtension, type LiveHeatPoint } from '@streamclone/pulse-core'
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

export interface RecapTimelineChartProps {
  payload: PulsePayload
  backendUrl: string
  peakOffsets: number[]
  catalog: ExtensionEmote[]
  pinOffsetSeconds?: number | null
  previewOffsetSeconds?: number | null
  sidebarFill?: boolean
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
  onSelectPoint,
  onRequestFullRollups,
}: RecapTimelineChartProps) {
  const hasFullRollups = hasFullTimelineRollups(payload)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [chartHoverOffsetSeconds, setChartHoverOffsetSeconds] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [tracesExpanded, setTracesExpanded] = useState(false)
  const [userCollapsedTraces, setUserCollapsedTraces] = useState(false)
  const fullTimelineRequestedRef = useRef(false)
  const onRequestFullRollupsRef = useRef(onRequestFullRollups)
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
  const showViewerStrip = minuteRollups.some(rollup => (rollup.viewerCount ?? 0) > 0)

  const topEmotesForPicker = useMemo(() => {
    const fromRollups = aggregateChartEmotes(minuteRollups, MAX_TOP_EMOTES)
    if (fromRollups.length > 0) return fromRollups
    return catalog.filter(emote => (emote.count ?? 0) > 0).slice(0, MAX_TOP_EMOTES)
  }, [minuteRollups, catalog])

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
    return displayRollups[displayRollups.length - 1]
  }, [chartHoverOffsetSeconds, displayRollups, pinRollup, previewRollup])

  useEffect(() => {
    fullTimelineRequestedRef.current = false
  }, [payload.streamId])

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
    setTracesExpanded(false)
    setUserCollapsedTraces(false)
  }, [payload.streamId])

  useEffect(() => {
    if (selectedEmotesForOverlay.length === 0) {
      setTracesExpanded(false)
      setUserCollapsedTraces(false)
      return
    }
    if (!userCollapsedTraces) {
      setTracesExpanded(true)
    }
  }, [selectedEmotesForOverlay.length, userCollapsedTraces])

  useEffect(() => {
    if (pinOffsetSeconds != null) {
      setEmotePanelExpanded(false)
    }
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

  const chartHeight = 216
  const readoutOpen = Boolean(readoutRollup)
  const hasPlottedEmotes = selectedEmotesForOverlay.length > 0

  return (
    <div style={styles.block}>
      <StreamActivityChartHeader
        rightControl={<span style={styles.rangeMeta}>Full stream</span>}
        toolbar={
          hasPlottedEmotes ? (
            <button
              type="button"
              style={styles.expandButton}
              onClick={() => {
                if (tracesExpanded) {
                  setUserCollapsedTraces(true)
                  setTracesExpanded(false)
                } else {
                  setUserCollapsedTraces(false)
                  setTracesExpanded(true)
                }
              }}
              aria-pressed={tracesExpanded}
            >
              {tracesExpanded ? 'Collapse traces' : 'Expand traces'}
            </button>
          ) : (
            <span style={styles.toolbarHint}>Select emotes below to plot on chart</span>
          )
        }
        overlayLegend={
          hasPlottedEmotes ? (
            <>
              {selectedEmotesForOverlay.map((emote, index) => {
                const plotColor = emoteOverlays[index]?.color ?? '#fb7185'
                return (
                  <span
                    key={emoteSelectionKey(emote)}
                    style={{
                      ...styles.overlayLegendChip,
                      borderColor: plotColor,
                      boxShadow: `inset 2px 0 0 ${plotColor}`,
                    }}
                    aria-label={emote.name}
                    title={emote.name}
                  >
                    <PulseEmoteImg
                      emote={emote}
                      backendUrl={backendUrl}
                      width={18}
                      height={18}
                      style={styles.overlayLegendEmoteImg}
                    />
                  </span>
                )
              })}
            </>
          ) : undefined
        }
      />

      {readoutOpen && readoutRollup ? (
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
        selectedIndex={pinChartIndex}
        previewIndex={previewChartIndex}
        showViewerStrip={showViewerStrip}
        activityExpanded={tracesExpanded}
        normalizeOverlaySeries={tracesExpanded}
        onSelectIndex={handleChartSelect}
        onHoverOffsetChange={setChartHoverOffsetSeconds}
        overlayLines={emoteOverlays}
        emptyMessage={chartEmpty || 'Loading full stream rollups…'}
        loading={timelineLoading || (minuteRollups.length === 0 && Boolean(onRequestFullRollups))}
        isLive={false}
        reducedMotion
      />

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
        />
      ) : null}

      {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  block: { display: 'grid', gap: 6 },
  rangeMeta: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
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
