import { Link } from 'react-router-dom'
import { Activity, Clock3, MessageSquare, Radio, Sparkles } from 'lucide-react'
import { newsroomMetricForSignal, type NewsroomStory } from '../../../lib/newsroom'
import { Avatar } from '../hub/primitives'
import { StoryComparison } from './StoryComparison'
import { EvidenceSummary, evidenceHeadline } from './EvidenceSummary'
import { StorySparkline } from './StorySparkline'
import { compact as compactNumber } from '../analytics/hubFormat'
import { EmoteImg } from '../analytics/EmoteImg'

export interface LeadStoryCardProps {
  story: NewsroomStory
  compact?: boolean
  /** Page-only editorial treatments. Omit to preserve the shared Live Desk/detail contract. */
  display?: 'default' | 'feature' | 'tile'
  onSelect?: (story: NewsroomStory) => void
  headingLevel?: 2 | 3
  showDetailLink?: boolean
}

const lifecycleLabels: Record<NewsroomStory['lifecycle'], string> = {
  developing: 'Developing',
  confirmed: 'Confirmed',
  cooling: 'Cooling',
  resolved: 'Resolved',
}

function signalIcon(signal: NewsroomStory['primarySignal']) {
  if (signal === 'chat') return <MessageSquare aria-hidden="true" />
  if (signal === 'emotes') return <Sparkles aria-hidden="true" />
  return <Activity aria-hidden="true" />
}

function relativePublishedAt(value: string): string {
  const deltaMinutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000))
  if (deltaMinutes < 1) return 'just now'
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const hours = Math.round(deltaMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function StoryVisual({ story, compact }: { story: NewsroomStory; compact?: boolean }) {
  const points = story.leadUpdate.sparkline ?? []
  if (points.length >= 2) {
    return (
      <div className="newsroom-lead__visual">
        <StorySparkline
          points={points}
          signal={story.primarySignal}
          compact={compact}
          eventAt={story.leadUpdate.momentRef.occurrenceAt}
        />
      </div>
    )
  }

  const emotes = story.leadUpdate.topEmotes.filter((emote) => emote.count > 0).slice(0, compact ? 2 : 3)
  if (!emotes.length) return null
  return (
    <div className="newsroom-lead__emote-visual" aria-label="Top measured emotes">
      {emotes.map((emote) => (
        <div key={`${emote.provider ?? 'emote'}:${emote.id ?? emote.name}`}>
          <span className="newsroom-lead__emote-name">
            <EmoteImg src={emote.imageUrl} name={emote.name} width={29} height={29} displayPx={29} />
            <span>{emote.name}</span>
          </span>
          <span className="newsroom-lead__emote-count">
            {compactNumber(emote.count)} measured
          </span>
        </div>
      ))}
    </div>
  )
}

export function LeadStoryCard({ story, compact = false, display = 'default', onSelect, headingLevel = 3, showDetailLink = true }: LeadStoryCardProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3'
  const detailHref = `/analytics/newsroom/${encodeURIComponent(story.id)}`
  const creatorHref = `/analytics/${encodeURIComponent(story.login)}`
  const editorial = display === 'feature' || display === 'tile'
  const tile = display === 'tile'
  const comparison = story.leadUpdate.comparison
  const leadingMetric = newsroomMetricForSignal(comparison, story.primarySignal)
  const leadingMetricLabel = story.primarySignal === 'chat' || leadingMetric === comparison.chat ? 'Chat' : 'Emotes'
  const compactReason = story.leadUpdate.evidence.eventRollupAvailable && story.leadUpdate.evidence.streamIdentityMatched
    ? story.summary
    : evidenceHeadline(story.leadUpdate.evidence, story.resolvedReason)
  return (
    <article className={`newsroom-lead${compact ? ' newsroom-lead--compact' : ''}${editorial ? ` newsroom-lead--${display}` : ''}`} data-story-id={story.id}>
      <header className="newsroom-lead__header">
        <Link className="newsroom-lead__creator-avatar" to={creatorHref} aria-label={`Open ${story.displayName || story.login} analytics`}>
          <Avatar login={story.login} src={story.profileImageUrl} alt="" className="newsroom-lead__avatar" />
        </Link>
        <div className="newsroom-lead__identity">
          <Link className="newsroom-lead__channel" to={creatorHref}>{story.displayName || story.login}</Link>
          <span className="newsroom-lead__category">{story.category || 'Category unavailable'}</span>
        </div>
        <span className={`newsroom-lifecycle newsroom-lifecycle--${story.lifecycle}`} title="Story activity state, not broadcast live status">
          <Radio aria-hidden="true" />{lifecycleLabels[story.lifecycle]}
        </span>
      </header>
      <div className="newsroom-lead__signal">
        <span>{signalIcon(story.primarySignal)}{story.primarySignal === 'mixed' ? 'Chat + emotes' : story.primarySignal}</span>
        <time dateTime={story.lastPublishedAt}><Clock3 aria-hidden="true" />{relativePublishedAt(story.lastPublishedAt)}</time>
      </div>
      <Heading className="newsroom-lead__headline">
        {editorial && showDetailLink ? <Link to={detailHref}>{story.headline}</Link> : story.headline}
      </Heading>
      {editorial ? (
        <>
          <div className="newsroom-lead__editorial-fact" aria-label="Primary measured fact">
            <span>{leadingMetricLabel} at this moment</span>
            <strong>{leadingMetric?.currentPerMin == null ? 'Unavailable' : `${compactNumber(leadingMetric.currentPerMin)}/min`}</strong>
            {leadingMetric?.baselinePerMin != null ? <small>Earlier {compactNumber(leadingMetric.baselinePerMin)}/min</small> : null}
          </div>
          <StoryVisual story={story} compact={tile} />
        </>
      ) : compact ? (
        <>
          <p className="newsroom-lead__reason">{compactReason}</p>
          <div className="newsroom-lead__leading-metric" aria-label="Leading measured metric">
            <span>{leadingMetricLabel}</span>
            <strong>{leadingMetric?.currentPerMin == null ? 'Unavailable' : `${compactNumber(leadingMetric.currentPerMin)}/min`}</strong>
          </div>
        </>
      ) : (
        <>
          <p className="newsroom-lead__summary">{story.summary}</p>
          <StorySparkline
            points={story.leadUpdate.sparkline}
            signal={story.primarySignal}
            eventAt={story.leadUpdate.momentRef.occurrenceAt}
          />
          <div className="newsroom-lead__comparisons">
            <StoryComparison label="Emotes" metric={comparison.emotes} />
            <StoryComparison label="Chat" metric={comparison.chat} />
          </div>
          <EvidenceSummary evidence={story.leadUpdate.evidence} resolvedReason={story.resolvedReason} />
        </>
      )}
      <div className={`newsroom-lead__actions${editorial ? ' newsroom-lead__actions--editorial' : ''}`}>
        {onSelect ? (
          <button type="button" onClick={() => onSelect(story)}>Inspect activity</button>
        ) : null}
        {showDetailLink && !editorial ? <Link to={detailHref}>{compact ? 'Open story' : 'Read story timeline'}</Link> : null}
        {showDetailLink && editorial ? <Link to={detailHref}>View story</Link> : null}
      </div>
    </article>
  )
}
