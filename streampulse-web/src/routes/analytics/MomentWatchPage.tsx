import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAfterIdle } from '@streampulse/analytics-console/moment-previews'
import {
  loadMomentFeedback, momentAtKey, momentPagePath, MomentFeedbackError, parseMomentAtKey,
  type MomentFacts, type MomentFeedback,
} from '../../lib/momentFeedback'
import { loadMomentFacts } from '../../lib/momentFacts'
import { fromHubMoment, momentSourceFromAnswer, type CheckedMomentSource, type DiscoveryMoment } from '../../lib/discoveryMoments'
import { momentRecapLists } from '../../lib/discoveryMomentRecap'
import { forgetFailedMomentReads, isMomentStreamId, loadMomentRecap, loadMomentStream, untilStopped } from '../../lib/momentReads'
import { loadCategorySegments, momentGameArtAt, type CategorySegment } from '../../lib/momentCategoryArtwork'
import { lookupTwitchProfile } from '../../lib/channelLookup'
import { loadMomentsFeedItem } from '../../lib/momentsFeed'
import { momentsFeedEnabled } from '../../lib/momentsFeedFlag'
import { handedMoment, momentFeedbackEnabled } from '../../lib/momentPageFlag'
import { clampToSpan, commentSpan, momentNow } from '../../lib/momentCommentSpan'
import { buildVodTimestampUrl } from '../../lib/figmaSessionAnalytics'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { Notice } from '../../ui/components/clips/NativeClipParts'
import { SignInPrompt } from '../../ui/components/clips/NativeClipFeedback'
import { useDiscoveryMomentPreview, type MomentPreviewTiming } from '../../ui/components/moments/MomentPreview'
import { MomentWatchHead, MomentWatchHeadPlaceholder, momentHeadline } from '../../ui/components/moments/watch/MomentWatchHead'
import { MomentStrip, MomentStripPlaceholder } from '../../ui/components/moments/watch/MomentStrip'
import { MomentComments } from '../../ui/components/moments/watch/MomentComments'
import { RealMomentRating } from '../../ui/components/moments/watch/RealMomentRating'
import { MomentClipRow } from '../../ui/components/moments/watch/MomentClipRow'
import { MomentUpNext, type UpNextPictures } from '../../ui/components/moments/watch/MomentUpNext'
import { formatStreamOffset } from '../../lib/formatStreamOffset'
// A shared link opens this page first: it loads the analytics shell's own styles (header, sr-only).
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/clips/native-clips.css'
import '../../ui/components/moments/watch/moment-watch.css'

const LIST_PATH = '/analytics/moments'

/** `feedback` is the ratings-and-comments answer when this build reads one and it came; else the page is read-only. */
type Found = { status: 'loading' } | { status: 'ready'; facts: MomentFacts; feedback: MomentFeedback | null } | { status: 'missing' | 'failed' }
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }
const settle = <T,>(read: Promise<T>): Promise<Settled<T>> => read.then(value => ({ ok: true, value }), error => ({ ok: false, error }))

const validAddress = (streamId: string, momentAt: string) => isMomentStreamId(streamId) && parseMomentAtKey(momentAt) !== null
/** The facts read's refusals that mean "no such Moment" (momentFacts.ts). */
const notHere = (error: unknown) => error instanceof MomentFeedbackError
  && ((error.status === 404 && error.code === 'stream_not_found') || (error.status === 400 && (error.code === 'invalid_moment' || error.code === 'invalid_stream')))

/**
 * The Moment, read once per address and per Try again: its public facts (the stream route, shared
 * with the rest of the page) and, only in a build with ratings and comments, its feedback. A feedback
 * answer is the whole Moment and wins; without one (switched off, a 404 while the routes are off, or
 * any failure) the page is read-only on the facts, and "missing" and "failed" are the facts read's.
 * An alias answers the feedback read with the canonical stream id: the address is replaced with it
 * and nothing is read a second time.
 */
function useMomentRead(streamId: string, momentAt: string, attempt: number, onAlias: (canonicalStreamId: string) => void): Found {
  const navigate = useNavigate()
  const location = useLocation()
  const [found, setFound] = useState<Found>(() => validAddress(streamId, momentAt) ? { status: 'loading' } : { status: 'missing' })
  const held = useRef<MomentFeedback | null>(null)
  useEffect(() => {
    if (!validAddress(streamId, momentAt)) { held.current = null; setFound({ status: 'missing' }); return }
    const have = held.current
    if (have && have.streamId === streamId && momentAtKey(Date.parse(have.momentAt)) === momentAt) return
    const controller = new AbortController()
    held.current = null
    setFound({ status: 'loading' })
    // The recap is asked for beside the facts (shared and kept), so the page's recap check and Up next find
    // it held. A failed read is kept a few seconds, so they show it without asking again; Try again forgets it.
    loadMomentRecap(streamId).catch(() => {})
    const facts = settle(loadMomentFacts(streamId, momentAt, controller.signal))
    // Ratings and comments are their own switch: switched off, /v1/account/streams/... is never asked.
    const feedback = momentFeedbackEnabled() ? settle(loadMomentFeedback(streamId, momentAt, controller.signal)) : Promise.resolve(null)
    // Both settle before the page shows, so the rating row, the comments and a clip never arrive after it.
    void Promise.all([facts, feedback]).then(([read, overlay]) => {
      if (controller.signal.aborted) return
      if (overlay?.ok) {
        held.current = overlay.value
        setFound({ status: 'ready', facts: overlay.value, feedback: overlay.value })
        if (overlay.value.streamId !== streamId) onAlias(overlay.value.streamId)
        if (overlay.value.streamId !== streamId) navigate(momentPagePath(overlay.value.streamId, momentAt), { replace: true, state: location.state })
        return
      }
      if (read.ok) setFound({ status: 'ready', facts: read.value, feedback: null })
      else setFound({ status: notHere(read.error) ? 'missing' : 'failed' })
    })
    return () => controller.abort()
    // Read per address and per Try again; navigate and the location state change with the replace above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, momentAt, attempt])
  return found
}

interface Around {
  offsetSeconds: number
  source: CheckedMomentSource | null
  /** True once neither the feed nor the recap lists this minute any more. */
  dropped: boolean
}

/**
 * The stream's game segments, for the pictures' last fallback (game art: the game at each Moment's
 * minute, Twitch's own cover). Read only once `streamId` is given (the page is idle), shared and kept
 * with the other game covers; null until they come, empty when the read failed.
 */
function useGameSegments(streamId: string | null): readonly CategorySegment[] | null {
  const [games, setGames] = useState<{ streamId: string; segments: CategorySegment[] } | null>(null)
  useEffect(() => {
    if (!streamId) return
    let alive = true
    void loadCategorySegments(streamId).then(segments => { if (alive) setGames({ streamId, segments }) })
    return () => { alive = false }
  }, [streamId])
  return games && games.streamId === streamId ? games.segments : null
}

/**
 * The channel's Twitch picture, once `enabled` (the page is idle and has none): the profile read the
 * stream page uses, kept five minutes. Empty until it comes, and when Twitch has none.
 */
function useChannelPicture(login: string | null, enabled: boolean): string {
  const [found, setFound] = useState<{ login: string; avatar: string } | null>(null)
  useEffect(() => {
    if (!enabled || !login) return
    let alive = true
    void lookupTwitchProfile(login).then(answer => {
      if (alive && answer.state === 'found' && answer.profile.avatar) setFound({ login, avatar: answer.profile.avatar })
    })
    return () => { alive = false }
  }, [login, enabled])
  return found && found.login === login ? found.avatar : ''
}

/**
 * What the existing loaders know about this minute: the Twitch link and the
 * stream picture, and whether the feed (while live) or the recap (after) still
 * lists it. The stream answer is the one the facts read (shared, read once).
 * A failed read leaves that part out; it never fails the page.
 */
function useAround(facts: MomentFacts | null): Around | null {
  const [around, setAround] = useState<Around | null>(null)
  const key = facts ? `${facts.streamId}/${facts.momentAt}` : ''
  useEffect(() => {
    setAround(null)
    if (!facts) return
    const startedMs = Date.parse(facts.stream.startedAt)
    const minuteKey = momentAtKey(Date.parse(facts.momentAt))
    // The backend keys a Moment by the offset from the stream's precise start; the answer's
    // startedAt is whole-second, so this offset is the true one or one more.
    const o = Math.max(0, Math.floor((Date.parse(facts.momentAt) - startedMs) / 1000))
    const at = (offsetSeconds: number): DiscoveryMoment | null => fromHubMoment({
      login: facts.stream.login, streamId: facts.streamId, offsetSeconds, label: 'Measured reaction',
    })
    const live = facts.stream.endedAt === null
    /**
     * True when the feed (while live) or the recap (after) lists this minute at that offset, false when
     * a well-formed answer does not. Throws when it cannot tell: the live feed is off, or an answer was
     * malformed or did not come. Unknown is never "dropped".
     */
    const listedAt = async (offsetSeconds: number): Promise<boolean> => {
      const moment = at(offsetSeconds)
      if (!moment) return false
      if (live) {
        if (!momentsFeedEnabled()) throw new Error('the live feed is off')
        const item = await loadMomentsFeedItem(`pulse-${moment.login}-${moment.streamId}-${offsetSeconds}`, controller.signal)
        return item !== null && momentAtKey(item.minuteStart) === minuteKey
      }
      return momentRecapLists(moment, controller.signal)
    }
    const controller = new AbortController()
    ;(async () => {
      let offsetSeconds = o
      let dropped = false
      try {
        if (!(await listedAt(o))) {
          if (o > 0 && await listedAt(o - 1)) offsetSeconds = o - 1
          else dropped = true
        }
      } catch { /* A failed read leaves the note out. */ }
      const moment = at(offsetSeconds)
      let source: CheckedMomentSource | null = null
      if (moment) {
        try {
          const data = await untilStopped(() => loadMomentStream(moment.streamId), controller.signal)
          source = momentSourceFromAnswer(moment, data)
        } catch { /* No Twitch link and no stream picture. */ }
      }
      if (!controller.signal.aborted) setAround({ offsetSeconds, source, dropped })
    })()
    return () => controller.abort()
    // One read per Moment; the facts object itself is replaced by later pieces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return around
}

/** The Twitch link for the point `at` seconds into the stream, from the minute's confirmed VOD link, or null. */
function twitchLinkAt(source: CheckedMomentSource | null, offsetSeconds: number, atSeconds: number): string | null {
  if (!source) return null
  const vod = source.vodHref ? /\/videos\/(\d{1,30})/.exec(source.vodHref) : null
  if (vod && source.vodOffsetSeconds !== undefined) return buildVodTimestampUrl(vod[1], source.vodOffsetSeconds + (atSeconds - offsetSeconds))
  // No timestamped VOD link: no link at all. The bare channel is never offered as "from {at}".
  return null
}

/** No Moment yet: the picture hook still runs, asking for nothing. */
const NO_MOMENT: DiscoveryMoment = { key: '', login: '', streamId: '', offsetSeconds: 0, label: '', provenance: 'hub' }

function MomentWatch({ streamId, momentAt, onAlias }: { streamId: string; momentAt: string; onAlias: (canonicalStreamId: string) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const from = ((location.state ?? {}) as { from?: unknown }).from
  const fromList = from != null
  // The list, Up next or the stream page handed this Moment over: its head paints before the read.
  const handed = useMemo(() => handedMoment(location.state, streamId, momentAt), [location.state, streamId, momentAt])
  const [attempt, setAttempt] = useState(0)
  const found = useMomentRead(streamId, momentAt, attempt, onAlias)
  const canonical = found.status === 'ready' ? found.feedback : null
  // A rating answer replaces what is shown until the next read: it is tied to the canonical object, so a fresh read (another visit, Try again) resets it.
  const [override, setOverride] = useState<{ base: MomentFeedback; feedback: MomentFeedback } | null>(null)
  const feedback = canonical && override?.base === canonical ? override.feedback : canonical
  // What the page shows: the feedback answer when there is one, else the read-only facts.
  const shown: MomentFacts | null = feedback ?? (found.status === 'ready' ? found.facts : null)
  // The sign-in ask: shown after a press that needs it; 'link' is the Twitch-link variant.
  const [ask, setAsk] = useState<{ base: MomentFeedback; kind: 'sign-in' | 'link' } | null>(null)
  const around = useAround(shown)
  // The loaded comments' times, for the strip's pins; the thread reports them.
  const [pins, setPins] = useState<number[]>([])
  // Action results for later pieces (rating, comments) are announced here.
  const [status, setStatus] = useState('')

  // The minute's offset: the checked one, else the handed one when it is the same minute (o or o-1), else o.
  const computedOffset = shown ? Math.max(0, Math.floor((Date.parse(shown.momentAt) - Date.parse(shown.stream.startedAt)) / 1000)) : null
  const handedOffset = handed && (computedOffset === null || handed.offsetSeconds === computedOffset || handed.offsetSeconds === computedOffset - 1)
    ? handed.offsetSeconds : null
  const offsetSeconds = around?.offsetSeconds ?? handedOffset ?? computedOffset ?? 0
  // Only a link that called this minute one of the stream's top Moments is told it no longer is one: the
  // list or Up next with the Moment it handed over, or the hub. From the stream page, or a bare address, the
  // minute was never claimed, so the page says nothing about it.
  const claimedTop = from === 'hub' || ((from === 'moments' || from === 'moment') && handedOffset !== null)
  const clip = feedback?.clips[0] ?? null
  // `at` is the second the page points Twitch at; it starts at, and resets to, the Moment's minute start.
  const minuteStartMs = shown ? Date.parse(shown.momentAt) : 0
  const startedMs = shown ? Date.parse(shown.stream.startedAt) : 0
  const live = shown ? shown.stream.endedAt === null && !shown.hidden : false
  // While live, the span's end is "now": read again every few seconds. A post clamps again with the clock at that moment.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setTick(n => n + 1), 5000)
    return () => clearInterval(timer)
  }, [live])
  const span = shown ? commentSpan(shown, momentNow()) : { from: 0, to: 0 }
  const clampAt = (ms: number) => shown ? clampToSpan(ms, commentSpan(shown, momentNow())) : ms
  const momentKey = shown ? `${shown.streamId}/${shown.momentAt}` : ''
  // A pick belongs to one read of one Moment (the canonical object), so a fresh read starts at the minute start.
  const [pick, setPick] = useState<{ base: MomentFeedback; ms: number } | null>(null)
  const atMs = clampToSpan(pick && pick.base === canonical ? pick.ms : minuteStartMs, span)
  // Seconds into the stream. The first minute of a stream that began mid-minute counts from the start itself (never before 0:00).
  const secondsIn = (ms: number) => offsetSeconds === 0 ? Math.max(0, (ms - startedMs) / 1000) : offsetSeconds + (ms - minuteStartMs) / 1000
  const atSeconds = Math.round(secondsIn(atMs))
  const stripLabel = (ms: number) => formatStreamOffset(secondsIn(ms))
  const pickAt = (ms: number) => setPick({ base: canonical!, ms: clampAt(ms) })
  // The picture (P1) waits for an idle moment once the page has its facts, so it never holds up the first view.
  const idle = useAfterIdle(around !== null)
  // The channel as the facts name it; a handed picture of the same channel stands in for the one the stream
  // route lacks. Without one (a cold link) the letter paints first, and the channel's Twitch picture fills it once idle.
  const givenPicture = shown ? shown.stream.profileImageUrl || (handed?.login === shown.stream.login ? handed.profileImageUrl ?? '' : '') : ''
  const channelPicture = useChannelPicture(shown?.stream.login ?? null, idle && givenPicture === '')
  const headStream = shown ? { ...shown.stream, profileImageUrl: givenPicture || channelPicture } : null
  const stripMoment = useMemo(() => shown && around ? fromHubMoment({
    login: shown.stream.login, streamId: shown.streamId, offsetSeconds: around.offsetSeconds, label: 'Measured reaction',
    displayName: shown.stream.displayName || undefined, category: shown.stream.category || undefined, profileImageUrl: headStream?.profileImageUrl || undefined,
  }) : null, [shown, around, headStream?.profileImageUrl])
  const channelName = shown ? shown.stream.displayName || shown.stream.login : ''

  // A window clip is the picture itself: then nothing more is asked.
  const source = around?.source ?? null
  const timing = useMemo<MomentPreviewTiming | null>(() => around ? {
    vodId: source?.vodId ?? null, vodAlignSeconds: source?.vodAlignSeconds ?? null,
    atMs: source?.occurrenceAt ?? minuteStartMs, artwork: source?.archiveArtwork ?? null,
  } : null, [around, source, minuteStartMs])
  // A Moment its channel hid shows no picture; its Up next rows ask for no pictures (they keep the stream's VOD thumbnail).
  const hidden = shown?.hidden ?? false
  // Game art is the game the stream was on at the Moment's minute, from the stream's game segments.
  const games = useGameSegments(idle && stripMoment && !hidden ? stripMoment.streamId : null)
  const gameArt = games && around ? momentGameArtAt(games, around.offsetSeconds, 285, 380) : null
  const picture = useDiscoveryMomentPreview(stripMoment ?? NO_MOMENT, {
    enabled: idle && stripMoment !== null && clip === null && !hidden, timing, broadcast: source?.archiveArtwork ?? null,
    gameArt: gameArt?.url ?? null, gameName: gameArt?.gameName ?? null,
  })
  // While the game segments are on their way, "no picture" is not decided yet: game art may still come.
  const headPicture = games === null && picture.preview.kind === 'none' ? { ...picture, loading: true } : picture
  const upNextPictures = useMemo<UpNextPictures | null>(() => idle && around && !hidden ? {
    vodId: source?.vodId ?? null, vodAlignSeconds: source?.vodAlignSeconds ?? null, games,
  } : null, [idle, around, source, hidden, games])

  useEffect(() => {
    if (shown) document.title = `${momentHeadline(clip, offsetSeconds)} — ${channelName} — StreamPulse`
  }, [shown, clip, offsetSeconds, channelName])

  const back = fromList ? (
    <button type="button" className="nc-btn nc-back" onClick={() => navigate(-1)}>
      <ArrowLeft size={16} aria-hidden="true" />
      Back
    </button>
  ) : (
    <Link className="nc-btn nc-back" to={LIST_PATH}>
      <ArrowLeft size={16} aria-hidden="true" />
      All Moments
    </Link>
  )

  let body
  // The page shows once the Moment is read and the recap check has settled, so the "no longer among" note,
  // the Watch pill and the strip's chart are there from its first paint and nothing moves in after it.
  // Until then it keeps the page's shape: the handed Moment's head (or placeholders when nothing was
  // handed over), the strip's box and Up next's rows.
  if (found.status === 'loading' || (found.status === 'ready' && around === null)) {
    body = (
      <div className="nc-watch-grid" aria-busy="true">
        <div className="nc-watch-main">
          {handed ? (
            <MomentWatchHead stream={{ login: handed.login, displayName: handed.displayName ?? handed.login, profileImageUrl: handed.profileImageUrl ?? '', category: handed.category ?? '' }}
              clip={null} clipsChecked={false} offsetSeconds={handed.offsetSeconds} atSeconds={handed.offsetSeconds}
              twitchHref={null} artwork={null} picture={null} pending />
          ) : <MomentWatchHeadPlaceholder />}
          <p className="sr-only" role="status">Loading the Moment…</p>
          <div className="mw-slot"><MomentStripPlaceholder pickable={momentFeedbackEnabled()} /></div>
        </div>
        <aside className="nc-upnext" aria-labelledby="mw-upnext-title">
          <h2 id="mw-upnext-title" className="nc-section-title">More Moments from this stream</h2>
          <MomentUpNext moment={null} streamStartedAtMs={0} live={false} artwork={null} />
        </aside>
      </div>
    )
  } else if (found.status === 'failed') {
    body = <Notice alert title="The Moment didn’t load." body="The page didn’t get an answer." action={<button type="button" className="nc-btn" onClick={() => { forgetFailedMomentReads(streamId); setAttempt(n => n + 1) }}>Try again</button>} />
  } else if (found.status === 'missing' || !shown || !headStream) {
    body = <Notice title="This Moment isn’t here" body="The link may be wrong, or the stream may be gone." action={<Link className="nc-btn" to={LIST_PATH}>Open Moments</Link>} />
  } else {
    const twitchHref = twitchLinkAt(source, offsetSeconds, atSeconds)
    body = (
      <>
        {around?.dropped && claimedTop && !shown.hidden ? (
          <p className="mw-dropped" role="note">
            This minute is no longer among {channelName}’s top Moments.{feedback ? ' Its ratings and comments stay here.' : null}
          </p>
        ) : null}
        <div className="nc-watch-grid">
          <div className="nc-watch-main">
            <MomentWatchHead stream={headStream} clip={clip} clipsChecked={feedback !== null} offsetSeconds={offsetSeconds} atSeconds={atSeconds}
              twitchHref={twitchHref} artwork={hidden ? null : source?.archiveArtwork ?? null} picture={idle && !hidden ? headPicture : null} />
            {shown.hidden ? null : (
              <>
                {/* The minutes strip, then (with ratings and comments) the rating row with the clip rows, and the comments thread. */}
                <div className="mw-slot" data-slot="strip">
                  <MomentStrip window={span}
                    minuteStart={minuteStartMs} clips={shown.clips} pins={feedback ? pins : []} at={atMs} onAt={pickAt}
                    signedIn={feedback?.you.signedIn ?? false} label={stripLabel} moment={stripMoment} pickable={feedback !== null} />
                </div>
                {feedback ? (
                  <>
                    <div className="mw-slot" data-slot="rating-row">
                      <RealMomentRating feedback={feedback} onStatus={setStatus}
                        onChange={next => setOverride({ base: canonical!, feedback: next })}
                        onNeedSignIn={needsLink => setAsk({ base: canonical!, kind: needsLink ? 'link' : 'sign-in' })} />
                      {feedback.clips.map(c => <MomentClipRow key={c.id} clip={c} label={stripLabel} />)}
                      {ask?.base === canonical ? (
                        <SignInPrompt returnTo={momentPagePath(feedback.streamId, momentAtKey(minuteStartMs))}
                          signedIn={ask.kind === 'link'} canWrite={false}
                          signedOutText="Sign in with Twitch to rate or comment." linkText="Link your Twitch account to rate or comment." />
                      ) : null}
                    </div>
                    <div className="mw-slot" data-slot="comments">
                      <MomentComments key={momentKey} streamId={feedback.streamId} window={feedback.window} at={atMs} clampAt={clampAt}
                        onAt={pickAt} feedback={feedback}
                        returnTo={momentPagePath(feedback.streamId, momentAtKey(minuteStartMs))} label={stripLabel} onPins={setPins}
                        onTotal={total => setOverride({ base: canonical!, feedback: { ...feedback, comments: { total } } })}
                        onNeedSignIn={needsLink => setAsk({ base: canonical!, kind: needsLink ? 'link' : 'sign-in' })}
                        onStatus={setStatus} />
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
          <aside className="nc-upnext" aria-labelledby="mw-upnext-title">
            <h2 id="mw-upnext-title" className="nc-section-title">More Moments from this stream</h2>
            <MomentUpNext moment={stripMoment} streamStartedAtMs={startedMs}
              live={shown.stream.endedAt === null} artwork={source?.archiveArtwork ?? null} pictures={upNextPictures}
              holdReads={picture.loading} />
          </aside>
        </div>
      </>
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

/** A Moment's own page at /analytics/moments/:streamId/:momentAt. */
export default function MomentWatchPage() {
  const { streamId = '', momentAt = '' } = useParams()
  // Keyed on the address, so following a link never renders the previous Moment for a render.
  // An alias answered with the canonical stream id keeps the address it was opened at as its key:
  // the replace to the canonical path must not remount the page and read the Moment a second time.
  const [alias, setAlias] = useState<{ from: string; to: string; momentAt: string } | null>(null)
  const key = alias && alias.to === streamId && alias.momentAt === momentAt ? `${alias.from}/${momentAt}` : `${streamId}/${momentAt}`
  return <MomentWatch key={key} streamId={streamId} momentAt={momentAt} onAlias={to => setAlias({ from: streamId, to, momentAt })} />
}
