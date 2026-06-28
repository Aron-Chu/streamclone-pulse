import { useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact, deltaLabel } from './hubFormat'

const W = 1000
const H = 280
const PT = 16
const PB = 26

interface GlobalActivityChartProps {
  points: HubActivityPoint[]
  windowMinutes: number
  channelCount: number
  loading?: boolean
}

interface SeriesMeta {
  key: 'viewers' | 'chat' | 'emotes'
  label: string
  color: string
  values: number[]
  coords: Array<[number, number]>
  segments: Array<Array<[number, number]>>
}

function xForTimestamp(t: number, points: HubActivityPoint[], windowMinutes: number): number {
  if (points.length <= 1) return W / 2
  const lastT = points[points.length - 1]?.t ?? 0
  const windowMs = Math.max(1, windowMinutes || 30) * 60_000
  const startT = lastT - windowMs
  return Math.max(0, Math.min(1, (t - startT) / windowMs)) * W
}

function toCoords(points: HubActivityPoint[], values: number[], windowMinutes: number): Array<[number, number]> {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map((value, index) => {
    const x = xForTimestamp(points[index]?.t ?? 0, points, windowMinutes)
    const y = H - PB - ((value - min) / range) * (H - PT - PB)
    return [x, y]
  })
}

function splitSegments(coords: Array<[number, number]>, points: HubActivityPoint[], windowMinutes: number): Array<Array<[number, number]>> {
  if (coords.length < 2) return []
  const expectedBucketMs = Math.max(60_000, Math.ceil(Math.max(1, windowMinutes) / 240) * 60_000)
  const maxConnectedGapMs = Math.max(5 * 60_000, expectedBucketMs * 2.5)
  const segments: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = [coords[0]]
  for (let i = 1; i < coords.length; i += 1) {
    const prevT = points[i - 1]?.t ?? 0
    const nextT = points[i]?.t ?? prevT
    if (nextT - prevT > maxConnectedGapMs) {
      if (current.length >= 2) segments.push(current)
      current = [coords[i]]
    } else {
      current.push(coords[i])
    }
  }
  if (current.length >= 2) segments.push(current)
  return segments
}

function smoothPath(p: Array<[number, number]>): string {
  if (p.length === 0) return ''
  if (p.length < 3) return p.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ')
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`
  for (let i = 0; i < p.length - 1; i += 1) {
    const p0 = p[i - 1] || p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] || p2
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

function areaPath(segment: Array<[number, number]>): string {
  if (segment.length < 2) return ''
  const first = segment[0]
  const last = segment[segment.length - 1]
  return `${smoothPath(segment)} L ${last[0].toFixed(1)} ${H - PB} L ${first[0].toFixed(1)} ${H - PB} Z`
}

function trendPct(values: number[]): number {
  if (values.length < 2) return 0
  const first = values[0]
  const last = values[values.length - 1]
  if (first === 0) return 0
  return ((last - first) / first) * 100
}

function timeAgoLabel(point: HubActivityPoint | undefined, lastT: number): string {
  if (!point) return ''
  const minutesAgo = Math.max(0, Math.round((lastT - point.t) / 60_000))
  if (minutesAgo <= 0) return 'now'
  if (minutesAgo >= 60 * 24) return `${Math.round(minutesAgo / (60 * 24))}d ago`
  if (minutesAgo >= 60) return `${Math.round(minutesAgo / 60)}h ago`
  return `${minutesAgo}m ago`
}

export function GlobalActivityChart({ points, windowMinutes, channelCount, loading = false }: GlobalActivityChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const lastT = points[points.length - 1]?.t ?? 0

  const series = useMemo<SeriesMeta[]>(() => {
    const viewers = points.map((p) => p.viewers)
    const chat = points.map((p) => p.chat)
    const emotes = points.map((p) => Math.max(p.emotes ?? 0, p.seventv))
    const build = (key: SeriesMeta['key'], label: string, color: string, values: number[]): SeriesMeta => {
      const coords = toCoords(points, values, windowMinutes)
      return { key, label, color, values, coords, segments: splitSegments(coords, points, windowMinutes) }
    }
    return [
      build('viewers', 'Viewers', 'hsl(var(--sc-chart-3))', viewers),
      build('chat', 'Chat/min', 'hsl(var(--sc-chart-1))', chat),
      build('emotes', 'Emotes/min', 'hsl(var(--sc-chart-2))', emotes),
    ]
  }, [points, windowMinutes])

  if (loading) {
    return (
      <div className="hub-card hub-ga" aria-busy="true">
        <Skeleton height={240} radius="0.7rem" />
        <div className="hub-ga__side">
          <Skeleton height={72} radius="0.7rem" />
          <Skeleton height={72} radius="0.7rem" />
          <Skeleton height={72} radius="0.7rem" />
        </div>
      </div>
    )
  }

  if (points.length < 2) {
    return (
      <div className="hub-empty">
        <Activity size={22} aria-hidden="true" />
        <strong>No live activity yet</strong>
        <span>Aggregated chat and emote velocity will appear once channels are live in the tracked pool.</span>
      </div>
    )
  }

  const viewers = series[0]
  const chat = series[1]
  const tv = series[2]
  const chatLast = chat.coords[chat.coords.length - 1]
  const windowLabel = windowMinutes >= 120 ? `${Math.round(windowMinutes / 60)}h` : `${windowMinutes}m`
  const hoverX = hover != null ? chat.coords[hover]?.[0] ?? 0 : 0
  const hoverPct = (hoverX / W) * 100

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = (event.clientX - rect.left) / rect.width
    if (ratio < 0 || ratio > 1) {
      setHover(null)
      return
    }
    const x = ratio * W
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < chat.coords.length; i += 1) {
      const dist = Math.abs((chat.coords[i]?.[0] ?? 0) - x)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    setHover(best)
  }

  return (
    <div className="hub-card hub-ga">
      <div
        className="hub-ga__plot"
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          className="hub-ga__svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Global activity aggregated across ${channelCount} channels over the last ${windowLabel}: viewers, chat per minute and total emotes per minute.`}
        >
          <defs>
            <linearGradient id="hubGaViewers" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--sc-chart-3))" stopOpacity="0.22" />
              <stop offset="100%" stopColor="hsl(var(--sc-chart-3))" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="hubGaChat" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--sc-chart-1))" stopOpacity="0.28" />
              <stop offset="100%" stopColor="hsl(var(--sc-chart-1))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => {
            const y = PT + f * (H - PT - PB)
            return <line key={f} x1={0} x2={W} y1={y} y2={y} className="grid" />
          })}
          {viewers.segments.map((segment, index) => (
            <path key={`area-viewers-${index}`} d={areaPath(segment)} fill="url(#hubGaViewers)" className="areafill" />
          ))}
          {chat.segments.map((segment, index) => (
            <path key={`area-chat-${index}`} d={areaPath(segment)} fill="url(#hubGaChat)" className="areafill" />
          ))}
          {chat.segments.map((segment, index) => (
            <path key={`line-chat-${index}`} d={smoothPath(segment)} className="line" stroke={chat.color} />
          ))}
          {tv.segments.map((segment, index) => (
            <path key={`line-tv-${index}`} d={smoothPath(segment)} className="line" stroke={tv.color} />
          ))}
          {chatLast ? (
            <>
              <circle cx={chatLast[0]} cy={chatLast[1]} r={7} fill="hsl(var(--sc-chart-1))" fillOpacity={0.18} className="pulse" />
              <circle cx={chatLast[0]} cy={chatLast[1]} r={3.5} fill="hsl(var(--sc-chart-1))" />
            </>
          ) : null}
        </svg>
        <div className="hub-ga__cross" style={{ left: `${hoverPct}%`, opacity: hover != null ? 1 : 0 }} />
        {hover != null ? (
          <div
            className="hub-ga__tip"
            style={{ left: `${Math.max(8, Math.min(92, hoverPct))}%`, opacity: 1 }}
          >
            <div className="t">{timeAgoLabel(points[hover], lastT)}</div>
            {series.map((s) => (
              <div className="r" key={s.key}>
                <span>
                  <span className="sw" style={{ background: s.color }} />
                  {s.label}
                </span>
                <b>{compact(s.values[hover])}</b>
              </div>
            ))}
          </div>
        ) : null}
        <div className="hub-ga__axis">
          <span>-{windowLabel}</span>
          <span>now</span>
        </div>
      </div>
      <div className="hub-ga__side">
        {series.map((s) => {
          const last = s.values[s.values.length - 1] ?? 0
          const delta = deltaLabel(trendPct(s.values))
          return (
            <div className="hub-ga__tile" key={s.key} style={{ ['--c' as string]: s.color }}>
              <div className="k">
                <span className="d" style={{ background: s.color }} />
                {s.label === 'Chat/min' ? 'Chat / min' : s.label === 'Emotes/min' ? 'Emotes / min' : 'Viewers now'}
              </div>
              <div className="v">{compact(last)}</div>
              <div className={`dlt ${delta.tone === 'up' ? 'hub-up' : delta.tone === 'down' ? 'hub-down' : ''}`}>
                {delta.text === 'flat' ? 'No change vs window start' : `${delta.text} vs window start`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
