import { Clock3 } from 'lucide-react'
import type { LiveWireMetricComparison } from '../../../lib/liveWire'
import type { NewsroomSignal, NewsroomUpdate } from '../../../lib/newsroom'
import { compact } from '../analytics/hubFormat'

export interface StoryTimelineProps {
  updates: NewsroomUpdate[]
  primarySignal: NewsroomSignal
}

function updateLabel(update: NewsroomUpdate): string {
  if (update.updateKind === 'correction') return 'Late correction'
  if (update.updateKind === 'lifecycle') return `Story ${update.lifecycle}`
  return update.signal === 'mixed' ? 'Chat + emote update' : `${update.signal} update`
}

function metricContext(metric: LiveWireMetricComparison): string {
  if (metric.state === 'new_activity') return 'New activity · 0/min earlier'
  if (metric.state !== 'ready') return metric.reason || 'Comparison unavailable'
  if (metric.multiplier != null) {
    return `${metric.multiplier.toFixed(metric.multiplier >= 10 ? 0 : 1)}× earlier`
  }
  if (metric.changePct != null) {
    return `${metric.changePct >= 0 ? '+' : ''}${Math.round(metric.changePct)}% versus earlier`
  }
  if (metric.baselinePerMin != null) return `${compact(metric.baselinePerMin)}/min earlier`
  return 'Measured comparison'
}

function UpdateRate({ label, metric }: { label: 'Chat' | 'Emotes'; metric: LiveWireMetricComparison }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{metric.currentPerMin == null ? '—' : `${compact(metric.currentPerMin)}/min`}</strong>
        <span>{metricContext(metric)}</span>
      </dd>
    </div>
  )
}

export function StoryTimeline({ updates, primarySignal }: StoryTimelineProps) {
  const ordered = [...updates].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id),
  )
  if (ordered.length === 0) {
    return <p className="newsroom-timeline__empty" role="status">No published updates are available for this story.</p>
  }
  return (
    <section className="newsroom-timeline" aria-labelledby="newsroom-timeline-title">
      <h2 id="newsroom-timeline-title">Story timeline</h2>
      <ol>
        {ordered.map((update) => (
          <li key={update.id} className={`newsroom-timeline__item newsroom-timeline__item--${update.updateKind}`}>
            <span className="newsroom-timeline__rail" aria-hidden="true" />
            <article>
              <header>
                <span>{updateLabel(update)}</span>
                <time dateTime={update.occurredAt}><Clock3 aria-hidden="true" />{new Date(update.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
              </header>
              <h3>{update.headline}</h3>
              <p>{update.summary}</p>
              <dl className="newsroom-timeline__rates" aria-label="Server-measured activity for this update">
                <UpdateRate label="Chat" metric={update.comparison.chat} />
                <UpdateRate label="Emotes" metric={update.comparison.emotes} />
              </dl>
              {update.isLate ? <p className="newsroom-timeline__correction">Recorded late · did not trigger a notification or reactivate this story.</p> : null}
              <p className="newsroom-timeline__signal">{update.signal === 'mixed' ? 'Chat + emotes' : update.signal || primarySignal} · revision {update.revision}</p>
            </article>
          </li>
        ))}
      </ol>
    </section>
  )
}
