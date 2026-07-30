import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { FigmaChartPoint } from '../../../lib/figmaSessionAnalytics'
import { formatOffsetLabel } from '../../../lib/figmaSessionAnalytics'

export interface PlottedEmote {
  code: string
  label: string
  peakOffsetSeconds?: number
  color?: string
}

export interface FigmaSignalChartProps {
  points: FigmaChartPoint[]
  selectedOffset?: number
  onSelectOffset?: (offsetSeconds: number) => void
  title?: string
  eyebrow?: string
  note?: string
  titleSuffix?: string
  axisEndLabel?: string
  plottedEmote?: PlottedEmote
  onClearPlottedEmote?: () => void
}

const W = 1000
const H = 200
const PT = 14
const PB = 22

const LANES = [
  { key: 'chatNorm' as const, label: 'Chat', className: 'chat', stroke: 'var(--fma-accent)', fill: 'url(#figmaChartChatFill)' },
  { key: 'emotesNorm' as const, label: 'Emotes', className: 'emotes', stroke: 'var(--fma-cyan)' },
  { key: 'viewersNorm' as const, label: 'Viewers · context', className: 'viewers', stroke: 'var(--fma-green)' },
  { key: 'heat' as const, label: 'Heat', className: 'heat', stroke: 'var(--fma-amber)' },
]

type Pt = [number, number]

function xForOffset(offsetSeconds: number, minOffset: number, maxOffset: number): number {
  if (maxOffset <= minOffset) return W / 2
  return ((offsetSeconds - minOffset) / (maxOffset - minOffset)) * W
}

function yForNorm(value: number): number {
  return PT + (1 - Math.max(0, Math.min(100, value)) / 100) * (H - PT - PB)
}

function smoothPath(coords: Pt[]): string {
  if (coords.length === 0) return ''
  // Linear segments (M…L…L). Resolves B-03: zero deviation from the
  // ground-truth path; the previous Catmull-Rom-style smoother overshot by
  // up to ~0.92px (mean 0.136px) at sharp data inflections.
  return (
    coords
      .map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`)
      .join(' ')
  )
}

function smoothOverviewPath(coords: Pt[]): string {
  if (coords.length === 0) return ''
  if (coords.length < 3) return smoothPath(coords)
  let path = `M${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`
  for (let i = 1; i < coords.length - 1; i += 1) {
    const current = coords[i]
    const next = coords[i + 1]
    const midX = (current[0] + next[0]) / 2
    const midY = (current[1] + next[1]) / 2
    path += ` Q${current[0].toFixed(1)} ${current[1].toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`
  }
  const last = coords[coords.length - 1]
  path += ` T${last[0].toFixed(1)} ${last[1].toFixed(1)}`
  return path
}

function smoothValues(values: number[], radius = 2): number[] {
  return values.map((_, index) => {
    const from = Math.max(0, index - radius)
    const to = Math.min(values.length - 1, index + radius)
    let sum = 0
    for (let i = from; i <= to; i += 1) sum += values[i]
    return sum / Math.max(1, to - from + 1)
  })
}

function areaPath(segment: Pt[], pathBuilder: (coords: Pt[]) => string = smoothPath): string {
  if (segment.length < 2) return ''
  const first = segment[0]
  const last = segment[segment.length - 1]
  return `${pathBuilder(segment)} L ${last[0].toFixed(1)} ${H - PB} L ${first[0].toFixed(1)} ${H - PB} Z`
}

export function FigmaSignalChart({
  points,
  selectedOffset,
  onSelectOffset,
  title,
  eyebrow = 'Chat + emotes primary · viewers contextual',
  note = 'Sentiment lane omitted — no hosted signal field.',
  titleSuffix,
  axisEndLabel,
  plottedEmote,
  onClearPlottedEmote,
}: FigmaSignalChartProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const minOffset = points[0]?.offsetSeconds ?? 0
  const maxOffset = points[points.length - 1]?.offsetSeconds ?? 0
  const endLabel = axisEndLabel ?? formatOffsetLabel(maxOffset)

  const model = useMemo(() => {
    const coords = points.map((point) => ({
      point,
      x: xForOffset(point.offsetSeconds, minOffset, maxOffset),
      chat: yForNorm(point.chatNorm),
      viewers: yForNorm(point.viewersNorm),
      emotes: yForNorm(point.emotesNorm),
      heat: yForNorm(point.heat),
    }))
    const chatLine: Pt[] = coords.map((c) => [c.x, c.chat])
    const viewersLine: Pt[] = coords.map((c) => [c.x, c.viewers])
    const emotesLine: Pt[] = coords.map((c) => [c.x, c.emotes])
    const heatLine: Pt[] = coords.map((c) => [c.x, c.heat])
    const overviewValues = smoothValues(
      points.map((point) => point.chatNorm * 0.56 + point.emotesNorm * 0.44),
    )
    const overviewLine: Pt[] = coords.map((coord, index) => [coord.x, yForNorm(overviewValues[index] ?? 0)])
    return { coords, chatLine, viewersLine, emotesLine, heatLine, overviewLine }
  }, [maxOffset, minOffset, points])

  const selectedIndex = useMemo(() => {
    if (selectedOffset == null) return -1
    return points.findIndex((p) => p.offsetSeconds === selectedOffset)
  }, [points, selectedOffset])

  const plottedX = useMemo(() => {
    if (plottedEmote?.peakOffsetSeconds == null || !Number.isFinite(plottedEmote.peakOffsetSeconds)) return null
    return xForOffset(plottedEmote.peakOffsetSeconds, minOffset, maxOffset)
  }, [minOffset, maxOffset, plottedEmote?.peakOffsetSeconds])

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
        const dist = Math.abs(model.coords[i].x - mx)
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
      setAnnouncement(`Selected ${formatOffsetLabel(point.offsetSeconds)} · heat ${point.heat}`)
    },
    [onSelectOffset, points],
  )

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!onSelectOffset) return
    selectIndex(nearestIndex(event.clientX))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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

  if (points.length === 0) {
    return (
      <div className="figma-chart figma-chart--empty" aria-label="Multi-signal chart">
        <p className="muted">Chart lanes appear when backend rollups and heat scores are available.</p>
      </div>
    )
  }

  const activeIndex = hoverIndex ?? (selectedIndex >= 0 ? selectedIndex : null)
  const activeCoord = activeIndex != null ? model.coords[activeIndex] : null
  const detailActive = activeCoord != null || plottedX != null
  const detailSplitX = activeCoord?.x ?? plottedX ?? W
  const crossPct = activeCoord ? (activeCoord.x / W) * 100 : 0
  const selectedCoord = selectedIndex >= 0 ? model.coords[selectedIndex] : null
  const selectedPct = selectedCoord ? (selectedCoord.x / W) * 100 : null
  const resolvedTitleSuffix =
    titleSuffix ?? (detailActive ? '— minute detail' : '— smooth chat + emote overview')
  const ids = {
    overviewFill: `figmaChartOverviewFill-${chartId}`,
    chatFill: `figmaChartChatFill-${chartId}`,
    emotePlot: `figmaChartEmotePlot-${chartId}`,
    past: `figmaChartPast-${chartId}`,
    future: `figmaChartFuture-${chartId}`,
  }

  return (
    <div className="figma-chart figma-chart--svg" aria-label="Multi-signal chart">
      <div className="figma-chart__head">
        <div>
          <div className="figma-chart__eyebrow">{eyebrow}</div>
          {title ? (
            <div className="figma-chart__title">
              {title} {resolvedTitleSuffix}
            </div>
          ) : null}
        </div>
      </div>
      <div className="figma-chart__legend">
        {LANES.map((lane) => (
          <span key={lane.key} className={`figma-chart__lane figma-chart__lane--${lane.className}`}>
            {lane.label}
          </span>
        ))}
        {plottedEmote && plottedX != null ? (
          <span className="figma-chart__lane figma-chart__lane--plotted">
            {plottedEmote.label}
            {onClearPlottedEmote ? (
              <button type="button" className="figma-chart__clear-plot" onClick={onClearPlottedEmote} aria-label={`Clear ${plottedEmote.code} plot`}>
                ×
              </button>
            ) : null}
          </span>
        ) : null}
        {note ? <span className="figma-chart__note muted">{note}</span> : null}
      </div>
      <div
        ref={wrapRef}
        className={`figma-chart__svg-wrap${onSelectOffset ? ' figma-chart__svg-wrap--interactive' : ''}`}
        tabIndex={onSelectOffset ? 0 : undefined}
        role="img"
        aria-label={`Chat and emote activity chart from ${formatOffsetLabel(minOffset)} to ${endLabel}. The smooth overview expands into minute detail; viewers are contextual.`}
        data-chart-mode={detailActive ? 'detail' : 'overview'}
        data-chart-primary-signals="chat emotes"
        data-chart-context-signals="viewers"
        onClick={onSelectOffset ? handleClick : undefined}
        onKeyDown={onSelectOffset ? handleKeyDown : undefined}
        onMouseMove={(event) => setHoverIndex(nearestIndex(event.clientX))}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg className="figma-chart__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={ids.overviewFill} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--fma-accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--fma-accent)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={ids.chatFill} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--fma-accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--fma-accent)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={ids.emotePlot} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(330 80% 62%)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(330 80% 62%)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={ids.past}>
              <rect x={0} y={0} width={detailSplitX} height={H} />
            </clipPath>
            <clipPath id={ids.future}>
              <rect x={detailSplitX} y={0} width={Math.max(0, W - detailSplitX)} height={H} />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => {
            const y = PT + f * (H - PT - PB)
            return <line key={f} x1={0} x2={W} y1={y} y2={y} className="figma-chart__grid" />
          })}
          <g
            className={`figma-chart__motion-layer figma-chart__motion-layer--overview${detailActive ? ' is-muted' : ''}`}
            data-chart-layer="overview"
          >
            <path
              d={areaPath(model.overviewLine, smoothOverviewPath)}
              fill={`url(#${ids.overviewFill})`}
              className="figma-chart__area figma-chart__area--overview"
            />
            <path
              d={smoothOverviewPath(model.overviewLine)}
              className="figma-chart__line figma-chart__line--overview"
              fill="none"
              stroke="var(--fma-accent)"
            />
          </g>
          <g
            className={`figma-chart__motion-layer figma-chart__motion-layer--detail${detailActive ? ' is-active' : ''}`}
            data-chart-layer="detail"
          >
            <g clipPath={`url(#${ids.future})`} className="figma-chart__future">
              <path d={smoothPath(model.chatLine)} className="figma-chart__line figma-chart__line--future" fill="none" />
              <path d={smoothPath(model.emotesLine)} className="figma-chart__line figma-chart__line--future" fill="none" />
              <path d={smoothPath(model.viewersLine)} className="figma-chart__line figma-chart__line--future figma-chart__line--context" fill="none" />
            </g>
            <g clipPath={`url(#${ids.past})`}>
              <path d={areaPath(model.chatLine)} fill={`url(#${ids.chatFill})`} className="figma-chart__area" />
              <path d={smoothPath(model.chatLine)} className="figma-chart__line figma-chart__line--chat" fill="none" stroke="var(--fma-accent)" />
              <path d={smoothPath(model.emotesLine)} className="figma-chart__line figma-chart__line--emotes" fill="none" stroke="var(--fma-cyan)" />
              <path d={smoothPath(model.viewersLine)} className="figma-chart__line figma-chart__line--viewers figma-chart__line--context" fill="none" stroke="var(--fma-green)" />
              <path d={smoothPath(model.heatLine)} className="figma-chart__line figma-chart__line--heat" fill="none" stroke="var(--fma-amber)" strokeDasharray="4 3" />
            </g>
          </g>
          {plottedX != null ? (
            <>
              <rect
                x={Math.max(0, plottedX - 18)}
                y={PT}
                width={36}
                height={H - PT - PB}
                fill={`url(#${ids.emotePlot})`}
                className="figma-chart__plot-band"
              />
              <line x1={plottedX} x2={plottedX} y1={PT} y2={H - PB} className="figma-chart__plot-marker" />
            </>
          ) : null}
          {selectedCoord ? (
            <line
              x1={selectedCoord.x}
              x2={selectedCoord.x}
              y1={PT}
              y2={H - PB}
              className="figma-chart__selection-line"
            />
          ) : null}
        </svg>
        {activeCoord ? (
          <>
            <span className="figma-chart__cross" style={{ left: `${crossPct}%` }} aria-hidden="true" />
            <div className="figma-chart__tip" style={{ left: `${Math.max(8, Math.min(92, crossPct))}%` }}>
              <div className="figma-chart__tip-time">{formatOffsetLabel(activeCoord.point.offsetSeconds)}</div>
              {LANES.map((lane) => (
                <div key={lane.key} className="figma-chart__tip-row">
                  <span className={`figma-chart__sw figma-chart__sw--${lane.className}`} />
                  {lane.label} <b>{activeCoord.point[lane.key]}</b>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {selectedPct != null ? (
          <span className="figma-chart__selection-dot" style={{ left: `${selectedPct}%` }} aria-hidden="true" />
        ) : null}
      </div>
      <div className="figma-chart__axis">
        <span>{formatOffsetLabel(minOffset)}</span>
        <span>{endLabel}</span>
      </div>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}
