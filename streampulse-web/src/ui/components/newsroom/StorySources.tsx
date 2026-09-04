import { ExternalLink, Film, MessageCircle, Newspaper } from 'lucide-react'
import type { NewsroomExternalSource } from '../../../lib/newsroom'
import { compact } from '../analytics/hubFormat'

const sourceLabels: Record<NewsroomExternalSource['source'], string> = {
  twitch_clip: 'Twitch clip',
  reddit: 'LSF / Reddit',
  x: 'X',
  youtube: 'YouTube',
  news: 'News',
}

function sourceIcon(source: NewsroomExternalSource['source']) {
  if (source === 'twitch_clip' || source === 'youtube') return <Film aria-hidden="true" />
  if (source === 'reddit' || source === 'x') return <MessageCircle aria-hidden="true" />
  return <Newspaper aria-hidden="true" />
}

function metricLabel(key: string, value: number): string {
  const label = key === 'score' ? 'points' : key
  return `${compact(value)} ${label}`
}

export function StorySourceBadges({ sources }: { sources: NewsroomExternalSource[] }) {
  if (sources.length === 0) return null
  return (
    <ul className="newsroom-source-badges" aria-label="External coverage sources">
      {sources.slice(0, 4).map((source) => (
        <li key={source.id}>{sourceIcon(source.source)}{sourceLabels[source.source]}</li>
      ))}
    </ul>
  )
}

export function StorySources({ sources }: { sources: NewsroomExternalSource[] }) {
  if (sources.length === 0) {
    return (
      <section className="newsroom-sources newsroom-sources--empty" aria-labelledby="newsroom-sources-title">
        <h2 id="newsroom-sources-title">Sources &amp; spread</h2>
        <p>StreamPulse telemetry is the primary evidence. No matched public clips or discussion links are attached yet.</p>
      </section>
    )
  }
  return (
    <section className="newsroom-sources" aria-labelledby="newsroom-sources-title">
      <header>
        <div>
          <h2 id="newsroom-sources-title">Sources &amp; spread</h2>
          <p>Matched public coverage corroborates the story but does not change its StreamPulse reaction score.</p>
        </div>
        <span>{sources.length} matched {sources.length === 1 ? 'source' : 'sources'}</span>
      </header>
      <ul>
        {sources.map((source) => {
          const metrics = Object.entries(source.metrics).slice(0, 3)
          return (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer nofollow">
                <span className={`newsroom-source newsroom-source--${source.source}`}>
                  {sourceIcon(source.source)}{sourceLabels[source.source]}
                </span>
                <strong>{source.title || `${sourceLabels[source.source]} coverage`}</strong>
                <small>
                  {source.author ? <span>{source.author}</span> : null}
                  {source.occurredAt ? <time dateTime={source.occurredAt}>{new Date(source.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time> : null}
                </small>
                {metrics.length > 0 ? <span className="newsroom-source__metrics">{metrics.map(([key, value]) => metricLabel(key, value)).join(' · ')}</span> : null}
                <ExternalLink className="newsroom-source__open" aria-hidden="true" />
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
