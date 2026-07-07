import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { CHART_THEME } from './chartTheme.ts'
import {
  hasMeaningfulGameSegments,
  normalizeGameSegments,
} from './chartRollupUtils.ts'
import type { ExtensionChartPoint } from './extensionChartPoints.ts'
import { nearestChartPointIndex } from './extensionChartPoints.ts'
import { theme } from './theme.ts'

export interface ExtensionSignalChartProps {
  points: ExtensionChartPoint[]
  games?: ExtensionGameSegment[]
  durationSeconds?: number
  selectedOffset?: number | null
  highlightMomentOffsets?: number[]
  height?: number
  loading?: boolean
  emptyMessage?: string
  isLive?: boolean
  onSelectOffset?: (offsetSeconds: number) => void
}

const W = 1000
const PT = 14
const PB = 22

type Pt = [number, number]

type LaneKey = 'chatNorm' | 'viewersNorm' | 'emotesNorm' | 'heat'

function chartHeight(height: number): number {
  return Math.max(120, height)
}

function xForOffset(offsetSeconds: number, minOffset: number, maxOffset: number): number {
  if (maxOffset <= minOffset) return W / 2
  return ((offsetSeconds - minOffset) / (maxOffset - minOffset)) * W
}

function yForNorm(value: number, h: number): number {
  return PT + (1 - Math.max(0, Math.min(100, value)) / 100) * (h - PT - PB)
}

function smoothPath(coords: Pt[]): string {
  if (coords.length === 0) return ''
  if (coords.length < 3) {
    return coords.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ')
  }
  let d = `M${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] ?? coords[i]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[i + 2] ?? p2
    const minX = Math.min(p1[0], p2[0])
    const maxX = Math.max(p1[0], p2[0])
    const c1x = Math.max(minX, Math.min(maxX, p1[0] + (p2[0] - p0[0]) / 6))
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = Math.max(minX, Math.min(maxX, p2[0] - (p3[0] - p1[0]) / 6))
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}

function areaPath(segment: Pt[], h: number): string {
  if (segment.length < 2) return ''
  const first = segment[0]
  const last = segment[segment.length - 1]
  return `${smoothPath(segment)} L ${last[0].toFixed(1)} ${h - PB} L ${first[0].toFixed(1)} ${h - PB} Z`
}

function formatTooltipCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 0,
  }).format(value)
}

export function ExtensionSignalChart({
  points,
  games = [],
  durationSeconds = 0,
  selectedOffset = null,
  highlightMomentOffsets = [],
  height = 176,
  loading = false,
  emptyMessage,
  isLive = false,
  onSelectOffset,
}: ExtensionSignalChartProps) {
  const chartId = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const h = chartHeight(height)
  const timelineDuration = useMemo(() => {
    if (durationSeconds > 0) return durationSeconds
    const last = points[points.length - 1]
    return last ? last.offsetSeconds + 60 : 60
  }, [durationSeconds, points])

  const chartGames = useMemo(
    () => normalizeGameSegments(games, timelineDuration),
    [games, timelineDuration],
  )
  const showGames = hasMeaningfulGameSegments(chartGames, timelineDuration)

  const minOffset = points[0]?.offsetSeconds ?? 0
  const maxOffset = points[points.length - 1]?.offsetSeconds ?? 0
  const endLabel = formatHeatOffset(maxOffset)

  const showViewers = useMemo(
    () => points.some(point => point.viewersNorm > 0),
    [points],
  )

  const lanes = useMemo(() => {
    const base: Array<{ key: LaneKey; label: string; className: string; color: string }> = [
      { key: 'chatNorm', label: 'Chat', className: 'chat', color: CHART_THEME.chat.color },
    ]
    if (showViewers) {
      base.push({
        key: 'viewersNorm',
        label: 'Viewers',
        className: 'viewers',
        color: CHART_THEME.viewer.color,
      })
    }
    base.push(
      { key: 'emotesNorm', label: 'Emotes', className: 'emotes', color: CHART_THEME.emote.color },
      { key: 'heat', label: 'Heat', className: 'heat', color: '#fbbf24' },
    )
    return base
  }, [showViewers])

  const model = useMemo(() => {
    const coords = points.map(point => ({
      point,
      x: xForOffset(point.offsetSeconds, minOffset, maxOffset),
      chat: yForNorm(point.chatNorm, h),
      viewers: yForNorm(point.viewersNorm, h),
      emotes: yForNorm(point.emotesNorm, h),
      heat: yForNorm(point.heat, h),
    }))
    return {
      coords,
      chatLine: coords.map(c => [c.x, c.chat] as Pt),
      viewersLine: coords.map(c => [c.x, c.viewers] as Pt),
      emotesLine: coords.map(c => [c.x, c.emotes] as Pt),
      heatLine: coords.map(c => [c.x, c.heat] as Pt),
    }
  }, [h, maxOffset, minOffset, points])

  const selectedIndex = useMemo(() => {
    if (selectedOffset == null || points.length === 0) return -1
    if (points.some(point => point.offsetSeconds === selectedOffset)) {
      return points.findIndex(point => point.offsetSeconds === selectedOffset)
    }
    return nearestChartPointIndex(points, selectedOffset)
  }, [points, selectedOffset])

  const momentDots = useMemo(() => {
    if (!highlightMomentOffsets.length) return []
    return highlightMomentOffsets
      .filter(offset => Number.isFinite(offset))
      .slice(0, 3)
      .map(offset => {
        const index = nearestChartPointIndex(points, offset)
        const coord = index >= 0 ? model.coords[index] : null
        return coord ? { offset, x: coord.x, y: coord.heat } : null
      })
      .filter((item): item is { offset: number; x: number; y: number } => item != null)
  }, [highlightMomentOffsets, model.coords, points])

  const nearestIndex = useCallback(
    (clientX: number): number => {
      const el = wrapRef.current
      if (!el || points.length === 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = rect.width ? (clientX - rect.left) / rect.width : 0
      const mx = Math.max(0, Math.min(W, ratio * W))
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < model.coords.length; i += 1) {
        const dist = Math.abs(model.coords[i]!.x - mx)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      return best
    },
    [model.coords, points.length],
  )

  const selectIndex = useCallback(
    (index: number) => {
      const point = points[index]
      if (!point || !onSelectOffset) return
      onSelectOffset(point.offsetSeconds)
      setAnnouncement(
        `Selected ${formatHeatOffset(point.offsetSeconds)} · ${formatTooltipCount(point.chatCount)} chat · ${formatTooltipCount(point.emoteCount)} emotes`,
      )
    },
    [onSelectOffset, points],
  )

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    if (!onSelectOffset) return
    selectIndex(nearestIndex(event.clientX))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!onSelectOffset || points.length === 0) return
    const current = selectedIndex >= 0 ? selectedIndex : 0
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      selectIndex(Math.max(0, current - 1))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      selectIndex(Math.min(points.length - 1, current + 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectIndex(points.length - 1)
    }
  }

  if (loading || points.length === 0) {
    return (
      <div
        className="pulse-chart-empty pulse-shimmer"
        style={{ ...styles.empty, height: h }}
        role="status"
      >
        <span style={styles.emptyText}>
          {loading ? 'Loading timeline…' : (emptyMessage ?? 'Waiting for chat rollups…')}
        </span>
      </div>
    )
  }

  const activeIndex = hoverIndex ?? (selectedIndex >= 0 ? selectedIndex : null)
  const activeCoord = activeIndex != null ? model.coords[activeIndex] : null
  const crossPct = activeCoord ? (activeCoord.x / W) * 100 : 0
  const selectedCoord = selectedIndex >= 0 ? model.coords[selectedIndex] : null
  const selectedPct = selectedCoord ? (selectedCoord.x / W) * 100 : null
  const hoverActive = hoverIndex != null

  return (
    <div style={styles.shell} aria-label="Multi-signal activity chart">
      <div
        ref={wrapRef}
        className={`pulse-signal-wrap${onSelectOffset ? ' pulse-signal-wrap--interactive' : ''}`}
        style={{ ...styles.wrap, height: h }}
        tabIndex={onSelectOffset ? 0 : undefined}
        role="img"
        aria-label={`Activity chart from ${formatHeatOffset(minOffset)} to ${endLabel}`}
        onClick={onSelectOffset ? handleClick : undefined}
        onKeyDown={onSelectOffset ? handleKeyDown : undefined}
        onMouseMove={event => setHoverIndex(nearestIndex(event.clientX))}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={styles.svg}
        >
          <defs>
            <linearGradient id={`pulseChartChatFill-${chartId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={CHART_THEME.chat.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={CHART_THEME.chat.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map(f => {
            const y = PT + f * (h - PT - PB)
            return (
              <line
                key={f}
                x1={0}
                x2={W}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
            )
          })}

          {showGames
            ? chartGames.map((segment, index) => {
                if (timelineDuration <= 0) return null
                const startX = (segment.offsetSeconds / timelineDuration) * W
                const endX = ((segment.offsetSeconds + segment.durationSeconds) / timelineDuration) * W
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
                        y1={PT}
                        x2={startX}
                        y2={h - PB}
                        stroke="#f97316"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                        opacity="0.55"
                      />
                    ) : null}
                    {textWidth > 28 ? (
                      <text
                        x={centerX}
                        y={10}
                        fill="#f97316"
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

          <path
            d={areaPath(model.chatLine, h)}
            fill={`url(#pulseChartChatFill-${chartId})`}
            className="pulse-signal-area"
          />
          {showViewers ? (
            <path
              d={smoothPath(model.viewersLine)}
              fill="none"
              stroke={CHART_THEME.viewer.color}
              strokeWidth="1.75"
              className="pulse-signal-line"
            />
          ) : null}
          <path
            d={smoothPath(model.emotesLine)}
            fill="none"
            stroke={CHART_THEME.emote.color}
            strokeWidth="1.75"
            className="pulse-signal-line"
          />
          <path
            d={smoothPath(model.heatLine)}
            fill="none"
            stroke="#fbbf24"
            strokeWidth="1.75"
            strokeDasharray="4 3"
            className="pulse-signal-line"
          />

          {momentDots.map(dot => (
            <circle
              key={dot.offset}
              cx={dot.x}
              cy={dot.y}
              r={3}
              fill="#fbbf24"
              stroke="#fff"
              strokeWidth="1"
              opacity="0.9"
            />
          ))}

          {isLive && points.length > 0 ? (
            <circle
              cx={model.coords[model.coords.length - 1]!.x}
              cy={model.coords[model.coords.length - 1]!.chat}
              r={3.5}
              fill="#34d399"
              stroke="#fff"
              strokeWidth="1.25"
            />
          ) : null}
        </svg>

        {hoverActive && activeCoord ? (
          <span className="pulse-signal-cross" style={{ left: `${crossPct}%` }} aria-hidden="true" />
        ) : null}

        {selectedPct != null ? (
          <span
            className="pulse-signal-selection-line pulse-signal-selection-animated"
            style={{ left: `${selectedPct}%` }}
            aria-hidden="true"
          />
        ) : null}

        {activeCoord ? (
          <div
            className="pulse-sparkline-tooltip pulse-signal-tip"
            style={{ left: `${Math.max(8, Math.min(92, crossPct))}%`, top: 6 }}
          >
            <div style={styles.tipTime}>{formatHeatOffset(activeCoord.point.offsetSeconds)}</div>
            <div style={styles.tipRow}>
              <span style={{ ...styles.tipSwatch, background: CHART_THEME.chat.color }} />
              Chat <b>{formatTooltipCount(activeCoord.point.chatCount)}</b>
            </div>
            {showViewers ? (
              <div style={styles.tipRow}>
                <span style={{ ...styles.tipSwatch, background: CHART_THEME.viewer.color }} />
                Viewers <b>{formatTooltipCount(activeCoord.point.viewerCount)}</b>
              </div>
            ) : null}
            <div style={styles.tipRow}>
              <span style={{ ...styles.tipSwatch, background: CHART_THEME.emote.color }} />
              Emotes <b>{formatTooltipCount(activeCoord.point.emoteCount)}</b>
            </div>
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

      <div style={styles.legendRow} aria-hidden="true">
        {lanes.map(lane => (
          <span key={lane.key} style={styles.legendChip}>
            <span style={{ ...styles.legendDot, background: lane.color }} />
            {lane.label}
          </span>
        ))}
        {showGames ? <span style={{ ...styles.legendChip, color: '#f97316' }}>Games</span> : null}
      </div>

      <div style={styles.axisRow} aria-hidden="true">
        <span>{formatHeatOffset(minOffset)}</span>
        <span>{endLabel}</span>
      </div>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'grid', gap: 4, minWidth: 0, width: '100%' },
  wrap: { position: 'relative', width: '100%' },
  svg: { display: 'block', height: '100%', width: '100%' },
  empty: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  emptyText: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.45,
    maxWidth: 320,
    textAlign: 'center',
  },
  tipTime: {
    color: theme.textMuted,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 9,
    fontWeight: 700,
    marginBottom: 3,
    textTransform: 'none',
  },
  tipRow: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 9,
    fontWeight: 700,
    gap: 5,
    letterSpacing: '0.02em',
    textTransform: 'none',
  },
  tipSwatch: { borderRadius: 2, flexShrink: 0, height: 7, width: 7 },
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
    color: theme.textMuted,
    display: 'flex',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    justifyContent: 'space-between',
    padding: '0 2px',
  },
}
