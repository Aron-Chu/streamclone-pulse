import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { streamEdgeLabel } from '@streampulse/pulse-core'
import { momentRowClock, momentRowClockText } from '../../../lib/formatStreamOffset'
import { EARLY_STREAM_WORDS, earlyInStream, momentEdge } from '../../../lib/momentsChecked'
import { formatMomentDateTime, formatMomentOccurrence, type LiveWireMomentComparison } from '../../../lib/liveWire'
import { discoveryAnalyticsHref, validVodId, type DiscoveryMoment } from '../../../lib/discoveryMoments'
import { momentComparisonBadge } from '../../../lib/momentComparison'
import { buildVodTimestampUrl } from '../../../lib/figmaSessionAnalytics'
import { isExactCategoryBoxArt } from '../../../lib/momentCategoryArtwork'
import { loadMomentMinuteWindow, peekMomentMinuteWindow, type MomentMinuteWindow } from '../../../lib/momentMinuteWindow'
import { nearbyClipWithin, type NearbyClip } from '../../../lib/momentNearbyClip'
import {
  ACTIVITY_FRAME_FULL,
  ACTIVITY_FRAME_PHOTO,
  ACTIVITY_HEIGHT,
  ACTIVITY_WIDTH,
  momentActivityGeometry,
  momentActivityHeadline,
  momentActivitySeries,
  type ActivityGeometry,
  type ActivitySeries,
} from '../../../lib/momentActivityLine'
import { emoteImageUrlFromIdentity } from '../../../lib/emoteAssetUrl'
import type { ArchiveArtwork } from '../../../lib/archiveArtwork'
import { useAnalyticsMotionEnabled } from '../../motion/motionEnabled'
import { twitchLivePreviewUrl } from '../analytics/hubFormat'
import { EmoteImg } from '../analytics/EmoteImg'
import { GameArt } from '../hub/v5/HubV5Rack'
import { bigLivePicture } from '../hub/v5/hubV5BigMomentsModel'
import { isTwitchOfflinePreview } from '../../../../../packages/analytics-console/src/utils/twitchBoxArt.ts'
import { MomentArchiveArtwork } from './MomentArchiveArtwork'
import { SaveMomentButton } from './SaveMomentButton'
import { useMomentRelativeAge } from './useMomentRelativeAge'
import { momentChatBaseline } from './MomentMinuteChart'
import './moment-stream-cards.css'

/** The replay opens this long before the moment, the extension's clip lead (clipWindow.ts). */
const REPLAY_LEAD_SECONDS = 30
/** The line draws in this long; the moment's dot lands when the line reaches it. */
const DRAW_MS = 900
/** The game's cover beside the text; the blurred wash behind a line reuses the same file. */
const COVER_W = 40
const COVER_H = 53
/** A live picture not proven by then is dropped, and the card draws its line instead. */
const LIVE_CHECK_MS = 3_000

type Activity = { key: string; status: 'waiting' | 'ready' | 'none'; window: MomentMinuteWindow | null }
type Nearby = { key: string; done: boolean; clip: NearbyClip | null }

/**
 * Whether the card has come within a screen of view; once it has, it stays so. A
 * screen ahead, its reads (minutes, a nearby clip, the live check) are usually done
 * by the time it scrolls in, rather than showing it waiting (Aron, 11-22).
 */
function useSeen<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (seen || !element) return
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect() }
    }, { rootMargin: '100% 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])
  return [ref, seen]
}

/**
 * The moment's minutes, read once its card nears the screen: the same bounded,
 * shared read the open moment's chart makes, so opening the card costs nothing
 * more. A failed or empty read leaves the card its emote picture.
 */
function useMomentActivity(moment: DiscoveryMoment, seen: boolean): Activity {
  const key = moment.key
  const [state, setState] = useState<Activity>(() => {
    const cached = peekMomentMinuteWindow(moment)
    return cached ? { key, status: cached.value ? 'ready' : 'none', window: cached.value } : { key, status: 'waiting', window: null }
  })
  useEffect(() => {
    if (!seen) return
    const cached = peekMomentMinuteWindow(moment)
    if (cached) { setState({ key, status: cached.value ? 'ready' : 'none', window: cached.value }); return }
    const controller = new AbortController()
    // No settle wait: that is for a reader stepping through open moments, not a card coming into view.
    void loadMomentMinuteWindow(moment, controller.signal, 0)
      .then(window => { if (!controller.signal.aborted) setState({ key, status: window ? 'ready' : 'none', window }) })
      .catch(() => { if (!controller.signal.aborted) setState({ key, status: 'none', window: null }) })
    return () => controller.abort()
    // The detection's identity is the read's whole input, as in MomentMinuteChart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, key, moment.streamId, moment.offsetSeconds])
  return state.key === key ? state : { key, status: 'waiting', window: null }
}

/** A clip viewers made near the moment, looked up once the card nears the screen; a slow lookup gives up. */
function useNearbyClip(moment: DiscoveryMoment, seen: boolean): Nearby {
  const key = moment.key
  const [state, setState] = useState<Nearby>({ key, done: false, clip: null })
  useEffect(() => {
    if (!seen) return
    let current = true
    // A failed lookup is no clip: the card must still settle and draw its line.
    void nearbyClipWithin(moment).catch(() => null).then(clip => { if (current) setState({ key, done: true, clip }) })
    return () => { current = false }
    // The moment's key, stream and time are the lookup's whole input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, key, moment.login, moment.at])
  return state.key === key ? state : { key, done: false, clip: null }
}

/**
 * Whether a stream's live picture is real: Twitch answers a stream that has ended
 * with its offline picture, not an error, so the card proves it the way the Hub's
 * Busiest row does (isTwitchOfflinePreview). Null while the check runs. A check
 * still running after LIVE_CHECK_MS drops the picture, and a late answer can't
 * bring it back, so the card never swaps its line for a picture after drawing it.
 */
function useLivePictureCheck(url: string | null): [boolean | null, (url: string, ok: boolean) => void] {
  const [result, setResult] = useState<{ url: string; ok: boolean } | null>(null)
  // A late "live" never overturns a "not" for the same picture.
  const settle = useCallback((pic: string, ok: boolean) => setResult(current => current?.url === pic && ok ? current : { url: pic, ok }), [])
  useEffect(() => {
    if (!url) return
    const timer = setTimeout(() => setResult(current => current?.url === url ? current : { url, ok: false }), LIVE_CHECK_MS)
    return () => clearTimeout(timer)
  }, [url])
  return [url && result?.url === url ? result.ok : null, settle]
}

type Emote = NonNullable<DiscoveryMoment['topEmotes']>[number]

/** A figure as the row writes it (MomentRow). */
const present = (value?: number | null) =>
  value != null && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : null
/** Saved records keep no media URL; rebuild one from a provider ID, else the emote is named. */
const emoteSrc = (emote: Emote) => emote.imageUrl ?? emoteImageUrlFromIdentity(emote.provider, emote.id)
/** The emote as a screen reader hears it: its name and uses. */
const emoteSpoken = (emote: Emote) => `${emote.name}${present(emote.count) != null ? `, ${present(emote.count)} uses` : ''}`

/** The rates the row printed, for a screen reader: the card shows them only as its drawing. */
function ratesSpoken(moment: DiscoveryMoment): string {
  const chat = present(moment.chatPerMin)
  const emotes = present(moment.emotesPerMin)
  if (chat == null && emotes == null) return 'Rates unavailable.'
  return `${chat != null ? `${chat} chat/min` : 'Chat rate unavailable'}, ${emotes != null ? `${emotes} emotes/min` : 'emote rate unavailable'}.`
}

/** The stream's earlier average for the series the line draws, when the comparison supplies one. */
function seriesUsual(comparison: LiveWireMomentComparison | undefined, series: ActivitySeries): number | null {
  if (series === 'chat') return momentChatBaseline(comparison)?.baseline ?? null
  const metric = comparison?.emotes
  return metric && ['ready', 'new_activity'].includes(metric.state) && typeof metric.baselinePerMin === 'number'
    && Number.isFinite(metric.baselinePerMin) && metric.baselinePerMin > 0 ? metric.baselinePerMin : null
}

const LINE_KEY: Record<ActivitySeries, string> = {
  chat: 'Line: chat per minute. Bars: emotes per minute. Dashes: this stream’s earlier average.',
  emotes: 'Line: emotes per minute. Bars: chat per minute. Dashes: this stream’s earlier average.',
}

/**
 * Twenty minutes of the stream around the moment, drawn as the card's picture or
 * along its bottom: the stream's usual level dashed, the surge shaded, the other
 * series as bars, and the top emote where the moment lands. It draws itself in
 * once, as it first shows.
 */
function ActivityPicture({ geometry, emote }: { geometry: ActivityGeometry; emote: Emote | undefined }) {
  const at = Math.round(geometry.momentAt * DRAW_MS * 0.8)
  const src = emote ? emoteSrc(emote) : null
  return <div className="msc-activity" style={{ '--msc-at': `${at}ms` } as CSSProperties}>
    <svg viewBox={`0 0 ${ACTIVITY_WIDTH} ${ACTIVITY_HEIGHT}`} aria-hidden="true" focusable="false">
      {geometry.surge ? <rect className="msc-surge" x={geometry.surge.fromX} y={geometry.top - 6} width={geometry.surge.toX - geometry.surge.fromX} height={geometry.floor - geometry.top + 6} /> : null}
      <g className="msc-bars">
        {geometry.bars.map(bar => <rect key={bar.relative} x={bar.x} y={bar.y} width="6" height={bar.height} rx="1.5"
          style={{ '--msc-delay': `${Math.min(400, Math.abs(bar.relative) * 36)}ms` } as CSSProperties} />)}
      </g>
      {geometry.baselineY != null ? <line className="msc-usual" x1="0" x2={ACTIVITY_WIDTH} y1={geometry.baselineY} y2={geometry.baselineY} /> : null}
      <g className="msc-draw">
        <path className="msc-area" d={geometry.area} />
        <path className="msc-line" d={geometry.line} />
      </g>
      {geometry.moment ? <>
        <line className="msc-mark" x1={geometry.moment.x} x2={geometry.moment.x} y1={geometry.top - 10} y2={geometry.floor} />
        <circle className="msc-ping" cx={geometry.moment.x} cy={geometry.moment.y} r="4" />
        <circle className="msc-dot" cx={geometry.moment.x} cy={geometry.moment.y} r="4" />
      </> : null}
    </svg>
    {geometry.moment && emote && src ? <span className="msc-emote" style={{ left: `${geometry.moment.x / ACTIVITY_WIDTH * 100}%`, top: `${geometry.moment.y / ACTIVITY_HEIGHT * 100}%` }}>
      <EmoteImg name={emote.name} src={src} width={32} height={32} hideFallbackText />
    </span> : null}
  </div>
}

/**
 * With no minutes to draw: the moment's emotes, the top one large. As on the row they
 * replace, a screen reader hears each by name and uses, and one with no picture, or
 * whose picture fails, shows its name, not a letter (MOMENTS-PAGE-8).
 */
function EmotePicture({ emotes }: { emotes: readonly Emote[] }) {
  return <div className="msc-emotes" role="list" aria-label="Measured emote reactions">
    {emotes.slice(0, 4).map((emote, index) => {
      const src = emoteSrc(emote)
      const uses = present(emote.count)
      const size = index ? 36 : 60
      return <span role="listitem" key={`${emote.provider}:${emote.name}:${index}`} title={`${emote.name}${uses != null ? ` · ${uses} uses` : ''}`} style={{ '--msc-i': index } as CSSProperties}>
        {src
          ? <EmoteImg name={emote.name} src={src} width={size} height={size} alt={emoteSpoken(emote)} fallbackName fallbackClassName="msc-emote-name" />
          : <span className="msc-emote-name">{emote.name}{uses != null ? <span className="sr-only">{`, ${uses} uses`}</span> : null}</span>}
      </span>
    })}
  </div>
}

/** When the picture is a line or a photo, a screen reader still hears the moment's emotes, as it did on the row. */
function EmoteNames({ emotes }: { emotes: readonly Emote[] }) {
  return <ul className="sr-only" aria-label="Measured emote reactions">
    {emotes.slice(0, 4).map((emote, index) => <li key={`${emote.provider}:${emote.name}:${index}`}>{emoteSpoken(emote)}</li>)}
  </ul>
}

/**
 * One stream on Latest (B, 11-22; A+ and G1 of round 3). The card keeps the result
 * row's hooks the page relies on (`.moments-result`, the primary button and its
 * key), so a press, a click away, Esc and Back behave as they do on a row.
 *
 * The picture is the realest one there is, in this order: a clip viewers made near
 * the moment, then, for a moment under ten minutes old on a live stream, the
 * stream's live picture once it is proven not to be Twitch's offline one (the
 * Hub's rules, HUB-6); either carries the activity line
 * along its bottom. With neither, the line fills the frame over the game's cover,
 * blurred far back. When the minutes can't be read, the moment's emotes stand
 * in over the same cover.
 */
export function MomentStreamCard({ moment, selected, artwork, avatar, creator, detailId, lead = true, live = false, stagger = 0, more, onSelect }: {
  moment: DiscoveryMoment
  selected: boolean
  artwork?: ArchiveArtwork
  /** The channel's picture. */
  avatar: ReactNode
  /** The channel's name, a link to its broadcasts. */
  creator: ReactNode
  /** The id of the open detail, for `aria-controls`. */
  detailId: string
  /** The stream's first card: it alone shows the channel's face and name. */
  lead?: boolean
  /** The moment came from a list of live streams, so a young one may show its live picture. */
  live?: boolean
  /** The card's place in its row, so a row of cards draws in one after another. */
  stagger?: number
  /** The stream's other moments: how many, whether they show, and how to show them. */
  more?: { count: number; expanded: boolean; onToggle: () => void }
  onSelect: (moment: DiscoveryMoment, card: HTMLElement | null) => void
}) {
  const name = moment.displayName || moment.login
  const clock = momentRowClock(moment.offsetSeconds)
  const offset = momentRowClockText(moment.offsetSeconds)
  const occurred = formatMomentDateTime(moment.at)
  const age = useMomentRelativeAge(occurred)
  // The Hub's rules (X1, E1, 11-13): no × in a stream's first 20 minutes, and the edge named.
  const early = earlyInStream(moment.offsetSeconds)
  const edge = momentEdge(moment.offsetSeconds, moment.streamEdge)
  const badge = early ? null : momentComparisonBadge(moment.comparison, moment.reactionSignal)
  // As on the row, a stream's edge is still named after its first 20 minutes, beside a wordless ×.
  const quiet = early ? (edge ? streamEdgeLabel(edge) : EARLY_STREAM_WORDS)
    : [edge ? streamEdgeLabel(edge) : null, badge && !badge.words ? `${badge.label} new` : null].filter(Boolean).join(' · ') || null
  const motion = useAnalyticsMotionEnabled()
  const [pictureRef, seen] = useSeen<HTMLDivElement>()
  const activity = useMomentActivity(moment, seen)
  const nearby = useNearbyClip(moment, seen)
  const [shownAt] = useState(() => Date.now())
  const [clipFailed, setClipFailed] = useState(false)
  const clip = nearby.clip && !clipFailed ? nearby.clip : null
  // Asked only once the clip lookup is done, so a nearby clip never costs a live picture's request.
  const liveCandidate = seen && nearby.done && !clip && live && moment.at != null && bigLivePicture(moment.at, shownAt)
    ? twitchLivePreviewUrl(moment.login, 640, 360) : null
  const [liveProven, settleLive] = useLivePictureCheck(liveCandidate)
  const photo = clip?.thumbnailUrl ?? (liveProven ? liveCandidate : null)
  const badgeSeries = badge?.series
  const overPhoto = photo != null
  const geometry = useMemo(() => {
    if (!activity.window) return null
    const series = momentActivitySeries(activity.window, badgeSeries)
    // Early in a stream its earlier average is too short to judge by (X1): no usual line, no surge.
    const usual = early ? null : seriesUsual(moment.comparison, series)
    return momentActivityGeometry(activity.window, usual, { series, frame: overPhoto ? ACTIVITY_FRAME_PHOTO : ACTIVITY_FRAME_FULL })
  }, [activity.window, badgeSeries, early, moment.comparison, overPhoto])
  // One × on the card, the comparison's; the surge's length only when the line is that series.
  const headline = badge?.words ? momentActivityHeadline(badge.words, geometry?.series === badge.series ? geometry.surge?.minutes : null) : moment.label
  const settled = seen && activity.status !== 'waiting' && nearby.done && (liveCandidate == null || liveProven != null)
  const picture = !settled ? 'waiting' : photo ? 'photo' : geometry ? 'line' : 'emotes'
  const replay = validVodId(moment.vodId) ? buildVodTimestampUrl(moment.vodId, Math.max(0, moment.offsetSeconds - REPLAY_LEAD_SECONDS)) : null
  const coverArt = moment.category ? <GameArt name={moment.category} w={COVER_W} h={COVER_H} streamIds={[moment.streamId]}
    url={moment.categoryId && moment.boxArtUrl && !moment.categoryMetadataRejected && isExactCategoryBoxArt(moment.boxArtUrl, moment.categoryId) ? moment.boxArtUrl : undefined} /> : null
  const emotes = moment.topEmotes?.length ? moment.topEmotes : null
  const source = picture === 'photo' ? (clip ? 'Nearby clip' : 'Live now') : picture === 'emotes' && emotes ? 'Top emotes' : null
  return <article
    className={`moments-result moments-stream-card${selected ? ' is-selected' : ''}`}
    data-arrival-key={moment.key}
    aria-label={`${name} ${moment.label} at ${offset} into broadcast`}
    style={{ '--msc-d': `${stagger * 110}ms` } as CSSProperties}
    onClick={event => {
      // As on a row: the primary button is the keyboard's way in, the card the pointer's.
      if ((event.target as HTMLElement).closest('a, button, input, select, textarea, [role="button"]')) return
      if (window.getSelection()?.toString()) return
      onSelect(moment, event.currentTarget)
    }}
  >
    <div ref={pictureRef} className="msc-picture" data-picture={picture} data-animate={motion ? '' : undefined} title={geometry && (picture === 'line' || picture === 'photo') ? LINE_KEY[geometry.series] : undefined}>
      {/* The cover's wash stays under a photo, so the frame is never blank while the photo loads. */}
      <div className="msc-wash" aria-hidden="true">{artwork ? <MomentArchiveArtwork artwork={artwork} /> : coverArt}</div>
      {/* crossOrigin and referrerPolicy before src: React sets them in this order, and set after it they
          restart the request (the Hub's note). The live picture keeps the probe's CORS mode, so it comes from cache.
          No lazy loading: the card asks for a photo only once it nears the screen. */}
      {picture === 'photo' ? <>
        <img key={photo!} className="msc-photo" alt="" width={480} height={270} decoding="async" crossOrigin={clip ? undefined : 'anonymous'} referrerPolicy="no-referrer"
          src={photo!} onLoad={event => { event.currentTarget.dataset.ready = '' }} onError={() => (clip ? setClipFailed(true) : settleLive(photo!, false))} />
        <div className="msc-scrim" />
      </> : <div className="msc-fade" />}
      {liveCandidate && liveProven == null ? <img className="msc-probe" alt="" width={480} height={270} decoding="async" crossOrigin="anonymous" referrerPolicy="no-referrer"
        src={liveCandidate}
        onLoad={event => { void isTwitchOfflinePreview(event.currentTarget).then(offline => settleLive(liveCandidate, !offline), () => settleLive(liveCandidate, true)) }}
        onError={() => settleLive(liveCandidate, false)} /> : null}
      {(picture === 'photo' || picture === 'line') && geometry ? <ActivityPicture geometry={geometry} emote={moment.topEmotes?.[0]} />
        : picture === 'emotes' && emotes ? <EmotePicture emotes={emotes} /> : null}
      <span className="msc-chips">
        <span className="msc-at">{clock.approximate ? <><span className="msc-about">about</span>{' '}</> : null}{clock.text} in</span>
        {source ? <span className="msc-source">{source}</span> : null}
      </span>
    </div>
    <div className="msc-body">
      <div className="msc-lead" data-cover={coverArt ? '' : undefined}>
        {coverArt ? <span className="msc-cover">{coverArt}</span> : null}
        {lead || !coverArt ? <span className="msc-face">{avatar}</span> : null}
      </div>
      <div className="msc-text">
        <h3 className="msc-title">
          <button
            type="button"
            className="moments-card-primary"
            data-discovery-key={moment.key}
            aria-label={`${headline} — ${selected ? 'Close' : 'Open'} moment for ${name} at ${offset} into broadcast`}
            aria-current={selected ? 'true' : undefined}
            aria-expanded={selected}
            aria-controls={selected ? detailId : undefined}
            onClick={event => onSelect(moment, event.currentTarget.closest('article'))}
          >{headline}</button>
          {quiet ? <span className="msc-figure" title={badge?.long}>{quiet}</span> : null}
        </h3>
        <p className="msc-sub">
          {[lead ? creator : null, moment.category ? <span>{moment.category}</span> : null,
            age && occurred ? <time dateTime={occurred} title={formatMomentOccurrence(occurred)}>{age}<span className="sr-only">, {formatMomentOccurrence(occurred)}</span></time> : null]
            .filter(Boolean).map((part, index) => <Fragment key={index}>{index ? <span aria-hidden="true"> · </span> : null}{part}</Fragment>)}
        </p>
        <p className="sr-only">{ratesSpoken(moment)}{occurred ? '' : ' Occurrence time unavailable.'}</p>
        {emotes && picture !== 'emotes' ? <EmoteNames emotes={emotes} /> : null}
        <div className="msc-actions">
          {replay
            ? <a className="msc-go" href={replay} target="_blank" rel="noopener noreferrer">Open Twitch at {momentRowClock(Math.max(0, moment.offsetSeconds - REPLAY_LEAD_SECONDS)).text} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
            : clip ? <a className="msc-go" href={clip.url} target="_blank" rel="noopener noreferrer">Watch nearby clip <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a> : null}
          <Link className={replay || clip ? 'msc-link' : 'msc-go'} aria-label={`Stream analytics for ${name} ${moment.label} at ${offset}`} to={discoveryAnalyticsHref(moment)}>Analytics</Link>
          {more && more.count > 0 ? <button type="button" className="msc-more" aria-expanded={more.expanded} onClick={more.onToggle}
            aria-label={more.expanded ? `Show fewer from ${name}` : `+${more.count} more from ${name}`}>
            {more.expanded ? 'Show fewer' : `+${more.count} more`}
          </button> : null}
        </div>
      </div>
    </div>
    {/* Last in the card, as on the row, so Tab reaches the moment first; drawn over the picture's corner. */}
    <div className="msc-save"><SaveMomentButton moment={moment} contextLabel={`${name}’s moment at ${offset}`} /></div>
  </article>
}
