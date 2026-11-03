import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Link2 } from 'lucide-react'
import { clipPagePath, clipsNotOn, lookupNativeClips, validClipId, type NativeClip } from '../../lib/nativeClips'
import { cachedClip, clipListKey, clipListQueryFromKey, useClipList, type ClipListQuery } from '../../lib/nativeClipsList'
import { useSavedClips } from '../../lib/savedNativeClips'
import { useTwitchFollows } from '../../lib/twitchFollows'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { ClipCard, type ClipLinkState } from '../../ui/components/clips/NativeClipCard'
import { ClipDescription, ClipPlayer } from '../../ui/components/clips/NativeClipPanel'
import { ClipComments, ReviewSplit, SignInPrompt, useClipFeedback, worthShareText } from '../../ui/components/clips/NativeClipFeedback'
import { ChannelAvatar, GameArt, Notice, SaveClipButton } from '../../ui/components/clips/NativeClipParts'
// A shared link opens this page first: it loads the analytics shell's own styles (header, sr-only).
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/clips/native-clips.css'

const LIBRARY_PATH = '/analytics/moments?view=clips'
const DEFAULT_LIST: ClipListQuery = { period: '7d', sort: 'newest', mix: true }
const UP_NEXT_MAX = 20

type Found = { status: 'loading' } | { status: 'ready'; clip: NativeClip } | { status: 'missing' | 'off' | 'failed' }

/** The clip itself: handed over by the card that opened it, remembered from a list, or read by id. */
function useClip(id: string, handed: NativeClip | undefined, attempt: number): Found {
  const known = handed?.id === id ? handed : cachedClip(id)
  const [found, setFound] = useState<Found>(() => known ? { status: 'ready', clip: known } : validClipId(id) ? { status: 'loading' } : { status: 'missing' })
  useEffect(() => {
    if (found.status === 'ready' || !validClipId(id)) return
    const controller = new AbortController()
    setFound({ status: 'loading' })
    lookupNativeClips([id], controller.signal).then(
      clips => { if (!controller.signal.aborted) setFound(clips[0] ? { status: 'ready', clip: clips[0] } : { status: 'missing' }) },
      error => { if (!controller.signal.aborted) setFound({ status: clipsNotOn(error) ? 'off' : 'failed' }) },
    )
    return () => controller.abort()
    // Read once per clip and per Try again; a clip already shown is not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt])
  return found
}

/** Saved clips, read by id in the order they were saved, for Up next after a clip opened from Saved. */
function useSavedList(enabled: boolean) {
  const saved = useSavedClips()
  const ids = enabled ? saved.items.map(item => item.id).join(',') : ''
  const [clips, setClips] = useState<NativeClip[] | null>(null)
  useEffect(() => {
    if (!ids) return
    const controller = new AbortController()
    lookupNativeClips(ids.split(','), controller.signal).then(
      found => { if (!controller.signal.aborted) setClips(found) },
      () => { if (!controller.signal.aborted) setClips([]) },
    )
    return () => controller.abort()
  }, [ids])
  return ids ? clips : []
}

type UpNextTab = 'next' | 'channel' | 'game'

/**
 * Up next: the rest of the list the clip was opened from (the newest clips
 * when it was opened from a link), or more from its channel or its game.
 */
function UpNext({ clip, from }: { clip: NativeClip; from: string | undefined }) {
  const [tab, setTab] = useState<UpNextTab>('next')
  const follows = useTwitchFollows()
  const fromSaved = from === 'saved'
  const fromFollows = !!from?.endsWith('#follows')
  const fromQuery = from && !fromSaved ? clipListQueryFromKey(from.replace(/#follows$/, '')) : null
  const query: ClipListQuery = tab === 'channel' ? { period: '30d', sort: 'newest', channel: clip.channel.login, mix: false }
    : tab === 'game' && clip.game ? { period: '30d', sort: 'newest', game: clip.game.id, mix: true }
      : fromQuery ?? DEFAULT_LIST
  const listOn = tab !== 'next' || !fromSaved
  const list = useClipList(query, listOn, 0)
  const savedList = useSavedList(fromSaved && tab === 'next')

  let items: NativeClip[] | null
  if (tab === 'next' && fromSaved) items = savedList
  else if (list.error) items = []
  else items = list.current && list.page ? list.items : null
  if (items && tab === 'next' && fromFollows && follows.status === 'ready') {
    const followed = new Set(follows.follows.logins)
    items = items.filter(item => followed.has(item.channel.login))
  }
  // Carry on after this clip; a clip opened from elsewhere starts at the top.
  let rows = items ?? []
  const at = rows.findIndex(item => item.id === clip.id)
  rows = (at >= 0 ? [...rows.slice(at + 1), ...rows.slice(0, at)] : rows).slice(0, UP_NEXT_MAX)
  const rowsFrom = tab === 'next' ? from ?? clipListKey(DEFAULT_LIST) : clipListKey(query)
  const canMore = listOn && !list.error && list.page?.nextCursor && list.current && rows.length < UP_NEXT_MAX

  const chip = (value: UpNextTab, label: ReactNode) => (
    <button type="button" className="nc-chip" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>
  )
  return (
    <aside className="nc-upnext" aria-labelledby="nc-upnext-title">
      <h2 id="nc-upnext-title" className="nc-section-title">Up next</h2>
      <div className="nc-chips" role="group" aria-label="Up next from">
        {chip('next', fromSaved ? 'Saved' : fromFollows ? 'Your follows' : fromQuery ? 'Your list' : 'Newest')}
        {chip('channel', <>From {clip.channel.displayName}</>)}
        {clip.game ? chip('game', <><GameArt game={clip.game} size="xs" />{clip.game.name}</>) : null}
      </div>
      {items === null ? (
        <div className="nc-rows" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="nc-skel nc-skel-row"><span /><span /></div>)}</div>
      ) : list.error && listOn && !(tab === 'next' && fromSaved) ? (
        <p className="nc-muted" role="status">{list.error === 'off' ? 'Clips aren’t switched on yet.' : 'More clips didn’t load.'}</p>
      ) : !rows.length ? (
        <p className="nc-muted" role="status">{tab === 'channel' ? `No other clips from ${clip.channel.displayName} in the last 30 days.` : tab === 'game' ? 'No other clips from this game in the last 30 days.' : 'Nothing else in this list.'}</p>
      ) : (
        <div className="nc-rows" role="list" aria-label="Up next">
          {rows.map(item => <ClipCard key={item.id} clip={item} from={rowsFrom} variant="row" />)}
        </div>
      )}
      {canMore ? <button type="button" className="nc-btn nc-upnext-more" disabled={list.more === 'loading'} onClick={list.loadMore}>{list.more === 'loading' ? 'Loading…' : 'Show more'}</button> : null}
    </aside>
  )
}

function ShareButton({ clip, onStatus }: { clip: NativeClip; onStatus: (message: string) => void }) {
  return (
    <button type="button" className="nc-btn nc-pill" onClick={() => {
      const url = new URL(clipPagePath(clip.id), window.location.origin).toString()
      const copied = navigator.clipboard?.writeText(url)
      if (!copied) { onStatus('Copy didn’t work here. The link is in the address bar.'); return }
      copied.then(() => onStatus('Link copied.'), () => onStatus('Copy didn’t work here. The link is in the address bar.'))
    }}>
      <Link2 size={16} aria-hidden="true" />
      Share
    </button>
  )
}

function ClipWatch({ id }: { id: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const handed = (location.state ?? {}) as ClipLinkState
  const [attempt, setAttempt] = useState(0)
  const found = useClip(id, handed.clip, attempt)
  const [status, setStatus] = useState('')
  const clip = found.status === 'ready' ? found.clip : null
  const reviews = useClipFeedback(id)
  const feedback = reviews.state.status === 'ready' ? reviews.state.feedback : null
  const [askSignIn, setAskSignIn] = useState(false)

  useEffect(() => {
    if (clip) document.title = `${clip.title} — ${clip.channel.displayName} — StreamPulse`
  }, [clip])

  const back = handed.from != null ? (
    <button type="button" className="nc-btn nc-back" onClick={() => navigate(-1)}>
      <ArrowLeft size={16} aria-hidden="true" />
      Back
    </button>
  ) : (
    <Link className="nc-btn nc-back" to={LIBRARY_PATH}>
      <ArrowLeft size={16} aria-hidden="true" />
      All clips
    </Link>
  )

  let body
  if (found.status === 'loading') {
    body = <div className="nc-watch-grid" aria-busy="true"><div className="nc-watch-main"><div className="nc-player nc-skel-player" /><p className="sr-only" role="status">Loading the clip…</p></div></div>
  } else if (found.status === 'off') {
    body = <Notice title="Clips aren’t switched on yet" body="The clip library isn’t available here yet. Moments still lists every chat peak." action={<Link className="nc-btn" to="/analytics/moments">Open Moments</Link>} />
  } else if (found.status === 'failed') {
    body = <Notice alert title="The clip didn’t load." body="The clip list didn’t answer." action={<button type="button" className="nc-btn" onClick={() => setAttempt(n => n + 1)}>Try again</button>} />
  } else if (!clip) {
    body = <Notice title="This clip isn’t in the library" body="It may have been removed, or the link may be wrong." action={<Link className="nc-btn" to={LIBRARY_PATH}>See all clips</Link>} />
  } else {
    const c = clip
    body = (
      <div className="nc-watch-grid">
        <div className="nc-watch-main">
          <ClipPlayer key={c.id} clip={c} />
          <h1 className="nc-watch-title">{c.title}</h1>
          <div className="nc-watch-row">
            <div className="nc-watch-channel">
              <ChannelAvatar channel={c.channel} size={40} />
              <span className="nc-watch-channel-text">
                <Link className="nc-strong nc-link-quiet" to={`/analytics/${encodeURIComponent(c.channel.login)}`}>{c.channel.displayName}</Link>
                {c.game ? <span className="nc-muted">{c.game.name}</span> : null}
              </span>
              {c.available ? (
                <a className="nc-btn nc-pill nc-pill-light" href={c.url} target="_blank" rel="noopener noreferrer">
                  Watch on Twitch
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <div className="nc-watch-actions">
              {feedback ? <ReviewSplit feedback={feedback} onChange={reviews.set} onNeedSignIn={() => setAskSignIn(true)} onStatus={setStatus} /> : null}
              <ShareButton clip={c} onStatus={setStatus} />
              <span className="nc-pill-wrap"><SaveClipButton clip={c} onStatus={setStatus} /></span>
            </div>
          </div>
          {askSignIn && feedback && !feedback.you.canWrite ? <SignInPrompt clipId={id} signedIn={feedback.you.signedIn} canWrite={feedback.you.canWrite} /> : null}
          <ClipDescription clip={c} worthShare={worthShareText(feedback)} />
          {feedback ? (
            <ClipComments feedback={feedback} onNeedSignIn={() => setAskSignIn(true)} onStatus={setStatus}
              onTotal={delta => reviews.set({ ...feedback, comments: { total: Math.max(0, feedback.comments.total + delta) } })} />
          ) : reviews.state.status === 'failed' ? (
            <p className="nc-muted nc-comments" role="status">Reviews and comments didn’t load. <button type="button" className="nc-link" onClick={reviews.reread}>Try again</button></p>
          ) : null}
        </div>
        <UpNext key={c.id} clip={c} from={handed.from} />
      </div>
    )
  }

  return (
    <AnalyticsFigmaShell hideSidebar>
      <main id="analytics-main" className="nc-library nc-watch" tabIndex={-1}>
        <div className="nc-watch-top">{back}</div>
        <p className="sr-only" role="status" aria-live="polite">{status}</p>
        {body}
      </main>
    </AnalyticsFigmaShell>
  )
}

/** A clip's own page at /analytics/clips/:clipId. A new clip starts fresh: its player unloaded, Up next on the list. */
export default function NativeClipWatchPage() {
  const { clipId = '' } = useParams()
  return <ClipWatch key={clipId} id={clipId} />
}
