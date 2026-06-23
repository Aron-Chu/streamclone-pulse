import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  MAX_TOP_EMOTES,
  deriveLiveStats,
  formatHeatOffset,
  toLiveStatsInputFromExtension,
  trendArrowGlyph,
  type LiveConfidenceState,
  type LiveStats,
  type TrendDirection,
} from '@streamclone/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import { ChatActivityChart } from './ChatActivityChart.tsx'
import {
  aggregateChartEmotes,
  buildEmoteOverlaySeries,
  chartAlignFromStart,
  chartEmptyMessage,
  describeRollupGap,
  chartMaxPoints,
  chatSeriesFromRollups,
  emoteAveragesFromRollups,
  hasFullTimelineRollups,
  emoteOverlayColor,
  emoteSelectionKey,
  maxSeriesValue,
  prepareChartRollups,
} from './chatActivityEmotes.ts'
import { emoteSyncStatusLabel, emoteSyncStatusTone } from './emoteSync.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { SevenTvEmotePanel } from './SevenTvEmotePanel.tsx'
import { theme } from './theme.ts'

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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [])

  return reduced
}

function formatSignedDelta(delta: number | null): string {
  if (delta === null) return '—'
  if (delta === 0) return '±0'
  return delta > 0 ? `+${delta.toLocaleString()}` : `−${Math.abs(delta).toLocaleString()}`
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
}: {
  value: number
  format?: (value: number) => string
}) {
  const animated = useCountUp(value)
  return (
    <span style={styles.metricValue}>{format ? format(animated) : formatNumber(animated)}</span>
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
}: LiveStatsBandProps) {
  const reducedMotion = useReducedMotion()
  const stats: LiveStats = deriveLiveStats(toLiveStatsInputFromExtension(payload))
  const confidenceStyle = CONFIDENCE_STYLES[stats.confidence]
  const hasFullRollups = hasFullTimelineRollups(payload)
  const rollups = prepareChartRollups(payload, { fullTimeline, currentOffsetSeconds })
  const chartPoints = chartMaxPoints(payload)
  const chartAlignStart = chartAlignFromStart(payload)
  const chartChatSeries = chatSeriesFromRollups(rollups)
  const rollupGapNotice = hasFullRollups ? describeRollupGap(rollups) : null
  const chartEmpty = chartEmptyMessage({
    rollupCount: rollups.length,
    fullTimelineRequested: fullTimeline,
    hasFullRollups,
    confidence: stats.confidence,
    currentOffsetSeconds,
  })
  const chartHeader = hasFullRollups
    ? 'Chat activity (full stream)'
    : fullTimeline
      ? 'Chat activity · waiting for rollups'
      : 'Chat activity (last 60 min)'
  const canShowFullTimeline = hasFullRollups || fullTimeline || currentOffsetSeconds > 0
  const [emotePanelExpanded, setEmotePanelExpanded] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedEmoteKeys, setSelectedEmoteKeys] = useState<string[]>([])
  const topEmotesForChips = (() => {
    const fromRollups = aggregateChartEmotes(rollups, MAX_TOP_EMOTES)
    if (fromRollups.length > 0) return fromRollups
    return (payload.topEmotes?.length ? payload.topEmotes : stats.topEmotes).slice(0, MAX_TOP_EMOTES)
  })()
  const emoteSyncLabel = emoteSyncStatusLabel(payload.emoteSync)
  const emoteSyncTone = emoteSyncStatusTone(payload.emoteSync)
  const emoteAvg5m = emoteAveragesFromRollups(rollups, 5)
  const emoteSyncStyle =
    emoteSyncTone === 'ok'
      ? { color: '#6ee7b7' }
      : emoteSyncTone === 'warn'
        ? { color: '#fcd34d' }
        : { color: theme.textMuted }

  const selectedRollup = selectedIndex != null ? rollups[selectedIndex] : undefined
  const selectedOffsetSeconds = selectedRollup?.offsetSeconds ?? null
  const selectedOverlayEmotes = topEmotesForChips.filter(emote =>
    selectedEmoteKeys.includes(emoteSelectionKey(emote)),
  )
  const emoteOverlays = buildEmoteOverlaySeries(rollups, selectedOverlayEmotes)

  function toggleEmoteOverlay(emote: (typeof topEmotesForChips)[number]): void {
    if (!emotePanelExpanded) return
    const key = emoteSelectionKey(emote)
    setSelectedEmoteKeys(current =>
      current.includes(key) ? current.filter(item => item !== key) : [...current, key].slice(-3),
    )
  }

  function handleSparklineSelect(index: number): void {
    setSelectedIndex(index)
  }

  const lateTracking = coverageStartOffsetSeconds > 60
  const showTimelineMeta = isLive || currentOffsetSeconds > 0 || canShowFullTimeline

  return (
    <PulseSectionCard
      title="Live now"
      titleTone="muted"
      style={{ marginBottom: sidebarFill ? 10 : 14, width: '100%' }}
      meta={
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
      }
    >
      <div
        style={
          compact
            ? { ...styles.metrics, ...styles.metricsCompact }
            : sidebarFill
              ? { ...styles.metrics, ...styles.metricsSidebar }
              : styles.metrics
        }
      >
        <div style={styles.metric}>
          <span style={styles.metricLabel}>Viewers</span>
          <AnimatedMetric value={stats.currentViewers} format={formatNumber} />
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
          <span style={styles.metricRow}>
            <AnimatedMetric value={stats.chatPerMin1m} format={formatNumber} />
            <TrendArrow trend={stats.chatTrend} />
          </span>
          <span style={styles.metricMeta}>
            {formatNumber(stats.chatPerMin5m)} avg · 5m
          </span>
        </div>
        <div style={styles.metric}>
          <span style={styles.metricLabel}>Emotes / min (this minute)</span>
          <AnimatedMetric value={stats.totalEmotePerMin} format={formatNumber} />
          {stats.hasProviderSplit ? (
            <span style={styles.metricMeta}>
              {stats.emoteProviderRates.map(rate => (
                <span key={rate.provider} style={styles.providerRate}>
                  {rate.provider === 'Other' ? 'Other' : rate.provider} {formatNumber(rate.perMinute)}
                </span>
              ))}
            </span>
          ) : (
            <span style={styles.metricMeta}>No emotes this minute</span>
          )}
          {emoteAvg5m.minutes > 0 ? (
            <span style={styles.metricMeta}>
              {formatNumber(emoteAvg5m.sevenTvPerMin)} 7TV avg · 5m
              {emoteAvg5m.totalPerMin !== emoteAvg5m.sevenTvPerMin
                ? ` · ${formatNumber(emoteAvg5m.totalPerMin)} total`
                : ''}
            </span>
          ) : null}
          {rollups.some(r => (r.totalEmoteCount ?? 0) > 0) && stats.totalEmotePerMin === 0 ? (
            <span style={styles.metricHint}>Chart uses full stream; metric is latest minute.</span>
          ) : null}
        </div>
      </div>

      {emoteSyncLabel ? (
        <p style={{ ...styles.emoteSyncNote, ...emoteSyncStyle }}>{emoteSyncLabel}</p>
      ) : null}

      {showTimelineMeta ? (
        <div style={styles.timelineBar}>
          <div style={styles.timelineCopy}>
            {lateTracking && !fullTimeline ? (
              <span style={styles.timelineMeta}>
                Pulse rollups since {formatHeatOffset(coverageStartOffsetSeconds)}
              </span>
            ) : (
              <span style={styles.timelineMeta}>
                {fullTimeline ? 'Full stream timeline' : isLive ? 'Live broadcast timeline' : 'Stream timeline'}
              </span>
            )}
            {isLive && currentOffsetSeconds > 0 ? (
              <span style={styles.timelineMetaMuted}>
                Now {formatHeatOffset(currentOffsetSeconds)}
              </span>
            ) : null}
          </div>
          {showLoadFromStart && onLoadFromStart ? (
            <button
              type="button"
              style={styles.timelineButton}
              disabled={loadFromStartBusy}
              onClick={onLoadFromStart}
            >
              {loadFromStartBusy ? 'Loading…' : 'From stream start'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div style={styles.sparklineBlock}>
        <div style={styles.sparklineHeader}>
          <span style={styles.sparklineLabel}>{chartHeader}</span>
          {selectedOverlayEmotes.length > 0 ? (
            <div style={styles.overlayLegendRow}>
              {selectedOverlayEmotes.map((emote, index) => {
                const series = emoteOverlays[index]
                const peak = series ? maxSeriesValue(series.values) : 0
                const color = emoteOverlayColor(index)
                return (
                  <span key={emoteSelectionKey(emote)} style={styles.overlayLegendChip}>
                    <span style={{ ...styles.overlayLegendDot, background: color }} aria-hidden="true" />
                    <span style={styles.overlayLegendName}>{emote.name}</span>
                    <span style={styles.overlayLegendMeta}>
                      max {formatNumber(peak)}
                      {index === 0 ? ' · focus' : ''}
                    </span>
                  </span>
                )
              })}
            </div>
          ) : null}
        </div>
        <ChatActivityChart
          chatSeries={chartChatSeries}
          offsets={rollups.map(r => r.offsetSeconds)}
          overlays={emoteOverlays}
          reducedMotion={reducedMotion}
          selectedIndex={selectedIndex}
          onSelectIndex={handleSparklineSelect}
          maxPoints={chartPoints}
          height={96}
          emptyMessage={chartEmpty}
          alignFromStart={chartAlignStart}
        />
        {rollupGapNotice ? <p style={styles.gapNotice}>{rollupGapNotice}</p> : null}
        {topEmotesForChips.length > 0 ? (
          <SevenTvEmotePanel
            expanded={emotePanelExpanded}
            onToggleExpanded={() => setEmotePanelExpanded(open => !open)}
            backendUrl={backendUrl}
            rollups={rollups}
            topEmotes={topEmotesForChips}
            selectedKeys={selectedEmoteKeys}
            onToggleEmote={toggleEmoteOverlay}
            selectedOffsetSeconds={selectedOffsetSeconds}
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
  },
  metricsSidebar: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  metricsCompact: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  metric: { display: 'grid', gap: 2, minWidth: 0 },
  metricLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  metricValue: { fontSize: 22, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' },
  metricRow: { alignItems: 'center', display: 'flex', gap: 4 },
  metricMeta: { color: theme.textSecondary, fontSize: 10, fontWeight: 600 },
  metricHint: { color: theme.textMuted, fontSize: 9, fontWeight: 600, lineHeight: 1.35 },
  providerRate: { marginRight: 8 },
  trendArrow: { fontSize: 11, fontWeight: 900 },
  emoteSyncNote: { fontSize: 10, fontWeight: 700, margin: '8px 0 0' },
  timelineBar: {
    alignItems: 'center',
    background: 'rgba(255,255,255,0.03)',
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 10,
    padding: '8px 10px',
  },
  timelineCopy: { display: 'grid', gap: 2, minWidth: 0 },
  timelineMeta: { color: theme.textSecondary, fontSize: 10, fontWeight: 700 },
  timelineMetaMuted: { color: theme.textMuted, fontSize: 10, fontWeight: 600 },
  timelineButton: {
    background: 'rgba(139, 92, 246, 0.14)',
    border: '1px solid rgba(167, 139, 250, 0.35)',
    borderRadius: 8,
    color: '#ddd6fe',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.03em',
    padding: '6px 10px',
    textTransform: 'uppercase',
  },
  sparklineBlock: { display: 'grid', gap: 6, marginTop: 10, minHeight: 96 },
  gapNotice: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  sparklineHeader: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  overlayLegendRow: { display: 'flex', flex: 1, flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', minWidth: 0 },
  overlayLegendChip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    display: 'inline-flex',
    gap: 5,
    padding: '3px 7px',
  },
  overlayLegendDot: { borderRadius: 999, flexShrink: 0, height: 7, width: 7 },
  overlayLegendName: { color: theme.textPrimary, fontSize: 9, fontWeight: 800 },
  overlayLegendMeta: { color: theme.textMuted, fontSize: 8, fontWeight: 700, textTransform: 'uppercase' },
  sparklineLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
}
