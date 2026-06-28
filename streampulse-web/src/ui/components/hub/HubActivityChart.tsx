import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Activity } from 'lucide-react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import { internalGapCount, maxConnectedGapMs } from '../../../lib/hubActivitySummary'
import { compact } from '../analytics/hubFormat'
import { EmptyState, Skeleton } from './primitives'

export interface HubActivityChartProps {
  points: HubActivityPoint[]
  windowMinutes: number
  channelCount: number
  loading?: boolean
  footnote?: string
}

interface Pt {
  x: number
  y: number
}

function emoteCount(point: HubActivityPoint): number {
  return Math.max(point.emotes ?? 0, point.seventv ?? 0)
}

function axisLabel(minutesAgo: number): string {
  if (minutesAgo <= 0) return 'now'
  if (minutesAgo >= 60 * 24 * 365) return `-${Math.round(minutesAgo / (60 * 24 * 365))}y`
  if (minutesAgo >= 60 * 24 * 30) return `-${Math.round(minutesAgo / (60 * 24 * 30))}mo`
  if (minutesAgo >= 60 * 24) return `-${Math.round(minutesAgo / (60 * 24))}d`
  if (minutesAgo >= 60) {
    const h = Math.round(minutesAgo / 60)
    return `-${h}h`
  }
  return `-${minutesAgo}m`
}

function windowLabel(minutes: number): string {
  if (minutes >= 60 * 24 * 365) return `${Math.round(minutes / (60 * 24 * 365))} year`
  if (minutes >= 60 * 24 * 30) return `${Math.round(minutes / (60 * 24 * 30))} month`
  if (minutes >= 60 * 24) return `${Math.round(minutes / (60 * 24))} day`
  if (minutes >= 60) return `${Math.round(minutes / 60)} hour`
  return `${minutes} minute`
}

function activePoint(point: HubActivityPoint): boolean {
  return point.chat > 0 || point.seventv > 0 || emoteCount(point) > 0
}

/** Smooth a polyline into a Catmull-Rom → cubic-bezier path. */
function buildLine(pts: Pt[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const minX = Math.min(p1.x, p2.x)
    const maxX = Math.max(p1.x, p2.x)
    const c1x = Math.max(minX, Math.min(maxX, p1.x + (p2.x - p0.x) / 6))
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = Math.max(minX, Math.min(maxX, p2.x - (p3.x - p1.x) / 6))
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

function splitLinePaths(pts: Pt[], source: HubActivityPoint[], windowMinutes: number): string[] {
  if (pts.length < 2) return []
  const maxGap = maxConnectedGapMs(windowMinutes)
  const segments: Pt[][] = []
  let current: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i += 1) {
    const prevT = source[i - 1]?.t ?? 0
    const nextT = source[i]?.t ?? prevT
    if (nextT - prevT > maxGap) {
      if (current.length >= 2) segments.push(current)
      current = [pts[i]]
    } else {
      current.push(pts[i])
    }
  }
  if (current.length >= 2) segments.push(current)
  return segments.map(buildLine).filter(Boolean)
}

export function HubActivityChart({ points, windowMinutes, channelCount, loading, footnote }: HubActivityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const model = useMemo(() => {
    const n = points.length
    const lineMax =
      points.reduce((acc, p) => Math.max(acc, p.chat, p.seventv, emoteCount(p)), 0) || 1
    const chatMax = points.reduce((acc, p) => Math.max(acc, p.chat), 0) || 1
    const PAD = 10
    const lastT = points[n - 1]?.t ?? 0
    const windowMs = Math.max(1, (windowMinutes || 30) * 60_000)
    const startT = lastT - windowMs
    const xAt = (t: number): number => {
      if (n <= 1) return 50
      return Math.max(0, Math.min(1, (t - startT) / windowMs)) * 100
    }
    const xs = points.map((p) => xAt(p.t))
    const atLine = (value: number, i: number): Pt => ({
      x: xs[i],
      y: PAD + (1 - value / lineMax) * (100 - PAD),
    })
    const chat = points.map((p, i) => atLine(p.chat, i))
    const emotes = points.map((p, i) => atLine(emoteCount(p), i))
    const seven = points.map((p, i) => atLine(p.seventv, i))
    const chatLines = splitLinePaths(chat, points, windowMinutes)
    const emoteLines = splitLinePaths(emotes, points, windowMinutes)
    const sevenLines = splitLinePaths(seven, points, windowMinutes)

    // Chat/min volume histogram — matches extension + landing demo semantics.
    let gapSum = 0
    let gapCount = 0
    for (let i = 1; i < xs.length; i += 1) {
      const gap = xs[i] - xs[i - 1]
      if (gap > 0) {
        gapSum += gap
        gapCount += 1
      }
    }
    const spacing = gapCount > 0 ? gapSum / gapCount : 100
    const barW = Math.max(0.45, Math.min(spacing * 0.6, 4))
    const bars = points.map((p, i) => {
      const cx = xs[i]
      const h = (p.chat / chatMax) * (100 - PAD)
      let x = cx - barW / 2
      let w = barW
      if (x < 0) {
        w += x
        x = 0
      }
      if (x + w > 100) w = 100 - x
      return { x, w, y: 100 - h, h }
    })
    const active = points.filter(activePoint)
    const firstActive = active[0]
    const emptyPrefixMinutes = firstActive ? Math.max(0, Math.round((firstActive.t - startT) / 60_000)) : windowMinutes
    const firstActiveX = firstActive ? xAt(firstActive.t) : 0
    const sampleNote =
      firstActive && emptyPrefixMinutes > Math.max(15, windowMinutes * 0.2)
        ? `No live samples before ${axisLabel(Math.max(0, Math.round((lastT - firstActive.t) / 60_000)))}`
        : ''

    return {
      n,
      lineMax,
      xs,
      lastT,
      chat,
      emotes,
      seven,
      chatLines,
      emoteLines,
      sevenLines,
      bars,
      firstActiveX,
      sampleNote,
      internalGaps: internalGapCount(points, windowMinutes),
      peakChat: points.reduce((a, p) => Math.max(a, p.chat), 0),
      peakEmotes: points.reduce((a, p) => Math.max(a, emoteCount(p)), 0),
      peakSeven: points.reduce((a, p) => Math.max(a, p.seventv), 0),
    }
  }, [points, windowMinutes])

  const ticks = useMemo(() => {
    const w = windowMinutes || 30
    return [w, Math.round((w * 2) / 3), Math.round(w / 3), 0].map(axisLabel)
  }, [windowMinutes])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 220, marginTop: '0.7rem' }} aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <Skeleton key={i} width={10} height={`${30 + ((i * 37) % 60)}%`} radius="3px" style={{ flex: 1 }} />
        ))}
      </div>
    )
  }

  if (points.length < 2) {
    return (
      <EmptyState icon={<Activity aria-hidden="true" />}>
        Waiting for live activity — the chart draws once channels start sending chat and emotes.
      </EmptyState>
    )
  }

  const {
    n,
    lineMax,
    xs,
    lastT,
    chat,
    emotes,
    seven,
    chatLines,
    emoteLines,
    sevenLines,
    bars,
    firstActiveX,
    sampleNote,
    internalGaps,
    peakChat,
    peakEmotes,
    peakSeven,
  } = model

  function handleMove(event: ReactMouseEvent<HTMLDivElement>) {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0
    const mx = Math.max(0, Math.min(100, ratio * 100))
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < xs.length; i += 1) {
      const dist = Math.abs(xs[i] - mx)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    setHover(best)
  }

  const hp = hover != null ? points[hover] : null
  const hx = hover != null ? chat[hover].x : 0
  const tipShift = hx < 18 ? '0%' : hx > 82 ? '-100%' : '-50%'
  const minutesAgo = hp != null ? Math.max(0, Math.round((lastT - hp.t) / 60_000)) : 0

  return (
    <>
      <div
        ref={wrapRef}
        className="hx-chart2"
        role="img"
        aria-label={`Chat volume and emote velocity over the last ${windowLabel(windowMinutes)} window across ${channelCount} channels. Peak ${compact(
          peakChat,
        )} chat per minute, ${compact(peakEmotes)} total emotes per minute, and ${compact(peakSeven)} 7TV subset emotes per minute.`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g className="bars" aria-hidden="true">
            {bars.map((bar, i) => (
              <rect key={i} x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx="0.5" fill="hsl(var(--chart-2) / 0.1)" />
            ))}
          </g>
          <g className="grid">
            {[25, 50, 75].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          {chatLines.map((line, i) => (
            <path key={`chat-underlay-${i}`} className="hx-chart-line-underlay" d={line} fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {chatLines.map((line, i) => (
            <path key={`chat-${i}`} className="hx-chart-line hx-chart-line--chat" d={line} fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {emoteLines.map((line, i) => (
            <path
              key={`emotes-${i}`}
              d={line}
              fill="none"
              stroke="hsl(var(--chart-4))"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {sevenLines.map((line, i) => (
            <path
              key={`seven-${i}`}
              d={line}
              fill="none"
              stroke="hsl(var(--chart-3))"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="4 3"
            />
          ))}
        </svg>

        <div className="hx-chart2__layer">
          <span className="ylab">{compact(lineMax)}/m peak</span>
          {sampleNote ? (
            <>
              <span className="gap-fill" style={{ width: `${Math.max(0, firstActiveX)}%` }} />
              <span className="gap-note" style={{ left: `${Math.max(12, Math.min(46, firstActiveX / 2))}%` }}>
                {sampleNote}
              </span>
            </>
          ) : null}
          {!sampleNote && internalGaps > 0 ? (
            <span className="gap-note" style={{ left: '18%' }}>
              {internalGaps} corpus gap{internalGaps === 1 ? '' : 's'} not connected
            </span>
          ) : null}

          {hover == null ? (
            <>
              <span className="now" style={{ left: `${chat[n - 1].x}%`, top: `${chat[n - 1].y}%` }}>
                <span className="halo" style={{ background: 'hsl(var(--chart-2))' }} />
                <i style={{ background: 'hsl(var(--chart-2))' }} />
              </span>
              <span className="now" style={{ left: `${emotes[n - 1].x}%`, top: `${emotes[n - 1].y}%` }}>
                <span className="halo" style={{ background: 'hsl(var(--chart-4))' }} />
                <i style={{ background: 'hsl(var(--chart-4))' }} />
              </span>
              <span className="now" style={{ left: `${seven[n - 1].x}%`, top: `${seven[n - 1].y}%` }}>
                <span className="halo" style={{ background: 'hsl(var(--chart-3))' }} />
                <i style={{ background: 'hsl(var(--chart-3))' }} />
              </span>
            </>
          ) : (
            <>
              <span className="cross" style={{ left: `${hx}%` }} />
              <span className="hdot" style={{ left: `${chat[hover].x}%`, top: `${chat[hover].y}%`, background: 'hsl(var(--chart-2))' }} />
              <span className="hdot" style={{ left: `${emotes[hover].x}%`, top: `${emotes[hover].y}%`, background: 'hsl(var(--chart-4))' }} />
              <span className="hdot" style={{ left: `${seven[hover].x}%`, top: `${seven[hover].y}%`, background: 'hsl(var(--chart-3))' }} />
              <div className="tip" style={{ left: `${hx}%`, transform: `translateX(${tipShift})` }}>
                <div className="t">{axisLabel(minutesAgo)}</div>
                <div className="row">
                  <span className="sw" style={{ background: 'hsl(var(--chart-2))' }} />
                  Chat&nbsp;<b>{compact(hp?.chat ?? 0)}</b>/m
                </div>
                <div className="row">
                  <span className="sw" style={{ background: 'hsl(var(--chart-4))' }} />
                  Emotes&nbsp;<b>{compact(hp ? emoteCount(hp) : 0)}</b>/m
                </div>
                <div className="row">
                  <span className="sw sw--dash" style={{ background: 'hsl(var(--chart-3))' }} />
                  7TV subset&nbsp;<b>{compact(hp?.seventv ?? 0)}</b>/m
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="hx-axis" aria-hidden="true">
        {ticks.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      {footnote ? <p className="hx-chart-footnote muted">{footnote}</p> : null}
    </>
  )
}
