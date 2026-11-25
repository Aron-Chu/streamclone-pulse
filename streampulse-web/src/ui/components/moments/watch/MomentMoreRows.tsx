import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pickMomentPreview, useNearScreen } from '@streampulse/analytics-console/moment-previews'
import type { ArchiveArtwork } from '../../../../lib/archiveArtwork'
import { momentSourceFromAnswer } from '../../../../lib/discoveryMoments'
import { formatStreamOffset } from '../../../../lib/formatStreamOffset'
import { momentPagePath } from '../../../../lib/momentFeedback'
import {
  channelMoreRows, gameMoreRows, hubMoreMoments, otherChannelStreams,
  type MomentGame, type MoreCurrent, type MoreRow,
} from '../../../../lib/momentMoreRows'
import { loadChannelStreams, loadMomentsHub } from '../../../../lib/momentMoreReads'
import { handOverMoment, momentPageWarmth } from '../../../../lib/momentPageFlag'
import { loadMomentRecap, loadMomentStream, untilStopped } from '../../../../lib/momentReads'
import { MomentPictureImage } from '../MomentPreview'
import { MomentPictureLabel, momentHeadline } from './MomentWatchHead'
import './moment-watch.css'

/**
 * A row's picture box: the stream's thumbnail when the data has it (a channel row asks its stream for
 * it once the row is near the screen: the same read its Moment page opens with), else the game's cover,
 * else the empty box. Each is labelled for the eye, as this stream's rows are.
 */
function MoreThumb({ row, readStream }: { row: MoreRow; readStream: boolean }) {
  const [ref, near] = useNearScreen<HTMLSpanElement>()
  const [read, setRead] = useState<ArchiveArtwork | null>(null)
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!readStream || row.artwork || !near) return
    const controller = new AbortController()
    untilStopped(() => loadMomentStream(row.streamId, true), controller.signal).then(
      data => {
        const artwork = momentSourceFromAnswer(row, data).archiveArtwork
        if (!controller.signal.aborted && artwork) setRead(artwork)
      },
      () => { /* No thumbnail: the box stays as it is. */ },
    )
    return () => controller.abort()
  }, [readStream, row, near])
  const badge = <span className="nc-thumb-badge nc-thumb-length" aria-hidden="true">{formatStreamOffset(row.offsetSeconds)}</span>
  // The shared order: the stream's thumbnail, then the game's cover, then none; a picture that fails falls through.
  const artwork = row.artwork ?? read
  const preview = pickMomentPreview({ broadcastUrl: artwork?.url, gameArtUrl: row.gameArt?.url, gameName: row.gameArt?.gameName, failed })
  if (preview.kind === 'none') return <span ref={ref} className="nc-thumb nc-thumb-missing">{badge}</span>
  return (
    <span ref={ref} className="nc-thumb" data-kind={preview.kind === 'game' ? 'game' : undefined}>
      <MomentPictureImage preview={preview} onImageError={url => setFailed(previous => new Set(previous).add(url))} />
      <MomentPictureLabel preview={preview} quiet />
      {badge}
    </span>
  )
}

function MoreList({ rows, readStream }: { rows: readonly MoreRow[]; readStream: boolean }) {
  return (
    <ul className="nc-rows mw-up-list" role="list">
      {rows.map(row => (
        <li key={`${row.streamId}/${row.momentAt}`}>
          {/* As this stream's rows: the row hands its Moment over, so the next page's head paints before its read. */}
          <Link className="mw-up-row" to={momentPagePath(row.streamId, row.momentAt)}
            state={{ from: 'moment', moment: handOverMoment(row, row.at) }}
            {...momentPageWarmth({ streamId: row.streamId, at: row.at })}>
            <MoreThumb row={row} readStream={readStream} />
            <span className="mw-up-text">
              <span className="mw-up-title">{momentHeadline(null, row.offsetSeconds)}</span>
              <span className="nc-muted mw-up-note">{row.note}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * "More from {channel}" and "More {game} Moments", below "More Moments from this stream". Nothing is
 * read until `enabled` (the page is idle and that list is on screen), and a section shows only once it
 * has rows: an empty or failed read leaves it out. The game section waits for the channel's, so each
 * lands below everything already shown and nothing moves. `game` is undefined while the page still
 * reads it, null when the Moment has none.
 */
export function MomentMoreRows({ current, channelName, game, enabled }: {
  current: MoreCurrent
  channelName: string
  game: MomentGame | null | undefined
  enabled: boolean
}) {
  const { streamId, login, momentAt } = current
  const [channel, setChannel] = useState<MoreRow[] | null>(null)
  const [inGame, setInGame] = useState<MoreRow[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const here = { streamId, login, momentAt }
    ;(async () => {
      const streams = otherChannelStreams(await untilStopped(() => loadChannelStreams(login), controller.signal), streamId)
      // One recap per stream, shared with the Moment pages these rows open; a failed one adds nothing.
      const recaps = new Map(await Promise.all(streams.map(async stream =>
        [stream.streamId, await untilStopped(() => loadMomentRecap(stream.streamId), controller.signal).catch(() => null)] as const)))
      return channelMoreRows(here, streams, recaps)
    })().then(
      rows => { if (!controller.signal.aborted) setChannel(rows) },
      () => { if (!controller.signal.aborted) setChannel([]) },
    )
    return () => controller.abort()
  }, [enabled, streamId, login, momentAt])

  const gameName = game?.name ?? null
  const categoryId = game?.categoryId ?? null
  useEffect(() => {
    if (!enabled || game === undefined) return
    if (gameName === null) { setInGame([]); return }
    const controller = new AbortController()
    untilStopped(loadMomentsHub, controller.signal).then(
      hub => { if (!controller.signal.aborted) setInGame(gameMoreRows({ streamId, login, momentAt }, { name: gameName, categoryId }, hubMoreMoments(hub))) },
      () => { if (!controller.signal.aborted) setInGame([]) },
    )
    return () => controller.abort()
    // `game` itself is a new object each render; its name and id are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, game === undefined, gameName, categoryId, streamId, login, momentAt])

  const showChannel = channel !== null && channel.length > 0
  const showGame = channel !== null && inGame !== null && inGame.length > 0 && gameName !== null
  if (!showChannel && !showGame) return null
  return (
    <>
      {showChannel ? (
        <section className="mw-more" aria-labelledby="mw-more-channel-title">
          <h2 id="mw-more-channel-title" className="nc-section-title">More from {channelName}</h2>
          <MoreList rows={channel} readStream />
        </section>
      ) : null}
      {showGame ? (
        <section className="mw-more" aria-labelledby="mw-more-game-title">
          <h2 id="mw-more-game-title" className="nc-section-title">More {gameName} Moments</h2>
          <MoreList rows={inGame} readStream={false} />
        </section>
      ) : null}
    </>
  )
}
