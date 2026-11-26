import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNearScreen } from '@streampulse/analytics-console/moment-previews'
import type { ArchiveArtwork } from '../../../../lib/archiveArtwork'
import type { DiscoveryMoment } from '../../../../lib/discoveryMoments'
import { formatStreamOffset } from '../../../../lib/formatStreamOffset'
import { momentGameArtAt, type CategorySegment } from '../../../../lib/momentCategoryArtwork'
import { momentAtKey, momentMinuteAt, momentPagePath, type MomentAtKey } from '../../../../lib/momentFeedback'
import { loadMomentRecap, untilStopped } from '../../../../lib/momentReads'
import { loadMomentsFeed } from '../../../../lib/momentsFeed'
import { momentsFeedEnabled } from '../../../../lib/momentsFeedFlag'
import { handOverMoment, momentPageWarmth } from '../../../../lib/momentPageFlag'
import { MomentPictureImage, useDiscoveryMomentPreview } from '../MomentPreview'
import { MomentPictureLabel, artworkPreview, momentHeadline, ownPicture } from './MomentWatchHead'
import './moment-watch.css'

const MAX_ROWS = 20

interface UpNextRow { offsetSeconds: number; liveFrameUrl?: string }
/** `complete` is false for a live feed page that says more pages follow: its rows are not all of this stream's. */
interface Others { rows: UpNextRow[]; complete: boolean }
type Read = { status: 'loading' } | { status: 'failed' } | ({ status: 'ready' } & Others)

/**
 * What a row's own picture needs from the page: the stream's VOD and its verified alignment, and the
 * stream's game segments (null while they are read), so each row's game art is the game at its minute.
 */
export interface UpNextPictures { vodId: string | null; vodAlignSeconds: number | null; games: readonly CategorySegment[] | null }

/**
 * The stream's other Moments: the feed's items for it while live, in a build that has the live feed;
 * otherwise the recap's top Moments in rank order, from the recap read the page shares (one per stream).
 */
async function readOthers(streamId: string, live: boolean, signal: AbortSignal): Promise<Others> {
  if (live && momentsFeedEnabled()) {
    const snapshot = await loadMomentsFeed(Date.now(), signal)
    const rows = snapshot.items.filter(item => item.streamId === streamId).map(item => ({ offsetSeconds: item.offsetSeconds, liveFrameUrl: item.liveFrameUrl }))
    return { rows, complete: snapshot.nextCursor === null }
  }
  const data = await untilStopped(() => loadMomentRecap(streamId), signal)
  // No list at all is a failed read, never an empty one.
  if (!Array.isArray(data.topMoments)) throw new TypeError('Unexpected recap shape')
  const rows = data.topMoments.flatMap(row => typeof row?.offsetSeconds === 'number' && Number.isFinite(row.offsetSeconds) && row.offsetSeconds >= 0
    ? [{ offsetSeconds: row.offsetSeconds }] : [])
  return { rows, complete: true }
}

/**
 * A row's picture box. The row's own picture (VOD frame, nearby clip, game art) is asked for only once
 * the row is near the screen and the page has `pictures`; until then, or when there is none, the
 * approved one stays: the live frame while live, else the stream's thumbnail. Every kind is labelled
 * but the live frame.
 */
function UpNextThumb({ moment, offsetSeconds, minuteMs, live, liveFrameUrl, artwork, pictures, holdReads }: {
  moment: DiscoveryMoment
  offsetSeconds: number
  minuteMs: number
  live: boolean
  liveFrameUrl?: string
  artwork: ArchiveArtwork | null
  pictures: UpNextPictures | null
  holdReads: boolean
}) {
  const [ref, near] = useNearScreen<HTMLSpanElement>()
  const rowMoment = useMemo<DiscoveryMoment>(() => ({
    key: JSON.stringify([moment.login, moment.streamId, offsetSeconds]), login: moment.login, streamId: moment.streamId,
    offsetSeconds, label: 'Measured reaction', category: moment.category, provenance: 'hub',
  }), [moment.login, moment.streamId, moment.category, offsetSeconds])
  const timing = useMemo(() => pictures
    ? { vodId: pictures.vodId, vodAlignSeconds: pictures.vodAlignSeconds, atMs: minuteMs, artwork }
    : null, [pictures, minuteMs, artwork])
  const game = pictures?.games ? momentGameArtAt(pictures.games, offsetSeconds, 285, 380) : null
  const { preview, onImageError } = useDiscoveryMomentPreview(rowMoment,
    { enabled: near && pictures !== null && !holdReads, timing, broadcast: artwork, gameArt: game?.url ?? null, gameName: game?.gameName ?? null })
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const badge = <span className="nc-thumb-badge nc-thumb-length" aria-hidden="true">{formatStreamOffset(offsetSeconds)}</span>
  // The link names the row; the label is for the eye (the picture itself is decoration).
  if (pictures && ownPicture(preview)) {
    return (
      <span ref={ref} className="nc-thumb" data-kind={preview.kind}>
        <MomentPictureImage preview={preview} onImageError={onImageError} />
        <MomentPictureLabel preview={preview} quiet />
        {badge}
      </span>
    )
  }
  const frame = live ? liveFrameUrl : undefined
  const candidate = frame ?? artwork?.url
  const picture = candidate && candidate !== failedSrc ? candidate : undefined
  return (
    <span ref={ref} className={picture ? 'nc-thumb' : 'nc-thumb nc-thumb-missing'}>
      {picture ? <img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => { setFailedSrc(picture); onImageError(picture) }} /> : null}
      {!frame && picture && artwork ? <MomentPictureLabel preview={artworkPreview(artwork)} quiet /> : null}
      {badge}
    </span>
  )
}

/**
 * "More Moments from this stream": rows that open the stream's other Moment
 * pages. Shows nothing until the page's own Moment is known. Neither source says
 * whether another minute has a clip, so a row carries no clip line.
 */
export function MomentUpNext({ moment, streamStartedAtMs, live, artwork, pictures = null, holdReads = false, onSettled }: {
  moment: DiscoveryMoment | null
  streamStartedAtMs: number
  live: boolean
  /** The stream picture the head shows. */
  artwork: ArchiveArtwork | null
  /** What the rows' own pictures need, once the page is idle; null asks for none. */
  pictures?: UpNextPictures | null
  /**
   * True while the page's own picture is still being read: the rows ask for no frame or clip until it is
   * done, so its frame is not queued behind theirs. Their clip ranges still join the channel's one read.
   */
  holdReads?: boolean
  /** Called once the rows (or the line saying there are none) are shown: what the page adds below waits for it. */
  onSettled?: () => void
}) {
  const [read, setRead] = useState<Read>({ status: 'loading' })
  const streamId = moment?.streamId
  useEffect(() => {
    if (!streamId) return
    const controller = new AbortController()
    setRead({ status: 'loading' })
    readOthers(streamId, live, controller.signal).then(
      others => { if (!controller.signal.aborted) setRead({ status: 'ready', ...others }) },
      () => { if (!controller.signal.aborted) setRead({ status: 'failed' }) },
    )
    return () => controller.abort()
  }, [streamId, live])
  const settled = read.status !== 'loading'
  useEffect(() => { if (settled) onSettled?.() }, [settled, onSettled])

  const skeleton = (
    <div className="nc-rows" aria-busy="true">
      {[0, 1, 2].map(i => <div key={i} className="nc-skel nc-skel-row" aria-hidden="true"><span /><span /></div>)}
    </div>
  )
  if (!moment) return skeleton
  const minuteOf = (offsetSeconds: number) => momentMinuteAt(streamStartedAtMs, offsetSeconds)

  if (read.status === 'loading') return skeleton
  if (read.status === 'failed') return <p className="nc-muted" role="status">Other Moments didn’t load.</p>

  const seen = new Set<MomentAtKey>([momentAtKey(minuteOf(moment.offsetSeconds))])
  const rows: Array<UpNextRow & { key: MomentAtKey; minuteMs: number }> = []
  for (const row of read.rows) {
    const minuteMs = minuteOf(row.offsetSeconds)
    const key = momentAtKey(minuteMs)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ ...row, key, minuteMs })
    if (rows.length === MAX_ROWS) break
  }
  if (rows.length === 0) {
    return <p className="nc-muted" role="status">{read.complete ? 'No other Moments from this stream yet.' : 'Other Moments from this stream aren’t in the latest feed.'}</p>
  }

  return (
    <ul className="nc-rows mw-up-list" role="list">
      {rows.map(row => (
        <li key={row.key}>
          {/* The row hands its Moment over, so the next page's head paints before its read. */}
          <Link className="mw-up-row" to={momentPagePath(moment.streamId, row.key)}
            state={{ from: 'moment', moment: handOverMoment({ ...moment, offsetSeconds: row.offsetSeconds }, row.minuteMs) }}
            {...momentPageWarmth({ streamId: moment.streamId, at: row.minuteMs })}>
            <UpNextThumb moment={moment} offsetSeconds={row.offsetSeconds} minuteMs={row.minuteMs} live={live}
              liveFrameUrl={row.liveFrameUrl} artwork={artwork} pictures={pictures} holdReads={holdReads} />
            <span className="mw-up-title">{momentHeadline(null, row.offsetSeconds)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
