import type { NewsroomSignal, NewsroomSparkPoint } from '../../../lib/newsroom'

export interface StorySparklineProps {
  points?: NewsroomSparkPoint[]
  signal: NewsroomSignal
  compact?: boolean
  eventAt?: number
}

interface PositionedPoint extends NewsroomSparkPoint {
  x: number
  y: number
  baselineY?: number
}

function splitAdjacent(points: PositionedPoint[], key: 'y' | 'baselineY'): PositionedPoint[][] {
  const runs: PositionedPoint[][] = []
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    if (point[key] == null) continue
    const run = runs[runs.length - 1]
    const previousSource = index > 0 ? points[index - 1] : undefined
    const missingBetween = previousSource?.[key] == null
    if (!run || missingBetween || point.at - run[run.length - 1].at > 65_000) runs.push([point])
    else run.push(point)
  }
  return runs
}

function pathFor(points: PositionedPoint[], key: 'y' | 'baselineY'): string {
  const usable = points.filter((point) => point[key] != null)
  if (usable.length < 2) return ''
  return usable.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${Number(point[key]).toFixed(2)}`).join(' ')
}

export function StorySparkline({ points = [], signal, compact = false, eventAt }: StorySparklineProps) {
  const width = compact ? 280 : 720
  const height = compact ? 84 : 150
  const pad = compact ? 6 : 10
  if (points.length < 2) {
    return (
      <div className="newsroom-sparkline newsroom-sparkline--empty" role="status">
        Trend appears after two measured minutes.
      </div>
    )
  }
  const firstAt = points[0].at
  const lastAt = points[points.length - 1].at
  const span = Math.max(60_000, lastAt - firstAt)
  const values = points.flatMap((point) => [point.currentPerMin, point.baselinePerMin ?? 0])
  const max = Math.max(1, ...values)
  const positioned: PositionedPoint[] = points.map((point) => ({
    ...point,
    x: pad + ((point.at - firstAt) / span) * (width - pad * 2),
    y: height - pad - (point.currentPerMin / max) * (height - pad * 2),
    baselineY: point.baselinePerMin == null
      ? undefined
      : height - pad - (point.baselinePerMin / max) * (height - pad * 2),
  }))
  const currentRuns = splitAdjacent(positioned, 'y')
  const baselineRuns = splitAdjacent(positioned, 'baselineY')
  const eventX = eventAt == null
    ? null
    : pad + Math.max(0, Math.min(1, (eventAt - firstAt) / span)) * (width - pad * 2)
  const signalLabel = signal === 'mixed' ? 'activity' : signal
  const latest = points[points.length - 1]
  return (
    <figure className={`newsroom-sparkline${compact ? ' newsroom-sparkline--compact' : ''}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${signalLabel} trend over ${points.length} measured minutes. Latest ${Math.round(latest.currentPerMin)} per minute${latest.baselinePerMin == null ? '' : `, earlier baseline ${Math.round(latest.baselinePerMin)} per minute`}. Missing minutes are gaps.`}
      >
        <line className="newsroom-sparkline__grid" x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} />
        {baselineRuns.map((run, index) => {
          const baselinePath = pathFor(run, 'baselineY')
          return baselinePath ? <path key={`baseline-${index}`} className="newsroom-sparkline__baseline" d={baselinePath} /> : null
        })}
        {currentRuns.map((run, index) => {
          const currentPath = pathFor(run, 'y')
          return currentPath ? <path key={`current-${index}`} className="newsroom-sparkline__current" d={currentPath} /> : null
        })}
        {eventX != null ? <line className="newsroom-sparkline__event" x1={eventX} y1={pad} x2={eventX} y2={height - pad} /> : null}
      </svg>
      <figcaption>
        <span><i className="newsroom-sparkline__key newsroom-sparkline__key--current" />Measured {signalLabel}</span>
        {points.some((point) => point.baselinePerMin != null) ? (
          <span><i className="newsroom-sparkline__key newsroom-sparkline__key--baseline" />Earlier in this stream</span>
        ) : null}
      </figcaption>
    </figure>
  )
}
