import { Link } from 'react-router-dom'
import { Activity, Clock3, MessageSquare, Radio, Sparkles } from 'lucide-react'
import type { NewsroomStory } from '../../../lib/newsroom'
import { Avatar } from '../hub/primitives'
import { StoryComparison } from './StoryComparison'
import { EvidenceSummary } from './EvidenceSummary'
import { StorySparkline } from './StorySparkline'

export interface LeadStoryCardProps {
  story: NewsroomStory
  compact?: boolean
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

export function LeadStoryCard({ story, compact = false, onSelect, headingLevel = 3, showDetailLink = true }: LeadStoryCardProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3'
  const detailHref = `/analytics/newsroom/${encodeURIComponent(story.id)}`
  const comparison = story.leadUpdate.comparison
  return (
    <article className={`newsroom-lead${compact ? ' newsroom-lead--compact' : ''}`} data-story-id={story.id}>
      <header className="newsroom-lead__header">
        <Avatar login={story.login} src={story.profileImageUrl} alt="" className="newsroom-lead__avatar" />
        <div className="newsroom-lead__identity">
          <span className="newsroom-lead__channel">{story.displayName || story.login}</span>
          <span className="newsroom-lead__category">{story.category || 'Live stream'}</span>
        </div>
        <span className={`newsroom-lifecycle newsroom-lifecycle--${story.lifecycle}`}>
          <Radio aria-hidden="true" />{lifecycleLabels[story.lifecycle]}
        </span>
      </header>
      <div className="newsroom-lead__signal">
        <span>{signalIcon(story.primarySignal)}{story.primarySignal === 'mixed' ? 'Chat + emotes' : story.primarySignal}</span>
        <time dateTime={story.lastPublishedAt}><Clock3 aria-hidden="true" />{relativePublishedAt(story.lastPublishedAt)}</time>
      </div>
      <Heading className="newsroom-lead__headline">{story.headline}</Heading>
      <p className="newsroom-lead__summary">{story.summary}</p>
      <StorySparkline
        points={story.leadUpdate.sparkline}
        signal={story.primarySignal}
        eventAt={story.leadUpdate.momentRef.occurrenceAt}
        compact={compact}
      />
      <div className="newsroom-lead__comparisons">
        <StoryComparison label="Emotes" metric={comparison.emotes} compact={compact} />
        <StoryComparison label="Chat" metric={comparison.chat} compact={compact} />
      </div>
      <EvidenceSummary evidence={story.leadUpdate.evidence} resolvedReason={story.resolvedReason} />
      <div className="newsroom-lead__actions">
        {onSelect ? (
          <button type="button" onClick={() => onSelect(story)}>Inspect activity</button>
        ) : null}
        {showDetailLink ? <Link to={detailHref}>{compact ? 'Open story' : 'Read story timeline'}</Link> : null}
      </div>
    </article>
  )
}
