import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { SPARKLINE_MAX_POINTS, formatHeatOffset } from '@streamclone/pulse-core'
import { sparklineIndexFromClick, type EmoteOverlaySeries } from './chatActivityEmotes.ts'

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export interface ChatActivityChartProps {
  chatSeries: number[]
  offsets?: number[]
  overlays?: EmoteOverlaySeries[]
  height?: number
  compact?: boolean
  reducedMotion?: boolean
  selectedIndex?: number | null
  onSelectIndex?: (index: number) => void
  maxPoints?: number
  emptyMessage?: string
  alignFromStart?: boolean
}

function formatChartAxisTime(offsetSeconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(offsetSeconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}`
  return `${minutes}m`
}

function axisTickStyle(index: number, total: number, leftPct: number): CSSProperties {
  if (index === 0) {
    return { left: 0, transform: 'none', textAlign: 'left' }
  }
  if (index === total - 1) {
    return { right: 0, left: 'auto', transform: 'none', textAlign: 'right' }
  }
  return { left: `${leftPct}%`, transform: 'translateX(-50%)', textAlign: 'center' }
}

export function ChatActivityChart({
  chatSeries,
  offsets,
  overlays = [],
  height = 40,
  compact = false,
  reducedMotion = false,
  selectedIndex = null,
  onSelectIndex,
  maxPoints = SPARKLINE_MAX_POINTS,
  emptyMessage,
  alignFromStart = false,
}: ChatActivityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const pointLimit = Math.max(2, maxPoints)
  const rawPoints = chatSeries.slice(-pointLimit)
  const points = rawPoints.length === 1 ? [rawPoints[0] ?? 0, rawPoints[0] ?? 0] : rawPoints
  const pointOffsets =
    offsets && offsets.length === rawPoints.length && rawPoints.length === 1
      ? [offsets[0] ?? 0, offsets[0] ?? 0]
      : (offsets?.slice(-pointLimit) ?? [])
  const overlaySeries = overlays.map(series => ({
    ...series,
    values: series.values.slice(-pointLimit),
  }))

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const cssWidth = Math.max(1, parent?.clientWidth ?? canvas.clientWidth ?? 160)
    const cssHeight = Math.max(1, height)
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

    canvas.width = Math.floor(cssWidth * dpr)
    canvas.height = Math.floor(cssHeight * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (points.length < 2) return

    const chatMax = Math.max(1, ...points)
    const overlayMax = Math.max(
      1,
      ...overlaySeries.flatMap(series => series.values.filter(v => v > 0)),
    )
    const stepX = alignFromStart
      ? cssWidth / Math.max(1, points.length - 1)
      : cssWidth / Math.max(1, pointLimit - 1)
    const pad = compact ? 1 : 2
    const usableH = cssHeight - pad * 2
    const offset = alignFromStart ? 0 : pointLimit - points.length

    const coordsFor = (values: number[], max: number) =>
      values.map((v, i) => {
        const x = (offset + i) * stepX
        const y = pad + usableH - (Math.max(0, v) / max) * usableH
        return [x, y] as const
      })

    const chatCoords = coordsFor(points, chatMax)

    ctx.beginPath()
    ctx.moveTo(chatCoords[0][0], cssHeight)
    for (const [x, y] of chatCoords) ctx.lineTo(x, y)
    ctx.lineTo(chatCoords[chatCoords.length - 1][0], cssHeight)
    ctx.closePath()
    ctx.fillStyle = 'rgba(139, 92, 246, 0.18)'
    ctx.fill()

    for (const series of overlaySeries) {
      const coords = coordsFor(series.values, overlayMax)
      ctx.beginPath()
      coords.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.lineWidth = series.primary ? 2 : 1.25
      ctx.strokeStyle = series.color
      ctx.setLineDash(series.primary ? [5, 4] : [4, 3])
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.beginPath()
    chatCoords.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)'
    ctx.setLineDash([])
    ctx.lineJoin = 'round'
    ctx.stroke()

    const markerIndex = selectedIndex ?? hoverIndex
    if (markerIndex != null && markerIndex >= 0 && markerIndex < chatCoords.length) {
      const [x] = chatCoords[markerIndex]
      ctx.beginPath()
      ctx.moveTo(x, pad)
      ctx.lineTo(x, cssHeight - pad)
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.stroke()
    }

    if (selectedIndex != null && selectedIndex >= 0 && selectedIndex < chatCoords.length) {
      const [x, y] = chatCoords[selectedIndex]
      ctx.beginPath()
      ctx.arc(x, y, compact ? 3 : 4, 0, Math.PI * 2)
      ctx.fillStyle = '#f97316'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
  }, [alignFromStart, chatSeries, compact, height, hoverIndex, maxPoints, overlaySeries, pointLimit, points, selectedIndex])

  function handlePointer(event: MouseEvent<HTMLCanvasElement>): void {
    if (rawPoints.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const index = sparklineIndexFromClick(event.clientX, rect, rawPoints.length, pointLimit, alignFromStart)
    setHoverIndex(index)
    setHoverX(event.clientX - rect.left)
  }

  function handleClick(event: MouseEvent<HTMLCanvasElement>): void {
    if (rawPoints.length === 0 || !onSelectIndex) return
    const rect = event.currentTarget.getBoundingClientRect()
    onSelectIndex(sparklineIndexFromClick(event.clientX, rect, rawPoints.length, pointLimit, alignFromStart))
  }

  const tooltipIndex = hoverIndex
  const tooltipOffset = tooltipIndex != null ? pointOffsets[tooltipIndex] : undefined
  const tooltipParts: string[] = []
  if (tooltipOffset != null) tooltipParts.push(formatHeatOffset(tooltipOffset))
  if (tooltipIndex != null) tooltipParts.push(`${formatNumber(rawPoints[tooltipIndex] ?? 0)} chat`)
  if (tooltipIndex != null) {
    for (const series of overlaySeries) {
      const value = series.values[tooltipIndex] ?? 0
      if (value > 0) tooltipParts.push(`${series.label} ${value}`)
    }
  }

  const showEmptyState = rawPoints.length === 0

  const axisTicks: { label: string; leftPct: number }[] = []
  if (!showEmptyState && pointOffsets.length >= 2) {
    const lastIndex = pointOffsets.length - 1
    const tickIndexes =
      lastIndex >= 2
        ? [0, Math.floor(lastIndex / 2), lastIndex]
        : [0, lastIndex]
    const uniqueIndexes = [...new Set(tickIndexes)]
    for (const index of uniqueIndexes) {
      const offset = pointOffsets[index]
      if (offset == null) continue
      const isLast = index === pointOffsets.length - 1
      axisTicks.push({
        label: isLast ? 'Now' : formatChartAxisTime(offset),
        leftPct: (index / Math.max(1, pointOffsets.length - 1)) * 100,
      })
    }
  }

  return (
    <div className="pulse-sparkline-wrap" style={{ minHeight: height, overflow: 'hidden' }}>
      {showEmptyState ? (
        <div className="pulse-chart-empty pulse-shimmer" style={{ ...styles.empty, height }} role="status">
          <span style={styles.emptyText}>{emptyMessage ?? 'Waiting for chat rollups…'}</span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{
            ...styles.canvas,
            height,
            transition: reducedMotion ? 'none' : 'opacity 250ms ease',
          }}
          role={onSelectIndex ? 'button' : 'img'}
          tabIndex={onSelectIndex ? 0 : -1}
          aria-label="Chat activity chart"
          aria-pressed={selectedIndex != null}
          onClick={onSelectIndex ? handleClick : undefined}
          onMouseMove={handlePointer}
          onMouseLeave={() => setHoverIndex(null)}
          onKeyDown={
            onSelectIndex
              ? event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectIndex(selectedIndex != null ? selectedIndex : Math.max(0, rawPoints.length - 1))
                  }
                }
              : undefined
          }
        />
      )}
      {tooltipParts.length > 0 && tooltipIndex != null ? (
        <span className="pulse-sparkline-tooltip" style={{ left: hoverX, top: 0 }}>
          {tooltipParts.join(' · ')}
        </span>
      ) : null}
      {axisTicks.length > 0 ? (
        <div style={styles.axisRow} aria-hidden="true">
          {axisTicks.map((tick, index) => (
            <span
              key={`${tick.label}-${tick.leftPct}`}
              style={{ ...styles.axisTick, ...axisTickStyle(index, axisTicks.length, tick.leftPct) }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  canvas: { cursor: 'pointer', display: 'block', width: '100%' },
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
  axisRow: {
    height: 14,
    marginTop: 4,
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
