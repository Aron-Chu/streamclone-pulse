import { Link } from 'react-router-dom'
import { Newspaper } from 'lucide-react'
import { newsroomDataThroughAge, newsroomReasonCopy, type NewsroomEnvelope, type NewsroomStory } from '../../../lib/newsroom'
import { LeadStoryCard } from './LeadStoryCard'
import { NewsroomState } from './NewsroomState'
import { StoryHeadlineList } from './StoryHeadlineList'

export interface LiveDeskRailProps {
  data: NewsroomEnvelope | null
  loading: boolean
  error?: string | null
  onRetry?: () => void
  onSelectStory: (story: NewsroomStory) => void
  fallback?: React.ReactNode
}

export function LiveDeskRail({ data, loading, error, onRetry, onSelectStory, fallback }: LiveDeskRailProps) {
  if (loading && !data) return <NewsroomState state="loading" />
  if (!data || data.status === 'unavailable') {
    return fallback ? <div className="live-desk__fallback">{fallback}</div> : (
      <NewsroomState state="unavailable" reason={error || data?.reason} onRetry={onRetry} />
    )
  }
  const staleReason = data.status === 'stale'
    ? [newsroomDataThroughAge(data.dataThrough), newsroomReasonCopy(error || data.reason)].filter(Boolean).join(' ')
    : undefined
  if (data.status === 'stale' && data.stories.length === 0) {
    return (
      <div className="live-desk" data-newsroom-status="stale">
        <LiveDeskHeader state="stale" />
        <NewsroomState state="stale" reason={staleReason} onRetry={onRetry} />
        <Link className="live-desk__all" to="/analytics/newsroom">Open Pulse Newsroom</Link>
      </div>
    )
  }
  if (data.status === 'empty' || data.stories.length === 0) {
    return (
      <div className="live-desk">
        <LiveDeskHeader state="quiet" />
        <NewsroomState state="empty" reason={data.reason}>
          <Link to="/analytics/newsroom">Open Pulse Newsroom</Link>
        </NewsroomState>
      </div>
    )
  }
  const lead = data.stories.find((story) => story.id === data.leadStoryId) ?? data.stories[0]
  const secondary = data.stories.filter((story) => story.id !== lead.id).slice(0, 2)
  return (
    <div className="live-desk" data-newsroom-status={data.status}>
      <LiveDeskHeader state={data.status === 'stale' ? 'stale' : 'live'} />
      {data.status === 'stale' ? <NewsroomState state="stale" reason={staleReason} onRetry={onRetry} /> : null}
      <LeadStoryCard story={lead} compact onSelect={onSelectStory} />
      <StoryHeadlineList stories={secondary} onSelect={onSelectStory} />
      <Link className="live-desk__all" to="/analytics/newsroom">View Pulse Newsroom</Link>
    </div>
  )
}

function LiveDeskHeader({ state }: { state: 'live' | 'stale' | 'quiet' }) {
  const label = state === 'live' ? 'Live' : state === 'stale' ? 'Stale' : 'Quiet'
  return (
    <header className="live-desk__header">
      <div><Newspaper aria-hidden="true" /><span><strong>Live Desk</strong><small>Verified IRC activity</small></span></div>
      <span className={`live-desk__live live-desk__live--${state}`}>{state === 'live' ? <i aria-hidden="true" /> : null}{label}</span>
    </header>
  )
}
