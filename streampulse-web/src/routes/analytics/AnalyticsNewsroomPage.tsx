import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, Check, Copy, ExternalLink, Radio } from 'lucide-react'
import { useNewsroomData } from '../../hooks/useNewsroomData'
import { newsroomDataThroughAge, newsroomReasonCopy, newsroomWatchAction, type NewsroomStory, type NewsroomWindow } from '../../lib/newsroom'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { LeadStoryCard } from '../../ui/components/newsroom/LeadStoryCard'
import { NetworkBrief } from '../../ui/components/newsroom/NetworkBrief'
import { NewsroomState } from '../../ui/components/newsroom/NewsroomState'
import { StoryComparisonTimeline } from '../../ui/components/newsroom/StoryComparison'
import { StoryTimeline } from '../../ui/components/newsroom/StoryTimeline'
import { StorySources } from '../../ui/components/newsroom/StorySources'
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/newsroom/newsroom.css'

const WINDOWS: Array<{ key: NewsroomWindow; label: string }> = [
  { key: 'live', label: 'Live' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
]

function selectedWindow(value: string | null): NewsroomWindow {
  return value === '24h' || value === '7d' ? value : 'live'
}

function StoryActions({ story }: { story: NewsroomStory }) {
  const [copied, setCopied] = useState(false)
  const update = story.leadUpdate
  const analyticsHref = `/analytics/${encodeURIComponent(story.login)}/${encodeURIComponent(story.streamId)}?t=${Math.floor(update.momentRef.offsetSeconds)}`
  const watch = newsroomWatchAction(story)
  const copy = async () => {
    const href = `${window.location.origin}/analytics/newsroom/${encodeURIComponent(story.id)}`
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="newsroom-actions" role="group" aria-label="Story actions">
      <Link to={analyticsHref}><BarChart3 aria-hidden="true" />Analytics</Link>
      {watch ? (
        <a href={watch.href} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{watch.label}</a>
      ) : (
        <button type="button" disabled><ExternalLink aria-hidden="true" />Replay unavailable</button>
      )}
      <button type="button" onClick={copy} aria-live="polite">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}

export default function AnalyticsNewsroomPage() {
  const { storyId } = useParams<{ storyId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const windowKey = selectedWindow(searchParams.get('window'))
  const newsroom = useNewsroomData({ window: windowKey, storyId })
  const stories = newsroom.data?.stories ?? []
  const lead = useMemo(
    () => stories.find((story) => story.id === newsroom.data?.leadStoryId) ?? stories[0] ?? null,
    [newsroom.data?.leadStoryId, stories],
  )
  const detailStory = newsroom.data?.story ?? (storyId ? stories.find((story) => story.id === storyId) : undefined)
  const statusTone = newsroom.unavailable ? 'offline' : newsroom.data?.status === 'stale' ? 'degraded' : 'ready'
  const staleReason = newsroom.data?.status === 'stale'
    ? [newsroomDataThroughAge(newsroom.data.dataThrough), newsroomReasonCopy(newsroom.error || newsroom.data.reason)].filter(Boolean).join(' ')
    : undefined

  return (
    <AnalyticsFigmaShell
      hideSidebar
      backendStatus={{ label: 'Newsroom', value: newsroom.loading ? 'Checking' : newsroom.unavailable ? 'Unavailable' : newsroom.data?.status === 'empty' ? 'Quiet' : newsroom.data?.status === 'stale' ? 'Stale' : 'Live', tone: newsroom.loading ? 'checking' : statusTone }}
    >
      <main id="analytics-main" className="newsroom-page" aria-label="Pulse Newsroom">
        <span className="sr-only" aria-live="polite" aria-atomic="true">{newsroom.announcement}</span>
        <header className="newsroom-page__hero">
          <div>
            <span className="newsroom-page__eyebrow"><Radio aria-hidden="true" />Verified live IRC activity</span>
            <h1>{storyId ? 'Pulse story' : 'Pulse Newsroom'}</h1>
            <p>{storyId ? 'A broadcast-specific timeline of measured activity.' : 'The small number of stream stories worth following—not a firehose of every detected minute.'}</p>
          </div>
          {storyId ? <Link className="newsroom-page__back" to="/analytics/newsroom">All stories</Link> : (
            <div className="newsroom-window-tabs" role="group" aria-label="Newsroom window">
              {WINDOWS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={windowKey === option.key}
                  onClick={() => setSearchParams(option.key === 'live' ? {} : { window: option.key })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </header>

        {newsroom.loading && !newsroom.data ? <NewsroomState state="loading" /> : null}
        {newsroom.unavailable ? (
          <NewsroomState state={newsroom.error === 'Story not found' ? 'error' : 'unavailable'} reason={newsroom.error || newsroom.data?.reason} onRetry={newsroom.refresh}>
            <Link to="/analytics">Return to Global Activity</Link>
          </NewsroomState>
        ) : null}
        {newsroom.data?.status === 'stale' ? <NewsroomState state="stale" reason={staleReason} onRetry={newsroom.refresh} /> : null}
        {!storyId && newsroom.data?.status === 'empty' ? <NewsroomState state="empty" reason={newsroom.data.reason} /> : null}

        {!storyId && lead ? (
          <>
            <div className={`newsroom-page__lead-grid${newsroom.data?.networkBrief ? '' : ' newsroom-page__lead-grid--solo'}`}>
              <LeadStoryCard story={lead} headingLevel={2} />
              {newsroom.data?.networkBrief ? <NetworkBrief brief={newsroom.data.networkBrief} /> : null}
            </div>
            {stories.length > 1 ? (
              <section className="newsroom-index" aria-labelledby="newsroom-index-title">
                <h2 id="newsroom-index-title">More verified stories</h2>
                <div className="newsroom-index__grid">
                  {stories.filter((story) => story.id !== lead.id).map((story) => <LeadStoryCard key={story.id} story={story} compact />)}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {storyId && detailStory ? (
          <article className="newsroom-detail">
            <LeadStoryCard story={detailStory} headingLevel={2} showDetailLink={false} />
            <StoryActions story={detailStory} />
            <StorySources sources={detailStory.sources} />
            <StoryComparisonTimeline updates={newsroom.data?.updates ?? [detailStory.leadUpdate]} />
            <StoryTimeline updates={newsroom.data?.updates ?? [detailStory.leadUpdate]} primarySignal={detailStory.primarySignal} />
            {newsroom.data?.nextCursor ? (
              <button className="newsroom-page__load-more" type="button" onClick={newsroom.loadMore} disabled={newsroom.loadingMore}>
                {newsroom.loadingMore ? 'Loading updates…' : 'Load earlier updates'}
              </button>
            ) : null}
          </article>
        ) : null}

        {!storyId && newsroom.data?.nextCursor ? (
          <button className="newsroom-page__load-more" type="button" onClick={newsroom.loadMore} disabled={newsroom.loadingMore}>
            {newsroom.loadingMore ? 'Loading stories…' : 'Load more stories'}
          </button>
        ) : null}
      </main>
    </AnalyticsFigmaShell>
  )
}
