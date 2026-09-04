import { useEffect, useMemo, useRef, useState, type FormEvent, type Ref } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  Radio,
  RefreshCw,
  Search,
} from 'lucide-react'

import { useExplorerData } from '../../hooks/useExplorerData'
import {
  explorerReasonCopy,
  type ExplorerBroadcast,
  type ExplorerQuery,
  type ExplorerSignal,
  type ExplorerSort,
  type ExplorerState,
} from '../../lib/explorer'
import { buildVodTimestampUrl } from '../../lib/figmaSessionAnalytics'
import { formatApproximate, formatRelativeTime } from '../../lib/formatStats'
import { newsroomDataThroughAge, type NewsroomExternalSource, type NewsroomUpdate, type NewsroomWindow } from '../../lib/newsroom'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { Avatar } from '../../ui/components/hub/primitives'
import { ResilientImage } from '../../ui/components/ResilientImage'
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/explorer/explorer.css'

const WINDOWS: Array<{ value: NewsroomWindow; label: string }> = [
  { value: 'live', label: 'Live' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
]

const SIGNALS: Array<{ value: ExplorerSignal; label: string }> = [
  { value: 'all', label: 'All signals' },
  { value: 'chat', label: 'Chat' },
  { value: 'emotes', label: 'Emotes' },
  { value: 'mixed', label: 'Mixed' },
]

const STATES: Array<{ value: ExplorerState; label: string }> = [
  { value: 'all', label: 'All streams' },
  { value: 'live', label: 'Live now' },
  { value: 'ended', label: 'Ended' },
]

const SORTS: Array<{ value: ExplorerSort; label: string }> = [
  { value: 'strongest', label: 'Strongest' },
  { value: 'recent', label: 'Most recent' },
  { value: 'moments', label: 'Most moments' },
]

function oneOf<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value && values.includes(value as T) ? value as T : fallback
}

function queryFromParams(params: URLSearchParams): ExplorerQuery {
  return {
    window: oneOf(params.get('window'), ['live', '24h', '7d'] as const, '24h'),
    signal: oneOf(params.get('signal'), ['all', 'chat', 'emotes', 'mixed'] as const, 'all'),
    category: params.get('category')?.trim() || undefined,
    state: oneOf(params.get('state'), ['all', 'live', 'ended'] as const, 'all'),
    sort: oneOf(params.get('sort'), ['strongest', 'recent', 'moments'] as const, 'strongest'),
    q: params.get('q')?.trim() || undefined,
  }
}

function paramsFromQuery(query: ExplorerQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.window !== '24h') params.set('window', query.window)
  if (query.signal !== 'all') params.set('signal', query.signal)
  if (query.category) params.set('category', query.category)
  if (query.state !== 'all') params.set('state', query.state)
  if (query.sort !== 'strongest') params.set('sort', query.sort)
  if (query.q) params.set('q', query.q)
  return params
}

function withSearch(pathname: string, params: URLSearchParams): string {
  const search = params.toString()
  return `${pathname}${search ? `?${search}` : ''}`
}

function sourceLabel(source: NewsroomExternalSource['source']): string {
  if (source === 'twitch_clip') return 'Twitch clip'
  if (source === 'reddit') return 'Reddit / LSF'
  if (source === 'youtube') return 'YouTube'
  return 'News coverage'
}

function sourceMetric(source: NewsroomExternalSource): string | null {
  const entries = Object.entries(source.metrics)
  if (!entries.length) return null
  const [key, value] = entries[0]
  return `${formatApproximate(value)} ${key}`
}

function primaryComparison(update: NewsroomUpdate): { label: string; value: string; note: string }[] {
  return (['chat', 'emotes'] as const).flatMap((key) => {
    const metric = update.comparison[key]
    if (metric.state !== 'ready' && metric.state !== 'new_activity') return []
    const current = metric.currentPerMin
    const baseline = metric.baselinePerMin
    if (current == null) return []
    const unit = key === 'chat' ? 'msg/min' : 'emotes/min'
    const multiplier = metric.multiplier != null ? `${metric.multiplier.toFixed(1)}× baseline` : 'new activity'
    return [{
      label: key === 'chat' ? 'Chat rate' : 'Emote rate',
      value: `${formatApproximate(current)} ${unit}`,
      note: baseline == null ? multiplier : `${multiplier} · ${formatApproximate(baseline)} usual`,
    }]
  })
}

function BroadcastAvatar({ broadcast, large = false }: { broadcast: ExplorerBroadcast; large?: boolean }) {
  return (
    <Avatar
      className={`explorer-avatar${large ? ' explorer-avatar--large' : ''}`}
      login={broadcast.displayName || broadcast.login}
      src={broadcast.profileImageUrl}
      alt={`${broadcast.displayName || broadcast.login} avatar`}
    />
  )
}

function EmoteStrip({ update, compact = false }: { update: NewsroomUpdate; compact?: boolean }) {
  const emotes = update.topEmotes.slice(0, 3)
  if (!emotes.length) return null
  return (
    <div className="explorer-emotes" aria-label="Top emotes">
      {emotes.map((emote) => compact ? (
        <span className="explorer-emote explorer-emote--compact" key={`${emote.provider || 'emote'}-${emote.name}`} title={`${emote.name}: ${emote.count}`}>
          <span>{emote.name}</span>
        </span>
      ) : (
        <span className="explorer-emote" key={`${emote.provider || 'emote'}-${emote.name}`} title={`${emote.name}: ${emote.count}`}>
          <ResilientImage src={emote.imageUrl} alt="" fallback={<span className="explorer-emote__fallback" aria-hidden="true">{emote.name.slice(0, 1)}</span>} />
          <span>{emote.name}</span>
          <small>{formatApproximate(emote.count)}</small>
        </span>
      ))}
    </div>
  )
}

function ScoreTrend({ moments }: { moments: NewsroomUpdate[] }) {
  const points = moments
    .filter((moment): moment is NewsroomUpdate & { score: number } => typeof moment.score === 'number')
    .map((moment) => ({ score: moment.score, at: Date.parse(moment.occurredAt) }))
    .filter((point) => Number.isFinite(point.at))
  if (points.length < 2) return null
  const width = 720
  const height = 108
  const minAt = Math.min(...points.map((point) => point.at))
  const maxAt = Math.max(...points.map((point) => point.at))
  const span = maxAt - minAt || 1
  const coords = points.map((point) => {
    const x = 10 + ((point.at - minAt) / span) * (width - 20)
    const y = height - 10 - (point.score / 100) * (height - 20)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <figure className="explorer-trend">
      <figcaption>Reaction score across this broadcast</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Reaction score trend with ${points.length} measured moments`} preserveAspectRatio="none">
        <line x1="10" y1={height - 10} x2={width - 10} y2={height - 10} />
        <polyline points={coords} />
        {coords.split(' ').map((point, index) => {
          const [cx, cy] = point.split(',')
          return <circle key={`${cx}-${index}`} cx={cx} cy={cy} r="3.5" />
        })}
      </svg>
    </figure>
  )
}

function ExplorerStatePanel({
  kind,
  reason,
  onRetry,
}: {
  kind: 'loading' | 'empty' | 'unavailable'
  reason?: string | null
  onRetry?: () => void
}) {
  const copy = kind === 'loading'
    ? ['Loading verified broadcasts', 'Reading qualified reaction activity.']
    : kind === 'empty'
      ? ['No matching broadcasts', explorerReasonCopy(reason) || 'Try a wider range or fewer filters.']
      : ['Pulse Explorer is unavailable', explorerReasonCopy(reason) || 'Verified activity could not be reached.']
  return (
    <div className={`explorer-state explorer-state--${kind}`} role={kind === 'loading' ? 'status' : 'alert'}>
      <Radio aria-hidden="true" />
      <strong>{copy[0]}</strong>
      <span>{copy[1]}</span>
      {onRetry ? <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</button> : null}
    </div>
  )
}

function BroadcastResult({ broadcast, selected, href }: { broadcast: ExplorerBroadcast; selected: boolean; href: string }) {
  return (
    <Link className="explorer-result" data-selected={selected || undefined} aria-current={selected ? 'page' : undefined} to={href}>
      <div className="explorer-result__top">
        <BroadcastAvatar broadcast={broadcast} />
        <span className="explorer-result__identity">
          <strong>{broadcast.displayName || broadcast.login}</strong>
          <small>{broadcast.category || 'Category unavailable'}</small>
        </span>
        <span className={`explorer-status explorer-status--${broadcast.state}`}>
          {broadcast.state === 'live' ? 'Live' : 'Ended'}
        </span>
      </div>
      <p>{broadcast.strongestMoment.headline}</p>
      <div className="explorer-result__metrics">
        <span><strong>{broadcast.strongestScore}</strong> strongest</span>
        <span><strong>{broadcast.momentCount}</strong> {broadcast.momentCount === 1 ? 'moment' : 'moments'}</span>
        <span>{formatRelativeTime(broadcast.lastActivityAt)}</span>
      </div>
      <div className="explorer-result__foot">
        <span className={`explorer-signal explorer-signal--${broadcast.primarySignal}`}>{broadcast.primarySignal}</span>
        <EmoteStrip update={broadcast.strongestMoment} compact />
        {broadcast.sources.length ? <small>{broadcast.sources.length} matched {broadcast.sources.length === 1 ? 'source' : 'sources'}</small> : null}
      </div>
    </Link>
  )
}

function BroadcastActions({ broadcast, query }: { broadcast: ExplorerBroadcast; query: ExplorerQuery }) {
  const [copied, setCopied] = useState(false)
  const anchor = broadcast.strongestMoment
  const analytics = `/analytics/${encodeURIComponent(broadcast.login)}/${encodeURIComponent(broadcast.streamId)}?t=${Math.floor(anchor.momentRef.offsetSeconds)}`
  const watch = broadcast.state === 'live'
    ? { href: `https://www.twitch.tv/${encodeURIComponent(broadcast.login)}`, label: 'Watch live' }
    : anchor.vodId
      ? { href: buildVodTimestampUrl(anchor.vodId, anchor.momentRef.offsetSeconds), label: 'Watch VOD' }
      : null
  const copy = async () => {
    const path = withSearch(`/analytics/explore/${encodeURIComponent(broadcast.id)}`, paramsFromQuery(query))
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="explorer-actions" role="group" aria-label="Broadcast actions">
      <Link to={analytics}><BarChart3 aria-hidden="true" />Analytics</Link>
      {watch ? <a href={watch.href} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{watch.label}</a> : <span className="explorer-actions__disabled">Replay unavailable</span>}
      <button type="button" onClick={copy}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  )
}

function BroadcastInspector({
  broadcast,
  moments,
  query,
  loading,
  unavailable,
  error,
  onRetry,
  backHref,
  headingRef,
}: {
  broadcast: ExplorerBroadcast | null
  moments: NewsroomUpdate[]
  query: ExplorerQuery
  loading: boolean
  unavailable: boolean
  error?: string | null
  onRetry: () => void
  backHref: string
  headingRef: Ref<HTMLHeadingElement>
}) {
  if (loading && !broadcast) return <ExplorerStatePanel kind="loading" />
  if (unavailable && !broadcast) return <ExplorerStatePanel kind="unavailable" reason={error} onRetry={onRetry} />
  if (!broadcast) return <div className="explorer-inspector__placeholder"><Radio aria-hidden="true" /><span>Select a broadcast to inspect its verified moments.</span></div>
  const orderedMoments = [...moments].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  return (
    <article className="explorer-inspector__article">
      <Link className="explorer-back" to={backHref}><ArrowLeft aria-hidden="true" />Back to broadcasts</Link>
      <header className="explorer-inspector__header">
        <BroadcastAvatar broadcast={broadcast} large />
        <div>
          <div className="explorer-inspector__identity">
            <span className={`explorer-status explorer-status--${broadcast.state}`}>{broadcast.state === 'live' ? 'Live now' : 'Ended'}</span>
            <span className={`explorer-signal explorer-signal--${broadcast.primarySignal}`}>{broadcast.primarySignal}</span>
          </div>
          <h2 ref={headingRef} tabIndex={-1}>{broadcast.displayName || broadcast.login}</h2>
          <p>{broadcast.category || 'Category unavailable'} · exact stream session</p>
        </div>
      </header>
      <div className="explorer-inspector__summary">
        <span><small>Strongest</small><strong>{broadcast.strongestScore}</strong></span>
        <span><small>Verified moments</small><strong>{broadcast.momentCount}</strong></span>
        <span><small>Latest activity</small><strong>{formatRelativeTime(broadcast.lastActivityAt)}</strong></span>
        <span><small>Coverage</small><strong>{Math.round(broadcast.strongestMoment.evidence.baselineCoveragePct)}%</strong></span>
      </div>
      <BroadcastActions broadcast={broadcast} query={query} />
      {unavailable ? (
        <div className="explorer-inspector__error" role="alert">
          <div><strong>Broadcast details are unavailable</strong><span>{explorerReasonCopy(error) || 'The result list is still available while this inspector reconnects.'}</span></div>
          <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</button>
        </div>
      ) : orderedMoments.length >= 2 ? <ScoreTrend moments={orderedMoments} /> : (
        <section className="explorer-single-evidence" aria-label="Single verified moment">
          <strong>One verified moment in this broadcast</strong>
          <span>There are not enough measured points to draw a meaningful trend.</span>
        </section>
      )}
      {!unavailable ? <section className="explorer-moments" aria-labelledby="explorer-moments-title">
        <header>
          <div><span>Broadcast activity</span><h3 id="explorer-moments-title">Qualified moments</h3></div>
          <small>Chronological · backend scored</small>
        </header>
        <ol>
          {orderedMoments.map((moment) => {
            const comparisons = primaryComparison(moment)
            return (
              <li key={moment.id}>
                <div className="explorer-moment__marker" aria-hidden="true" />
                <article>
                  <header>
                    <time dateTime={moment.occurredAt}>{new Date(moment.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    <span className={`explorer-signal explorer-signal--${moment.signal}`}>{moment.signal}</span>
                    {typeof moment.score === 'number' ? <strong>{moment.score} score</strong> : null}
                  </header>
                  <h4>{moment.headline}</h4>
                  <p>{moment.summary}</p>
                  {comparisons.length ? <div className="explorer-comparisons">{comparisons.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong><em>{item.note}</em></span>)}</div> : null}
                  <EmoteStrip update={moment} />
                  <footer>
                    <span>{moment.evidence.baselineMeasuredMinutes}/{moment.evidence.baselineExpectedMinutes} baseline minutes measured</span>
                    <span>{moment.evidence.ircBound ? 'IRC bound' : 'IRC not bound'}</span>
                  </footer>
                </article>
              </li>
            )
          })}
        </ol>
      </section> : null}
      {!unavailable ? <section className="explorer-context" aria-labelledby="explorer-context-title">
        <header><span>Matched context</span><h3 id="explorer-context-title">Outside coverage</h3></header>
        <p>Context is matched after qualification and never changes StreamPulse scores or ordering.</p>
        {broadcast.sources.length ? (
          <ul>{broadcast.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer"><span><small>{sourceLabel(source.source)}</small><strong>{source.title || source.author || 'Open matched source'}</strong></span>{sourceMetric(source) ? <em>{sourceMetric(source)}</em> : null}<ExternalLink aria-hidden="true" /></a></li>)}</ul>
        ) : <div className="explorer-context__empty">No approved external context has been matched to this broadcast.</div>}
      </section> : null}
    </article>
  )
}

export default function AnalyticsExplorerPage() {
  const { broadcastId } = useParams<{ broadcastId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const query = useMemo(() => queryFromParams(searchParams), [searchParams])
  const [searchDraft, setSearchDraft] = useState(query.q ?? '')
  const list = useExplorerData(query)
  const defaultBroadcast = list.data?.broadcasts[0] ?? null
  const selectedId = broadcastId || defaultBroadcast?.id
  const detail = useExplorerData({ ...query, broadcastId: selectedId, enabled: Boolean(selectedId) })
  const selectedFromList = selectedId
    ? list.data?.broadcasts.find((item) => item.id === selectedId) ?? null
    : defaultBroadcast
  const selected = detail.data?.broadcast ?? selectedFromList ?? null
  const moments = detail.data?.moments ?? (selected ? [selected.strongestMoment] : [])
  const headingRef = useRef<HTMLHeadingElement>(null)
  const canonicalParams = paramsFromQuery(query)
  const backHref = withSearch('/analytics/explore', canonicalParams)

  useEffect(() => setSearchDraft(query.q ?? ''), [query.q])
  useEffect(() => {
    if (!broadcastId) return
    headingRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      navigate(backHref)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [backHref, broadcastId, navigate])

  const replaceQuery = (patch: Partial<ExplorerQuery>) => {
    const next = paramsFromQuery({ ...query, ...patch })
    navigate(withSearch('/analytics/explore', next))
  }
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    replaceQuery({ q: searchDraft.trim() || undefined })
  }
  const dataAge = newsroomDataThroughAge(list.data?.dataThrough)
  const statusTone = list.unavailable ? 'offline' : list.data?.status === 'stale' ? 'degraded' : 'ready'
  const network = list.data?.networkContext
  const hasNetworkComparison = Boolean(network && network.comparableChannels > 0 && (network.chatChangePct != null || network.emoteChangePct != null))
  const singleWorkspaceState = list.unavailable || list.data?.status === 'empty'

  return (
    <AnalyticsFigmaShell
      hideSidebar
      backendStatus={{
        label: 'Explorer',
        value: list.loading ? 'Checking' : list.unavailable ? 'Unavailable' : list.data?.status === 'empty' ? 'Quiet' : list.data?.status === 'stale' ? 'Stale' : 'Ready',
        tone: list.loading ? 'checking' : statusTone,
      }}
    >
      <main id="analytics-main" className={`pulse-explorer${broadcastId ? ' pulse-explorer--detail-route' : ''}`} aria-label="Pulse Explorer">
        <span className="sr-only" aria-live="polite" aria-atomic="true">{list.announcement}</span>
        <header className="pulse-explorer__hero">
          <div>
            <span className="pulse-explorer__eyebrow"><Radio aria-hidden="true" />Verified reaction activity</span>
            <h1>Pulse Explorer</h1>
            <p>Find broadcasts with meaningful activity, then inspect how each moment developed and what outside context was matched.</p>
          </div>
          <div className="pulse-explorer__summary" aria-label="Explorer summary">
            <span><strong>{list.data?.summary.broadcastCount ?? '—'}</strong> broadcasts</span>
            <span><strong>{list.data?.summary.momentCount ?? '—'}</strong> moments</span>
            <span><strong>{list.data?.summary.categoryCount ?? '—'}</strong> categories</span>
          </div>
        </header>

        {hasNetworkComparison && network ? (
          <section className="explorer-network" aria-label="Network context">
            <div><span>Network context</span><strong>{network.comparableChannels} comparable channels · {Math.round(network.coveragePct)}% coverage</strong></div>
            {network.chatChangePct != null ? <span><small>Chat</small><strong>{network.chatChangePct >= 0 ? '+' : ''}{Math.round(network.chatChangePct)}%</strong></span> : null}
            {network.emoteChangePct != null ? <span><small>Emotes</small><strong>{network.emoteChangePct >= 0 ? '+' : ''}{Math.round(network.emoteChangePct)}%</strong></span> : null}
          </section>
        ) : null}

        <section className="explorer-controls" aria-label="Explorer filters">
          <form onSubmit={submitSearch}>
            <Search aria-hidden="true" />
            <label className="sr-only" htmlFor="explorer-search">Search channel or category</label>
            <input id="explorer-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search channel or category" />
            <button type="submit">Search</button>
          </form>
          <label><span>Range</span><select aria-label="Range" value={query.window} onChange={(event) => replaceQuery({ window: event.target.value as NewsroomWindow })}>{WINDOWS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Signal</span><select aria-label="Signal" value={query.signal} onChange={(event) => replaceQuery({ signal: event.target.value as ExplorerSignal })}>{SIGNALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Category</span><select aria-label="Category" value={query.category ?? ''} onChange={(event) => replaceQuery({ category: event.target.value || undefined })}><option value="">All categories</option>{list.data?.facets.categories.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></label>
          <label><span>Stream state</span><select aria-label="Stream state" value={query.state} onChange={(event) => replaceQuery({ state: event.target.value as ExplorerState })}>{STATES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Sort</span><select aria-label="Sort" value={query.sort} onChange={(event) => replaceQuery({ sort: event.target.value as ExplorerSort })}>{SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </section>

        {list.data?.status === 'stale' ? <div className="explorer-stale" role="status"><span>{dataAge} Fresh activity could not be reached; valid results remain visible.</span><button type="button" onClick={list.refresh}><RefreshCw aria-hidden="true" />Refresh</button></div> : null}

        <div className={`pulse-explorer__workspace${singleWorkspaceState ? ' pulse-explorer__workspace--single' : ''}`}>
          <section className="explorer-results" aria-labelledby="explorer-results-title">
            <header>
              <div><span>Exact stream sessions</span><h2 id="explorer-results-title">Broadcasts</h2></div>
              <small>{list.refreshing ? 'Refreshing…' : dataAge}</small>
            </header>
            <div className="explorer-results__scroll analytics-scroll-hidden">
              {list.loading && !list.data ? <ExplorerStatePanel kind="loading" /> : null}
              {list.unavailable ? <ExplorerStatePanel kind="unavailable" reason={list.error || list.data?.reason} onRetry={list.refresh} /> : null}
              {list.data?.status === 'empty' ? <ExplorerStatePanel kind="empty" reason={list.data.reason} /> : null}
              {list.data?.broadcasts.map((broadcast) => (
                <BroadcastResult
                  key={broadcast.id}
                  broadcast={broadcast}
                  selected={selectedId === broadcast.id}
                  href={withSearch(`/analytics/explore/${encodeURIComponent(broadcast.id)}`, canonicalParams)}
                />
              ))}
              {list.data?.nextCursor ? <button className="explorer-load-more" type="button" onClick={list.loadMore} disabled={list.loadingMore}>{list.loadingMore ? 'Loading…' : 'Load more broadcasts'}</button> : null}
            </div>
          </section>
          {!singleWorkspaceState ? <aside className="explorer-inspector" aria-label="Selected broadcast inspector" aria-busy={detail.loading || detail.refreshing}>
            <BroadcastInspector
              broadcast={selected}
              moments={moments}
              query={query}
              loading={detail.loading}
              unavailable={detail.unavailable || Boolean(broadcastId && detail.data?.status === 'empty')}
              error={detail.error || detail.data?.reason}
              onRetry={detail.refresh}
              backHref={backHref}
              headingRef={headingRef}
            />
          </aside> : null}
        </div>
      </main>
    </AnalyticsFigmaShell>
  )
}
