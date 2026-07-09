import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import type { BucketMomentPin } from './bucketMoments.ts'
import {
  formatVodClock,
  hasMeaningfulGameSegments,
  indexFromChartClick,
  normalizeGameSegments,
  plotXForIndex,
} from './chartRollupUtils.ts'
import {
  barAlpha,
  barDimOpacity,
  EXTENSION_PORTAL_CHART_THEME,
} from './extensionPortalChartTheme.ts'
import type { ChartSegmentBucket } from './segmentedBarChart.ts'
import { streamPeakFromBuckets } from './segmentedBarChart.ts'
import { theme } from './theme.ts'

export interface SegmentedPulseChartProps {
  buckets: ChartSegmentBucket[]
  games?: ExtensionGameSegment[]
  durationSeconds?: number
  momentPins?: Map<number, BucketMomentPin[]>
  height?: number
  selectedBucketIndex?: number | null
  onSelectBucket?: (bucketIndex: number, bucket: ChartSegmentBucket) => void
  emptyMessage?: string
  loading?: boolean
  isLive?: boolean
  peakChatLabel?: string
  peakEmoteLabel?: string
  headerLabel?: string
  headerMeta?: string
  showMomentsToggle?: boolean
  headerRight?: ReactNode
}

const PAD_LEFT = 4
const PAD_RIGHT = 12
const PAD_TOP = 22
const PAD_BOTTOM = 18
const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 160
const BAR_GAP_RATIO = 0.18
const BAR_WIDTH_RATIO = 0.72

function formatTooltipNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function axisTicks(count: number): number[] {
  if (count <= 1) return [0]
  if (count <= 3) return [0, count - 1]
  const mid = Math.floor((count - 1) / 2)
  return [0, mid, count - 1]
}

function bucketCenterPct(index: number, count: number, padLeft: number, plotWidth: number, width: number): number {
  if (count <= 0) return 0
  const x = plotXForIndex(index, count, padLeft, plotWidth)
  return (x / width) * 100
}

export function SegmentedPulseChart({
  buckets,
  games = [],
  durationSeconds = 0,
  momentPins,
  height = DEFAULT_HEIGHT,
  selectedBucketIndex = null,
  onSelectBucket,
  emptyMessage,
  loading = false,
  isLive = false,
  peakChatLabel,
  peakEmoteLabel,
  headerLabel,
  headerMeta,
  showMomentsToggle = true,
  headerRight,
}: SegmentedPulseChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartWrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [hoverBucket, setHoverBucket] = useState<number | null>(null)
  const hasMomentPins = (momentPins?.size ?? 0) > 0
  const [showMomentPins, setShowMomentPins] = useState(hasMomentPins)

  useLayoutEffect(() => {
    if (hasMomentPins) setShowMomentPins(true)
  }, [hasMomentPins])

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width
      if (next && next > 0) setWidth(Math.round(next))
    })
    observer.observe(node)
    setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)) || DEFAULT_WIDTH)
    return () => observer.disconnect()
  }, [])

  const timelineDuration = useMemo(() => {
    if (durationSeconds > 0) return durationSeconds
    const last = buckets[buckets.length - 1]
    return last ? last.endOffset : 60
  }, [buckets, durationSeconds])

  const chartGames = useMemo(
    () => normalizeGameSegments(games, timelineDuration),
    [games, timelineDuration],
  )
  const showGames = hasMeaningfulGameSegments(chartGames, timelineDuration)

  const { peakChat, peakEmotes } = useMemo(() => streamPeakFromBuckets(buckets), [buckets])
  const chatMax = Math.max(peakChat, 1)
  const emoteMax = Math.max(peakEmotes, 1)

  const plotWidth = width - PAD_LEFT - PAD_RIGHT
  const activityTop = PAD_TOP
  const chatSplit = activityTop + (height - PAD_TOP - PAD_BOTTOM) * 0.52
  const activityBottom = height - PAD_BOTTOM
  const n = buckets.length
  const tooltipBucket = hoverBucket ?? selectedBucketIndex
  const hoverActive = hoverBucket != null

  const barLayout = useMemo(() => {
    if (n === 0) return []
    const slotWidth = plotWidth / Math.max(n, 1)
    const gap = Math.max(1.5, slotWidth * BAR_GAP_RATIO)
    const barWidth = Math.max(1.5, Math.min(slotWidth - gap, slotWidth * BAR_WIDTH_RATIO))
    const offset = Math.max(0, (slotWidth - barWidth) / 2)
    return buckets.map((bucket, index) => {
      const slotX = PAD_LEFT + index * slotWidth
      const x = slotX + offset
      const chatH =
        bucket.chatPeak > 0
          ? ((chatSplit - activityTop) * bucket.chatPeak) / chatMax
          : 1
      const emoteH =
        bucket.emotePeak > 0
          ? ((activityBottom - chatSplit) * bucket.emotePeak) / emoteMax
          : 1
      const isSpike =
        bucket.chatPeak >= chatMax * 0.65
        || bucket.emotePeak >= emoteMax * 0.65
      return {
        bucket,
        index,
        x,
        barWidth,
        centerX: x + barWidth / 2,
        chatY: chatSplit - chatH,
        chatH: Math.max(1, chatH),
        emoteY: activityBottom - emoteH,
        emoteH: Math.max(1, emoteH),
        isSpike,
      }
    })
  }, [buckets, n, plotWidth, chatMax, emoteMax, activityTop, chatSplit, activityBottom])

  const activeLayout =
    tooltipBucket != null ? barLayout.find(item => item.index === tooltipBucket) : undefined
  const activePins = tooltipBucket != null ? momentPins?.get(tooltipBucket) : undefined

  const crossPct =
    tooltipBucket != null ? bucketCenterPct(tooltipBucket, n, PAD_LEFT, plotWidth, width) : 0
  const selectedPct =
    selectedBucketIndex != null
      ? bucketCenterPct(selectedBucketIndex, n, PAD_LEFT, plotWidth, width)
      : null

  function bucketFromEvent(clientX: number): number {
    const rect = chartWrapRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return indexFromChartClick(clientX, rect.left, rect.width, n)
  }

  function handlePointer(event: MouseEvent<HTMLDivElement>): void {
    if (n === 0) return
    setHoverBucket(bucketFromEvent(event.clientX))
  }

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    if (n === 0 || !onSelectBucket) return
    const index = bucketFromEvent(event.clientX)
    const bucket = buckets[index]
    if (bucket) onSelectBucket(index, bucket)
    setHoverBucket(index)
  }

  const tooltipParts: string[] = []
  if (activeLayout) {
    const { bucket } = activeLayout
    tooltipParts.push(
      `${formatHeatOffset(bucket.startOffset)}–${formatHeatOffset(Math.max(bucket.startOffset, bucket.endOffset - 60))}`,
    )
    tooltipParts.push(`${formatTooltipNumber(bucket.chatPeak)} chat`)
    tooltipParts.push(`${formatTooltipNumber(bucket.emotePeak)} emotes`)
    const pin = activePins?.[0]
    if (pin) tooltipParts.push(`${pin.label} · score ${pin.score}`)
  }

  const showEmpty = loading || n === 0

  const axisTickIndexes = axisTicks(n)
  const peakLine =
    peakChatLabel && peakEmoteLabel
      ? `${peakChatLabel} · ${peakEmoteLabel}`
      : peakChat > 0 || peakEmotes > 0
        ? `Peak ${formatTooltipNumber(peakChat)} chat/min · ${formatTooltipNumber(peakEmotes)} emotes/min`
        : null

  const momentsButton =
    showMomentsToggle && hasMomentPins ? (
      <button
        type="button"
        className={`pulse-segment-moments-btn${showMomentPins ? ' is-active' : ''}`}
        aria-pressed={showMomentPins}
        aria-label={showMomentPins ? 'Hide moment markers' : 'Show moment markers'}
        onClick={() => setShowMomentPins(current => !current)}
      >
        Moments
      </button>
    ) : null

  return (
    <div ref={containerRef} className="pulse-segment-chart-wrap" style={styles.shell}>
      {headerLabel || headerMeta || momentsButton || headerRight ? (
        <div style={styles.headerRow}>
          <div style={styles.headerText}>
            {headerLabel ? <span style={styles.headerLabel}>{headerLabel}</span> : null}
            {headerMeta ? <span style={styles.headerMeta}>{headerMeta}</span> : null}
          </div>
          <div style={styles.headerTools}>
            {headerRight}
            {momentsButton}
          </div>
        </div>
      ) : null}
      {peakLine ? <p style={styles.peakLine}>{peakLine}</p> : null}
      {showEmpty ? (
        <div className="pulse-chart-empty pulse-shimmer" style={{ ...styles.empty, height }} role="status">
          <span style={styles.emptyText}>
            {loading ? 'Loading timeline…' : (emptyMessage ?? 'Waiting for chat rollups…')}
          </span>
        </div>
      ) : (
        <div
          ref={chartWrapRef}
          className={`pulse-signal-wrap pulse-segment-chart-surface${onSelectBucket ? ' pulse-signal-wrap--interactive' : ''}`}
          style={{ ...styles.chartSurface, height }}
          onMouseMove={handlePointer}
          onMouseLeave={() => setHoverBucket(null)}
          onClick={onSelectBucket ? handleClick : undefined}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role={onSelectBucket ? 'button' : 'img'}
            aria-label="Segmented chat and emote activity chart"
            style={styles.svg}
          >
            {[0.25, 0.5, 0.75].map(f => {
              const y = PAD_TOP + f * (height - PAD_TOP - PAD_BOTTOM)
              return (
                <line
                  key={f}
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke={EXTENSION_PORTAL_CHART_THEME.grid}
                  strokeWidth="1"
                />
              )
            })}

            {showGames
              ? chartGames.map((segment, index) => {
                  if (timelineDuration <= 0) return null
                  const startX = PAD_LEFT + (segment.offsetSeconds / timelineDuration) * plotWidth
                  const endX = startX + (segment.durationSeconds / timelineDuration) * plotWidth
                  const centerX = (startX + endX) / 2
                  const textWidth = endX - startX
                  const maxChars = Math.floor(textWidth / 7)
                  const displayTitle =
                    segment.gameName.length > maxChars
                      ? `${segment.gameName.slice(0, Math.max(0, maxChars - 3))}…`
                      : segment.gameName

                  return (
                    <g key={`${segment.gameName}-${segment.offsetSeconds}-${index}`}>
                      {segment.offsetSeconds > 0 ? (
                        <line
                          x1={startX}
                          y1={PAD_TOP}
                          x2={startX}
                          y2={activityBottom}
                          stroke={EXTENSION_PORTAL_CHART_THEME.game}
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                          opacity="0.55"
                        />
                      ) : null}
                      {textWidth > 28 ? (
                        <text
                          x={centerX}
                          y={12}
                          fill={EXTENSION_PORTAL_CHART_THEME.game}
                          fontSize="8"
                          fontWeight="900"
                          textAnchor="middle"
                          opacity="0.92"
                        >
                          {displayTitle}
                        </text>
                      ) : null}
                    </g>
                  )
                })
              : null}

            <line
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={chatSplit}
              y2={chatSplit}
              stroke={EXTENSION_PORTAL_CHART_THEME.grid}
              strokeWidth="1"
              strokeDasharray="3 4"
            />

            {barLayout.map(bar => {
              const selected = selectedBucketIndex === bar.index
              const dimGroup = barDimOpacity(tooltipBucket, bar.index)
              const chatAlpha = barAlpha('chat', {
                isSpike: bar.isSpike,
                selected,
                hasValue: bar.bucket.chatPeak > 0,
              })
              const emoteAlpha = barAlpha('emote', {
                isSpike: bar.isSpike,
                selected,
                hasValue: bar.bucket.emotePeak > 0,
              })
              const pin = showMomentPins ? momentPins?.get(bar.index)?.[0] : undefined
              const pinY = Math.min(bar.chatY, bar.emoteY) - 4

              return (
                <g key={bar.index} opacity={dimGroup}>
                  <rect
                    x={bar.x}
                    y={bar.chatY}
                    width={bar.barWidth}
                    height={bar.chatH}
                    fill={EXTENSION_PORTAL_CHART_THEME.chat}
                    opacity={chatAlpha}
                    rx={1.5}
                  />
                  <rect
                    x={bar.x}
                    y={bar.emoteY}
                    width={bar.barWidth}
                    height={bar.emoteH}
                    fill={EXTENSION_PORTAL_CHART_THEME.emotes}
                    opacity={emoteAlpha}
                    rx={1.5}
                  />
                  {pin ? (
                    <circle
                      cx={bar.centerX}
                      cy={Math.max(activityTop + 4, pinY)}
                      r={3}
                      fill={EXTENSION_PORTAL_CHART_THEME.moment}
                      stroke="#fff"
                      strokeWidth="1"
                      opacity={selected ? 1 : 0.88}
                    />
                  ) : null}
                </g>
              )
            })}

            {isLive && n > 0 ? (
              <circle
                cx={plotXForIndex(n - 1, n, PAD_LEFT, plotWidth)}
                cy={chatSplit - 4}
                r={3.5}
                fill={EXTENSION_PORTAL_CHART_THEME.live}
                stroke="#fff"
                strokeWidth="1.25"
              />
            ) : null}
          </svg>

          {hoverActive ? (
            <span className="pulse-signal-cross" style={{ left: `${crossPct}%` }} aria-hidden="true" />
          ) : null}

          {selectedPct != null ? (
            <span
              className="pulse-signal-selection-line pulse-signal-selection-animated"
              style={{ left: `${selectedPct}%` }}
              aria-hidden="true"
            />
          ) : null}

          {activeLayout && tooltipParts.length > 0 ? (
            <div
              className="pulse-sparkline-tooltip pulse-signal-tip"
              style={{ left: `${Math.max(8, Math.min(92, crossPct))}%`, top: 6 }}
            >
              {tooltipParts.join(' · ')}
            </div>
          ) : null}

          {selectedPct != null ? (
            <span
              className="pulse-signal-selection-dot pulse-signal-selection-animated"
              style={{ left: `${selectedPct}%` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      )}

      {!showEmpty && n > 0 ? (
        <div style={styles.legendRow} aria-hidden="true">
          <span style={styles.legendChip}>
            <span style={{ ...styles.legendDot, background: EXTENSION_PORTAL_CHART_THEME.chat }} />
            Chat bars
          </span>
          <span style={styles.legendChip}>
            <span style={{ ...styles.legendDot, background: EXTENSION_PORTAL_CHART_THEME.emotes }} />
            Emote bars
          </span>
          {showGames ? (
            <span style={{ ...styles.legendChip, color: EXTENSION_PORTAL_CHART_THEME.game }}>Games</span>
          ) : null}
        </div>
      ) : null}

      {!showEmpty && n > 0 ? (
        <div style={styles.axisRow} aria-hidden="true">
          {axisTickIndexes.map((index, tickIndex) => {
            const bucket = buckets[index]
            if (!bucket) return null
            const label =
              tickIndex === axisTickIndexes.length - 1 && !isLive
                ? formatHeatOffset(bucket.centerOffset)
                : formatVodClock(bucket.centerOffset)
            const leftPct = (index / Math.max(1, n - 1)) * 100
            const style: CSSProperties =
              tickIndex === 0
                ? { left: 0, textAlign: 'left' }
                : tickIndex === axisTickIndexes.length - 1
                  ? { right: 0, left: 'auto', textAlign: 'right' }
                  : { left: `${leftPct}%`, transform: 'translateX(-50%)', textAlign: 'center' }
            return (
              <span key={bucket.bucketIndex} style={{ ...styles.axisTick, ...style }}>
                {label}
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'grid', gap: 4, minWidth: 0, position: 'relative', width: '100%' },
  headerRow: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
  },
  headerText: { display: 'grid', gap: 2, minWidth: 0 },
  headerLabel: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  headerMeta: { color: theme.textMuted, fontSize: 10, fontWeight: 600 },
  headerTools: { alignItems: 'center', display: 'flex', flexShrink: 0, gap: 6 },
  peakLine: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.02em',
    margin: 0,
  },
  chartSurface: {
    background: EXTENSION_PORTAL_CHART_THEME.panel,
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  svg: { display: 'block', height: '100%', width: '100%' },
  empty: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px dashed rgba(167, 139, 250, 0.22)',
    borderRadius: 10,
    display: 'flex',
    justifyContent: 'center',
    padding: '10px 12px',
    width: '100%',
  },
  emptyText: {
    color: 'rgba(212, 212, 216, 0.92)',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.45,
    maxWidth: 320,
    textAlign: 'center',
  },
  legendRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  legendChip: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'inline-flex',
    fontSize: 9,
    fontWeight: 700,
    gap: 5,
  },
  legendDot: { borderRadius: 999, height: 7, width: 7 },
  axisRow: {
    height: 14,
    marginTop: 2,
    overflow: 'hidden',
    padding: '0 4px',
    position: 'relative',
    width: '100%',
  },
  axisTick: {
    color: 'rgba(161, 161, 170, 0.85)',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    lineHeight: 1.2,
    position: 'absolute',
    top: 0,
    whiteSpace: 'nowrap',
  },
}
