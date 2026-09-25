import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, Check, Copy, ExternalLink, Radio } from 'lucide-react'
import { useNewsroomData } from '../../hooks/useNewsroomData'
import { configuredNewsroomWindows, newsroomDataThroughAge, newsroomReasonCopy, newsroomWatchAction, newsroomWindowAvailability, type NewsroomStory, type NewsroomWindow } from '../../lib/newsroom'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { LeadStoryCard } from '../../ui/components/newsroom/LeadStoryCard'
import { NetworkBrief } from '../../ui/components/newsroom/NetworkBrief'
import { NewsroomState } from '../../ui/components/newsroom/NewsroomState'
import { StoryComparisonTimeline } from '../../ui/components/newsroom/StoryComparison'
import { StoryTimeline } from '../../ui/components/newsroom/StoryTimeline'
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
  const configuredWindows = configuredNewsroomWindows()
  const windowAvailability = storyId ? { available: true } : newsroomWindowAvailability(windowKey)
  const newsroom = useNewsroomData({ window: windowKey, storyId, enabled: windowAvailability.available, enrichProfiles: true })
  // Detail failure must not erase a successfully available index summary.
  const indexFallback = useNewsroomData({ window: windowKey, enabled: Boolean(storyId), pollMs: 0, enrichProfiles: true })
  const stories = newsroom.data?.stories ?? []
  const lead = useMemo(
    () => stories.find((story) => story.id === newsroom.data?.leadStoryId) ?? stories[0] ?? null,
    [newsroom.data?.leadStoryId, stories],
  )
  const detailStory = newsroom.data?.story ?? (storyId ? stories.find((story) => story.id === storyId) : undefined)
  const capabilityUnavailable = !windowAvailability.available
  const statusTone = capabilityUnavailable || newsroom.unavailable ? 'offline' : newsroom.data?.status === 'stale' ? 'degraded' : 'ready'
  const staleReason = newsroom.data?.status === 'stale'
    ? [newsroomDataThroughAge(newsroom.data.dataThrough), newsroomReasonCopy(newsroom.error || newsroom.data.reason)].filter(Boolean).join(' ')
    : undefined

  return (
    <AnalyticsFigmaShell
      hideSidebar
      backendStatus={{ label: 'Newsroom', value: newsroom.loading ? 'Checking' : capabilityUnavailable || newsroom.unavailable ? 'Unavailable' : newsroom.data?.status === 'empty' ? 'Quiet' : newsroom.data?.status === 'stale' ? 'Stale' : 'Live', tone: newsroom.loading ? 'checking' : statusTone }}
    >
      <main id="analytics-main" tabIndex={-1} className="newsroom-page" aria-label="Pulse Newsroom">
        <span className="sr-only" aria-live="polite" aria-atomic="true">{newsroom.announcement}</span>
        <header className="newsroom-page__hero">
          <div>
            {storyId ? <span className="newsroom-page__eyebrow"><Radio aria-hidden="true" />Story timeline</span> : null}
            <h1>{storyId ? 'Pulse story' : 'Newsroom'}</h1>
            <p>{storyId ? 'Follow the measured activity behind this creator moment.' : 'Catch up on verified standout reactions after they develop on the Live Wire.'}</p>
          </div>
          {storyId ? <Link className="newsroom-page__back" to="/analytics/newsroom">All stories</Link> : (
            <div className="newsroom-window-tabs" role="group" aria-label="Newsroom window">
              {WINDOWS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={windowKey === option.key}
                  disabled={!configuredWindows.has(option.key)}
                  title={!configuredWindows.has(option.key) ? `${option.label} history is unavailable in this deployment` : undefined}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams)
                    if (option.key === 'live') next.delete('window')
                    else next.set('window', option.key)
                    setSearchParams(next)
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </header>

        {!storyId && configuredWindows.size < WINDOWS.length ? (
          <p className="newsroom-window-availability" role="status">
            Showing live updates. Historical windows are currently unavailable.
          </p>
        ) : null}

        {newsroom.loading && !newsroom.data ? <NewsroomState state="loading" /> : null}
        {capabilityUnavailable ? (
          <NewsroomState state="unavailable" reason={windowAvailability.reason}>
            <Link to="/analytics/newsroom">View live stories</Link>
            <Link to="/analytics">Return to Global Activity</Link>
          </NewsroomState>
        ) : newsroom.unavailable ? (
          <NewsroomState state={newsroom.error === 'Story not found' ? 'error' : 'unavailable'} reason={newsroom.error || newsroom.data?.reason} onRetry={newsroom.refresh}>
            <Link to="/analytics/newsroom">Back to Newsroom</Link>
            <Link to="/analytics/newsroom?window=live">View live stories</Link>
            <Link to="/analytics">Return to Global Activity</Link>
          </NewsroomState>
        ) : null}
        {storyId && newsroom.unavailable && indexFallback.data?.stories.length ? (
          <section className="newsroom-index" aria-labelledby="newsroom-recovery-title">
            <h2 id="newsroom-recovery-title">Available story summaries</h2>
            <p>The requested story detail is unavailable. These summaries remain available from the Newsroom index.</p>
            <div className="newsroom-index__grid">
              {indexFallback.data.stories.slice(0, 3).map((story) => <LeadStoryCard key={story.id} story={story} compact />)}
            </div>
          </section>
        ) : null}
        {newsroom.data?.status === 'stale' ? <NewsroomState state="stale" reason={staleReason} onRetry={newsroom.refresh} /> : null}
        {!storyId && newsroom.data?.status === 'empty' ? <NewsroomState state="empty" reason={newsroom.data.reason} /> : null}

        {!storyId && lead ? (
          <>
            <section className="newsroom-page__feature" aria-labelledby="newsroom-feature-title">
              <div className="newsroom-page__section-kicker"><span id="newsroom-feature-title">Featured story</span><span>Measured activity digest</span></div>
              <LeadStoryCard story={lead} headingLevel={2} compact display="feature" />
            </section>
            {stories.length > 1 ? (
              <section className="newsroom-index" aria-labelledby="newsroom-index-title">
                <div className="newsroom-index__heading">
                  <h2 id="newsroom-index-title">More stories</h2>
                </div>
                <div className="newsroom-index__grid">
                  {stories.filter((story) => story.id !== lead.id).map((story) => <LeadStoryCard key={story.id} story={story} compact display="tile" />)}
                </div>
              </section>
            ) : null}
            {newsroom.data?.networkBrief ? (
              <aside className="newsroom-page__network-note" aria-label="Network context">
                <NetworkBrief brief={newsroom.data.networkBrief} />
              </aside>
            ) : null}
          </>
        ) : null}

        {storyId && detailStory ? (
          <article className="newsroom-detail">
            <LeadStoryCard story={detailStory} headingLevel={2} showDetailLink={false} />
            <StoryActions story={detailStory} />
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
