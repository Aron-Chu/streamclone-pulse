import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { SPARKLINE_MAX_POINTS, formatHeatOffset } from '@streamclone/pulse-core'
import type { ChartTimelineWindow } from './chatActivityEmotes.ts'
import { findChartIndexByOffset, mapPeakOffsetsToBucketedChartIndices, mapPeakOffsetsToChartIndices, sparklineIndexFromClick, type EmoteOverlaySeries } from './chatActivityEmotes.ts'
import {
  alignSeriesToChartPoints,
  chatAreaFillAlpha,
  chatAreaFillColor,
  chatAreaLineAlpha,
  chatBarFillAlpha,
  chatBarFillColor,
  chartBarWidth,
  chartRenderDensity,
  overlayLineAlpha,
  overlayLineWidth,
  overlayStrokeColor,
  shouldDrawEmoteOverlays,
  shouldDrawIndividualBars,
  smoothChartSeries,
  useAreaSilhouette,
  isSilhouetteOnlyWindow,
} from './chartRenderUtils.ts'
import { CHART_THEME, hexToRgba } from './chartTheme.ts'
import { lerpScalar } from './motion/useSmoothedScalar.ts'

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

const PEAK_DART_COLOR = CHART_THEME.perEmotePalette[4] ?? '#facc15'

export interface ChatActivityChartProps {
  chatSeries: number[]
  offsets?: number[]
  overlays?: EmoteOverlaySeries[]
  /** Top peak moment offsets (seconds) — drawn as yellow darts above bars. */
  peakOffsets?: number[]
  height?: number
  compact?: boolean
  reducedMotion?: boolean
  selectedIndex?: number | null
  /** External scrub from Most Reacted hover / selection (offset seconds). */
  highlightOffsetSeconds?: number | null
  onSelectIndex?: (index: number) => void
  maxPoints?: number
  chartWindow?: ChartTimelineWindow
  isLive?: boolean
  emptyMessage?: string
  alignFromStart?: boolean
  useVodAxis?: boolean
  loading?: boolean
  /** Portal-style 0–100 scale for offline full-stream recap charts. */
  displayMode?: 'raw' | 'normalized'
  /** Raw counts for normalized-mode tooltips (index-aligned with chatSeries). */
  tooltipMeta?: Array<{ chatCount?: number; emoteCount?: number; heat?: number }>
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

function drawPeakDart(
  ctx: CanvasRenderingContext2D,
  x: number,
  peakY: number,
  pad: number,
  rank: number,
): void {
  const half = rank === 0 ? 4 : 3
  const tipY = Math.max(pad + 2, peakY - 1)
  const baseY = Math.max(pad + 1, tipY - half - 5)
  ctx.beginPath()
  ctx.moveTo(x, tipY)
  ctx.lineTo(x - half, baseY)
  ctx.lineTo(x + half, baseY)
  ctx.closePath()
  ctx.fillStyle = PEAK_DART_COLOR
  ctx.fill()
  ctx.strokeStyle = hexToRgba('#000000', 0.35)
  ctx.lineWidth = 0.75
  ctx.stroke()
}

export function ChatActivityChart({
  chatSeries,
  offsets,
  overlays = [],
  peakOffsets = [],
  height = 40,
  compact = false,
  reducedMotion = false,
  selectedIndex = null,
  highlightOffsetSeconds = null,
  onSelectIndex,
  maxPoints = SPARKLINE_MAX_POINTS,
  chartWindow = '60m',
  isLive = false,
  emptyMessage,
  alignFromStart = false,
  useVodAxis = false,
  loading = false,
  displayMode = 'raw',
  tooltipMeta = [],
}: ChatActivityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pulseRef = useRef(0)
  const redrawRef = useRef<(pulsePhase: number) => void>(() => {})
  const hoverIndexRef = useRef<number | null>(null)
  const selectedIndexRef = useRef<number | null>(selectedIndex)
  const externalIndexRef = useRef<number | null>(null)
  const scrubDisplayXRef = useRef<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)

  const pointLimit = Math.max(2, maxPoints)
  const rawPoints = useMemo(
    () => chatSeries.slice(-pointLimit),
    [chatSeries, pointLimit],
  )
  const points = useMemo(() => {
    const base = rawPoints.length === 1 ? [rawPoints[0] ?? 0, rawPoints[0] ?? 0] : rawPoints
    return smoothChartSeries(base, chartWindow)
  }, [rawPoints, chartWindow])
  const pointOffsets = useMemo(() => {
    if (offsets && offsets.length === rawPoints.length && rawPoints.length === 1) {
      return [offsets[0] ?? 0, offsets[0] ?? 0]
    }
    return offsets?.slice(-pointLimit) ?? []
  }, [offsets, pointLimit, rawPoints.length])

  const overlaySeries = useMemo(() => {
    const targetLength = points.length
    const silhouette = isSilhouetteOnlyWindow(chartWindow)
    return overlays.map(series => {
      const sliced = series.values.slice(-pointLimit)
      let values = alignSeriesToChartPoints(sliced, targetLength, rawPoints.length)
      if (silhouette) {
        values = smoothChartSeries(values, chartWindow)
      }
      return { ...series, values }
    })
  }, [overlays, pointLimit, points.length, rawPoints.length, chartWindow])

  const externalIndex = useMemo(() => {
    if (highlightOffsetSeconds == null || pointOffsets.length === 0) return null
    return findChartIndexByOffset(pointOffsets, highlightOffsetSeconds, {
      bucketed: chartWindow === 'full',
    })
  }, [highlightOffsetSeconds, pointOffsets, chartWindow])

  const peakIndices = useMemo(() => {
    const activitySeries =
      displayMode === 'normalized'
        ? tooltipMeta.map((meta, index) => meta?.chatCount ?? rawPoints[index] ?? 0)
        : rawPoints
    if (chartWindow === 'full') {
      return mapPeakOffsetsToBucketedChartIndices(peakOffsets, pointOffsets, activitySeries)
    }
    return mapPeakOffsetsToChartIndices(peakOffsets, pointOffsets)
  }, [chartWindow, displayMode, peakOffsets, pointOffsets, rawPoints, tooltipMeta])

  const density = chartRenderDensity(points.length, chartWindow)
  const scrubIndex = selectedIndex ?? hoverIndex ?? externalIndex

  selectedIndexRef.current = selectedIndex
  externalIndexRef.current = externalIndex
  hoverIndexRef.current = hoverIndex

  useEffect(() => {
    redrawRef.current(pulseRef.current)
  }, [hoverIndex, selectedIndex, externalIndex])

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

    let disposed = false

    const draw = (pulsePhase: number) => {
      if (disposed) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssWidth, cssHeight)

      if (points.length < 2) return

      try {
        const normalized = displayMode === 'normalized'
        const chatMax = normalized ? 100 : Math.max(1, ...points)
        const overlayMax = normalized
          ? 100
          : Math.max(1, ...overlaySeries.flatMap(series => series.values.filter(v => v > 0)))
        const stepX = alignFromStart
          ? cssWidth / Math.max(1, points.length - 1)
          : cssWidth / Math.max(1, pointLimit - 1)
        const silhouetteOnly = isSilhouetteOnlyWindow(chartWindow)
        const pad = compact ? 1 : silhouetteOnly ? 4 : 2
        const usableH = cssHeight - pad * 2
        const offset = alignFromStart ? 0 : pointLimit - points.length
        const scrubIndex =
          selectedIndexRef.current ?? hoverIndexRef.current ?? externalIndexRef.current
        const hovering = hoverIndexRef.current != null
        const drawOverlays = shouldDrawEmoteOverlays(
          density,
          hovering || scrubIndex != null,
          chartWindow,
        )

        const coordsFor = (values: number[], max: number) =>
          values.map((v, i) => {
            const x = (offset + i) * stepX
            const y = pad + usableH - (Math.max(0, v) / max) * usableH
            return [x, y] as const
          })

        const chatCoords = coordsFor(points, chatMax)
        const barBottom = cssHeight - pad

        ctx.strokeStyle = hexToRgba(CHART_THEME.chat.color, 0.12)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, barBottom)
        ctx.lineTo(cssWidth, barBottom)
        ctx.stroke()

        if (useAreaSilhouette(density)) {
          ctx.beginPath()
          ctx.moveTo(chatCoords[0]![0], barBottom)
          for (const [x, y] of chatCoords) ctx.lineTo(x, y)
          ctx.lineTo(chatCoords[chatCoords.length - 1]![0], barBottom)
          ctx.closePath()
          ctx.fillStyle = chatAreaFillColor(chatAreaFillAlpha(density, chartWindow))
          ctx.fill()

          ctx.beginPath()
          chatCoords.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
          ctx.lineWidth = silhouetteOnly
            ? chartWindow === '2h'
              ? 1.35
              : 1.15
            : density === 'dense'
              ? 1.15
              : 1.35
          ctx.strokeStyle = chatAreaFillColor(chatAreaLineAlpha(density, chartWindow))
          ctx.lineJoin = 'round'
          if (silhouetteOnly) ctx.lineCap = 'round'
          ctx.stroke()
        }

        if (shouldDrawIndividualBars(density, stepX, chartWindow)) {
          const width = chartBarWidth(stepX, density)
          for (let i = 0; i < chatCoords.length; i += 1) {
            const coord = chatCoords[i]
            if (!coord) continue
            const [x, y] = coord
            const barHeight = Math.max(0, barBottom - y)
            if (barHeight <= 0) continue
            const alpha = chatBarFillAlpha(density, i, scrubIndex, hovering)
            const barLeft = x - width / 2
            ctx.fillStyle = chatBarFillColor(alpha)
            ctx.fillRect(barLeft, y, width, barHeight)
          }
        }

        for (let rank = 0; rank < peakIndices.length; rank += 1) {
          const peakIndex = peakIndices[rank]
          if (peakIndex == null || peakIndex < 0 || peakIndex >= chatCoords.length) continue
          const peakCoord = chatCoords[peakIndex]
          if (!peakCoord) continue
          drawPeakDart(ctx, peakCoord[0], peakCoord[1], pad, rank)
        }

        if (drawOverlays) {
          for (const series of overlaySeries) {
            if (series.values.length !== points.length) continue
            const coords = coordsFor(series.values, overlayMax)
            const alpha = overlayLineAlpha(
              density,
              Boolean(series.dashed),
              Boolean(series.primary),
              hovering,
              chartWindow,
            )
            ctx.beginPath()
            coords.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
            ctx.lineWidth = overlayLineWidth(density, Boolean(series.primary))
            ctx.strokeStyle = overlayStrokeColor(series.color, alpha)
            ctx.setLineDash(series.dashed ? [4, 4] : [])
            ctx.lineJoin = 'round'
            ctx.lineCap = 'round'
            ctx.stroke()
            ctx.setLineDash([])
          }
        }

        if (scrubIndex != null && scrubIndex >= 0 && scrubIndex < chatCoords.length) {
          const [targetBarX, barTop] = chatCoords[scrubIndex]!
          const pinned = selectedIndexRef.current === scrubIndex
          const previewHover =
            hoverIndexRef.current != null &&
            hoverIndexRef.current === scrubIndex &&
            selectedIndexRef.current != null &&
            hoverIndexRef.current !== selectedIndexRef.current
          if (scrubDisplayXRef.current == null) {
            scrubDisplayXRef.current = targetBarX
          } else if (reducedMotion) {
            scrubDisplayXRef.current = targetBarX
          } else {
            scrubDisplayXRef.current = lerpScalar(scrubDisplayXRef.current, targetBarX, 0.35)
          }
          const barX = scrubDisplayXRef.current
          const highlightWidth = Math.max(stepX * 0.88, density === 'sparse' ? 8 : 6)
          const barLeft = barX - highlightWidth / 2

          if (hovering && !pinned) {
            ctx.fillStyle = hexToRgba('#a78bfa', 0.06)
            ctx.fillRect(barLeft, pad, highlightWidth, cssHeight - pad * 2)
          }

          ctx.beginPath()
          ctx.moveTo(barX, pad)
          ctx.lineTo(barX, cssHeight - pad)
          ctx.lineWidth = pinned ? 1.75 : hovering ? 1.75 : 1.25
          ctx.strokeStyle = hexToRgba('#a78bfa', pinned ? 0.85 : hovering ? 0.72 : 0.42)
          ctx.setLineDash(pinned ? [4, 3] : [3, 5])
          ctx.stroke()
          ctx.setLineDash([])

          if (!previewHover) {
            const dotY = barTop
            const dotColor = CHART_THEME.chat.color
            const dotRadius = compact ? 4 : 4.5
            const ringRadius = dotRadius + (hovering || pinned ? 2.25 : 1.75)

            ctx.beginPath()
            ctx.arc(barX, dotY, ringRadius, 0, Math.PI * 2)
            ctx.fillStyle = hexToRgba('#ffffff', hovering || pinned ? 0.14 : 0.08)
            ctx.fill()

            ctx.beginPath()
            ctx.arc(barX, dotY, dotRadius, 0, Math.PI * 2)
            ctx.fillStyle = hexToRgba(dotColor, 0.96)
            ctx.fill()
            ctx.lineWidth = hovering || pinned ? 2.25 : 1.75
            ctx.strokeStyle = hexToRgba('#ffffff', hovering || pinned ? 0.95 : 0.82)
            ctx.stroke()
          }
        } else {
          scrubDisplayXRef.current = null
        }

        if (isLive && chatCoords.length > 0) {
          const last = chatCoords[chatCoords.length - 1]!
          const [liveX, liveY] = last
          const pulse = reducedMotion ? 1 : 0.55 + Math.sin(pulsePhase) * 0.45
          const radius = compact ? 4 + pulse * 2.5 : 5 + pulse * 3
          ctx.beginPath()
          ctx.arc(liveX, liveY, radius, 0, Math.PI * 2)
          ctx.fillStyle = hexToRgba('#34d399', 0.12 + pulse * 0.1)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(liveX, liveY, compact ? 3.5 : 4, 0, Math.PI * 2)
          ctx.fillStyle = '#34d399'
          ctx.fill()
          ctx.lineWidth = 1.5
          ctx.strokeStyle = hexToRgba('#ffffff', 0.9)
          ctx.stroke()
        }
      } catch {
        // Never take down the overlay from a canvas draw failure.
      }

    }

    redrawRef.current = draw
    draw(pulseRef.current)

    return () => {
      disposed = true
    }
  }, [
    alignFromStart,
    chartWindow,
    compact,
    density,
    displayMode,
    height,
    isLive,
    maxPoints,
    overlaySeries,
    peakIndices,
    pointLimit,
    points,
    reducedMotion,
  ])

  useEffect(() => {
    if (reducedMotion) return
    if (!isLive && hoverIndex == null && selectedIndex == null) return
    let rafId = 0
    let disposed = false
    const tick = (phase: number) => {
      if (disposed) return
      redrawRef.current(phase)
      pulseRef.current = phase + 0.08
      rafId = requestAnimationFrame(() => tick(pulseRef.current))
    }
    rafId = requestAnimationFrame(() => tick(pulseRef.current))
    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
    }
  }, [isLive, reducedMotion, hoverIndex, selectedIndex, points.length, chartWindow])

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
    const index = sparklineIndexFromClick(event.clientX, rect, rawPoints.length, pointLimit, alignFromStart)
    onSelectIndex(index)
    setHoverIndex(index)
    setHoverX(event.clientX - rect.left)
  }

  const tooltipIndex = scrubIndex
  const tooltipOffset = tooltipIndex != null ? pointOffsets[tooltipIndex] : undefined
  const tooltipParts: string[] = []
  if (tooltipOffset != null) tooltipParts.push(formatHeatOffset(tooltipOffset))
  const meta = tooltipIndex != null ? tooltipMeta[tooltipIndex] : undefined
  if (displayMode === 'normalized' && meta) {
    if ((meta.chatCount ?? 0) > 0) tooltipParts.push(`${formatNumber(meta.chatCount ?? 0)} chat`)
    if ((meta.heat ?? 0) > 0) tooltipParts.push(`heat ${meta.heat}`)
    if ((meta.emoteCount ?? 0) > 0) tooltipParts.push(`${formatNumber(meta.emoteCount ?? 0)} emotes`)
  } else if (tooltipIndex != null) {
    tooltipParts.push(`${formatNumber(rawPoints[tooltipIndex] ?? 0)} chat`)
    for (const series of overlaySeries) {
      const value = series.values[tooltipIndex] ?? 0
      if (value > 0) tooltipParts.push(`${series.label} ${value}`)
    }
  }

  const showEmptyState = loading || rawPoints.length === 0

  const axisTicks: { label: string; leftPct: number }[] = []
  if (!showEmptyState && pointOffsets.length >= 2) {
    const lastIndex = pointOffsets.length - 1
    const lastOffset = pointOffsets[lastIndex] ?? 0
    const useFullAxis =
      chartWindow === 'full' && lastOffset > 2 * 60 * 60 && displayMode !== 'normalized'
    const useTimestampAxis = useVodAxis && (displayMode === 'normalized' || !useFullAxis)
    const tickIndexes =
      lastIndex >= 2 ? [0, Math.floor(lastIndex / 2), lastIndex] : [0, lastIndex]
    for (const index of [...new Set(tickIndexes)]) {
      const offset = pointOffsets[index]
      if (offset == null) continue
      let label: string
      if (index === lastIndex) {
        label = isLive ? 'Now' : displayMode === 'normalized' ? formatHeatOffset(offset) : 'End'
      } else if (useTimestampAxis) {
        label = formatHeatOffset(offset)
      } else if (useFullAxis) {
        label = index === 0 ? 'Start' : 'Mid'
      } else if (useVodAxis) {
        label = formatHeatOffset(offset)
      } else {
        label = formatChartAxisTime(offset)
      }
      axisTicks.push({
        label,
        leftPct: (index / Math.max(1, pointOffsets.length - 1)) * 100,
      })
    }
  }

  return (
    <div className="pulse-sparkline-wrap" style={{ minHeight: height, overflow: 'hidden' }}>
      {showEmptyState ? (
        <div className="pulse-chart-empty pulse-shimmer" style={{ ...styles.empty, height }} role="status">
          <span style={styles.emptyText}>
            {loading ? 'Loading timeline…' : (emptyMessage ?? 'Waiting for chat rollups…')}
          </span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{ ...styles.canvas, height, transition: reducedMotion ? 'none' : 'opacity 250ms ease' }}
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
        <span
          className="pulse-sparkline-tooltip"
          style={{ left: hoverX, top: 0, opacity: hoverIndex != null ? 1 : 0.82 }}
        >
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
  canvas: { cursor: 'crosshair', display: 'block', width: '100%' },
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
