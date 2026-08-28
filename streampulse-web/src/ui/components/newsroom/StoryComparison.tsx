import { AlertCircle, CheckCircle2, Clock3, Sparkles } from 'lucide-react'
import type { LiveWireMetricComparison } from '../../../lib/liveWire'
import type { NewsroomUpdate } from '../../../lib/newsroom'
import { compact } from '../analytics/hubFormat'

export interface StoryComparisonProps {
  label: 'Chat' | 'Emotes'
  metric: LiveWireMetricComparison
  compact?: boolean
}

function stateMeta(metric: LiveWireMetricComparison) {
  switch (metric.state) {
    case 'ready':
      return { icon: <CheckCircle2 aria-hidden="true" />, label: 'Measured comparison' }
    case 'new_activity':
      return { icon: <Sparkles aria-hidden="true" />, label: 'New activity' }
    case 'warming':
      return { icon: <Clock3 aria-hidden="true" />, label: 'Earlier baseline warming' }
    case 'partial':
      return { icon: <AlertCircle aria-hidden="true" />, label: 'Partial history' }
    default:
      return { icon: <AlertCircle aria-hidden="true" />, label: 'Comparison unavailable' }
  }
}

function deltaLabel(metric: LiveWireMetricComparison): string {
  if (metric.state === 'new_activity') return 'New activity · 0/min earlier'
  if (metric.state !== 'ready') return metric.reason || 'Not enough measured history'
  if (metric.multiplier != null) return `${metric.multiplier.toFixed(metric.multiplier >= 10 ? 0 : 1)}× earlier`
  if (metric.changePct != null) return `${metric.changePct >= 0 ? '+' : ''}${Math.round(metric.changePct)}% versus earlier`
  if (metric.absoluteDeltaPerMin != null) return `${metric.absoluteDeltaPerMin >= 0 ? '+' : ''}${compact(metric.absoluteDeltaPerMin)}/min versus earlier`
  return 'Measured comparison'
}

export function StoryComparison({ label, metric, compact = false }: StoryComparisonProps) {
  const meta = stateMeta(metric)
  const ratio = metric.state === 'ready' && metric.multiplier != null ? metric.multiplier : null
  const trackPct = ratio == null ? 0 : Math.min(100, Math.max(0, (ratio / 4) * 100))
  const overflow = ratio != null && ratio > 4
  return (
    <section
      className={`newsroom-comparison newsroom-comparison--${metric.state}${compact ? ' newsroom-comparison--compact' : ''}`}
      aria-label={`${label} comparison: ${deltaLabel(metric)}`}
    >
      <header>
        <span className="newsroom-comparison__label">{label}</span>
        <span className="newsroom-comparison__state">{meta.icon}{meta.label}</span>
      </header>
      <div className="newsroom-comparison__values">
        <strong>{metric.currentPerMin == null ? '—' : `${compactNumber(metric.currentPerMin)}/min`}</strong>
        <span>{deltaLabel(metric)}</span>
      </div>
      {ratio != null ? (
        <div className="newsroom-comparison__scale" aria-hidden="true">
          <div className="newsroom-comparison__track">
            <span className="newsroom-comparison__fill" style={{ width: `${trackPct}%` }} />
            <i className="newsroom-comparison__baseline" />
            {overflow ? <b className="newsroom-comparison__overflow">4×+</b> : null}
          </div>
          <span>0×</span><span>1× earlier</span><span>4×</span>
        </div>
      ) : null}
      {!compact ? (
        <p className="newsroom-comparison__evidence">
          Earlier baseline {metric.baselineMeasuredMinutes}/{metric.baselineExpectedMinutes} min · {Math.round(metric.baselineCoveragePct)}% coverage
        </p>
      ) : null}
    </section>
  )
}

function compactNumber(value: number): string {
  return compact(value)
}

export interface StoryComparisonTimelineProps {
  updates: NewsroomUpdate[]
}

type TimelineMetric = 'chat' | 'emotes'

interface RatioPoint {
  id: string
  at: number
  ratio: number
  label: string
}

function ratioPoints(updates: NewsroomUpdate[], metric: TimelineMetric): RatioPoint[] {
  return updates
    .map((update) => {
      const comparison = update.comparison[metric]
      if (comparison.state !== 'ready' || comparison.multiplier == null || !Number.isFinite(comparison.multiplier)) {
        return null
      }
      return {
        id: update.id,
        at: update.comparison.eventAt,
        ratio: comparison.multiplier,
        label: `${new Date(update.comparison.eventAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${comparison.multiplier.toFixed(comparison.multiplier >= 10 ? 0 : 1)}× earlier`,
      }
    })
    .filter((point): point is RatioPoint => point != null)
    .sort((a, b) => a.at - b.at)
}

function TimelineRow({
  label,
  points,
  firstAt,
  lastAt,
}: {
  label: 'Chat' | 'Emotes'
  points: RatioPoint[]
  firstAt: number
  lastAt: number
}) {
  const width = 720
  const height = 112
  const xPad = 20
  const yPad = 12
  const span = Math.max(60_000, lastAt - firstAt)
  const x = (at: number) => xPad + ((at - firstAt) / span) * (width - xPad * 2)
  const y = (ratio: number) => height - yPad - (Math.min(4, Math.max(0, ratio)) / 4) * (height - yPad * 2)
  const baselineY = y(1)
  return (
    <figure className="newsroom-ratio-timeline__row">
      <figcaption>{label} relative to earlier in the same stream</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} comparison timeline. ${points.length} measured ratio ${points.length === 1 ? 'update' : 'updates'}. A one-times line marks the earlier-stream baseline. New activity and unavailable comparisons are omitted.`}
      >
        <line className="newsroom-ratio-timeline__grid" x1={xPad} y1={y(4)} x2={width - xPad} y2={y(4)} />
        <line className="newsroom-ratio-timeline__baseline" x1={xPad} y1={baselineY} x2={width - xPad} y2={baselineY} />
        <text className="newsroom-ratio-timeline__baseline-label" x={xPad + 4} y={baselineY - 5}>1× earlier</text>
        {points.map((point) => (
          <g key={point.id} data-update-id={point.id} aria-label={point.label}>
            <line className="newsroom-ratio-timeline__stem" x1={x(point.at)} y1={baselineY} x2={x(point.at)} y2={y(point.ratio)} />
            <circle className="newsroom-ratio-timeline__point" cx={x(point.at)} cy={y(point.ratio)} r={4} />
            {point.ratio > 4 ? (
              <path className="newsroom-ratio-timeline__overflow" d={`M${x(point.at) - 5},${y(4) + 7} L${x(point.at)},${y(4)} L${x(point.at) + 5},${y(4) + 7} Z`} />
            ) : null}
          </g>
        ))}
      </svg>
    </figure>
  )
}

/** Server-owned event ratios on one shared time domain; it never derives a browser baseline. */
export function StoryComparisonTimeline({ updates }: StoryComparisonTimelineProps) {
  const chronological = [...updates].sort(
    (a, b) => a.comparison.eventAt - b.comparison.eventAt || a.id.localeCompare(b.id),
  )
  const firstAt = chronological[0]?.comparison.eventAt
  const lastAt = chronological[chronological.length - 1]?.comparison.eventAt
  const chat = ratioPoints(chronological, 'chat')
  const emotes = ratioPoints(chronological, 'emotes')
  const newActivityCount = chronological.filter(
    (update) => update.comparison.chat.state === 'new_activity' || update.comparison.emotes.state === 'new_activity',
  ).length
  if (firstAt == null || lastAt == null || (chat.length === 0 && emotes.length === 0)) {
    return (
      <section className="newsroom-ratio-timeline newsroom-ratio-timeline--empty" aria-labelledby="newsroom-comparison-title">
        <h2 id="newsroom-comparison-title">Activity compared with earlier in this stream</h2>
        <p role="status">No ratio is available. New activity and incomplete comparisons are shown as raw rates in the story updates.</p>
      </section>
    )
  }
  return (
    <section className="newsroom-ratio-timeline" aria-labelledby="newsroom-comparison-title">
      <header>
        <div>
          <h2 id="newsroom-comparison-title">Activity compared with earlier in this stream</h2>
          <p>Server-measured event ratios. Missing comparisons remain gaps; 1× is this broadcast’s earlier measured rate.</p>
        </div>
        {newActivityCount > 0 ? <span>{newActivityCount} new-activity {newActivityCount === 1 ? 'update' : 'updates'} shown without a ratio</span> : null}
      </header>
      <TimelineRow label="Chat" points={chat} firstAt={firstAt} lastAt={lastAt} />
      <TimelineRow label="Emotes" points={emotes} firstAt={firstAt} lastAt={lastAt} />
      <div className="newsroom-ratio-timeline__axis" aria-hidden="true">
        <time>{new Date(firstAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
        <span>Shared event-time axis</span>
        <time>{new Date(lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
      </div>
    </section>
  )
}
