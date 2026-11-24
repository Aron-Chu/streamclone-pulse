import { useEffect, useMemo, useState } from 'react'
import {
  BROADCAST_THUMBNAIL_LABEL,
  GAME_ART_LABEL,
  NEARBY_CLIP_LABEL,
  NO_PICTURE_LINE,
  STREAM_FRAME_LABEL,
  frameBackgroundStyle,
  momentClipRange,
  momentMiddleVodSecond,
  useMomentPreview,
  useNearScreen,
  type MomentPreview,
  type MomentPreviewState,
} from '@streampulse/analytics-console/moment-previews'
import { momentSourceFromAnswer, type DiscoveryMoment } from '../../../lib/discoveryMoments'
import { verifiedArchiveArtwork, type ArchiveArtwork } from '../../../lib/archiveArtwork'
import { loadMomentStream } from '../../../lib/momentReads'
import { setupMomentPreviewReads } from '../../../lib/momentPreviewReads'
import { momentGameArtUrl } from '../../../lib/momentCategoryArtwork'

setupMomentPreviewReads()

/** What a picture needs from the stream answer: the VOD and its verified alignment, and when the moment was. */
export interface MomentPreviewTiming {
  vodId: string | null
  vodAlignSeconds: number | null
  atMs: number | null
  artwork: ArchiveArtwork | null
}

/** The stream answer's timing for a row, read once the row is near the screen (shared per stream). */
function useRowTiming(moment: DiscoveryMoment, near: boolean): MomentPreviewTiming | null {
  const [timing, setTiming] = useState<{ key: string; value: MomentPreviewTiming } | null>(null)
  useEffect(() => {
    if (!near) return
    let alive = true
    loadMomentStream(moment.streamId, true).then(data => {
      if (!alive) return
      const source = momentSourceFromAnswer(moment, data)
      setTiming({ key: moment.key, value: {
        vodId: source.vodId ?? null, vodAlignSeconds: source.vodAlignSeconds ?? null,
        atMs: moment.at ?? source.occurrenceAt ?? null, artwork: source.archiveArtwork ?? null,
      } })
    }, () => {
      if (alive) setTiming({ key: moment.key, value: { vodId: null, vodAlignSeconds: null, atMs: moment.at ?? null, artwork: null } })
    })
    return () => { alive = false }
    // One read per moment once near; the moment object itself is replaced on every list poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, moment.key])
  return timing?.key === moment.key ? timing.value : null
}

/** A moment's picture from what is known: asks for a frame and clips only once `enabled` and timed. */
export function useDiscoveryMomentPreview(moment: DiscoveryMoment, options: {
  enabled: boolean
  timing: MomentPreviewTiming | null
  broadcast?: ArchiveArtwork | null
  gameArt: string | null
  /** The game `gameArt` shows, when it is not the moment's own category (a stream that changed games). */
  gameName?: string | null
}): MomentPreviewState {
  const { enabled, timing, broadcast, gameArt } = options
  const vodSecond = momentMiddleVodSecond(moment.offsetSeconds, timing?.vodAlignSeconds)
  const atMs = timing?.atMs ?? moment.at ?? null
  const clipRange = useMemo(() => momentClipRange(atMs), [atMs])
  const thumbnail = broadcast ?? timing?.artwork
  return useMomentPreview({
    enabled: enabled && timing != null,
    login: moment.login,
    vodId: timing?.vodId,
    vodSecond,
    clipRange,
    broadcastUrl: thumbnail ? verifiedArchiveArtwork(thumbnail, thumbnail.vodId)?.url ?? null : null,
    gameArtUrl: gameArt,
    gameName: options.gameName !== undefined ? options.gameName : moment.category ?? null,
  })
}

/** The picture itself, in a 16:9 box the caller sizes. Game art sits whole on the box; nothing stretches it. */
export function MomentPictureImage({ preview, onImageError, eager = false }: { preview: MomentPreview; onImageError: (url: string) => void; eager?: boolean }) {
  if (preview.kind === 'frame') return <span className="moment-picture-frame" style={frameBackgroundStyle(preview.frame)} />
  if (preview.kind === 'none') return null
  return <img
    className={preview.kind === 'game' ? 'moment-picture-cover' : undefined}
    src={preview.imageUrl}
    alt=""
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
    referrerPolicy="no-referrer"
    onError={() => onImageError(preview.imageUrl)}
  />
}

/** The short label under a row's picture: every picture says what it is. */
export const ROW_PICTURE_LABEL: Record<MomentPreview['kind'], string> = {
  frame: STREAM_FRAME_LABEL,
  clip: NEARBY_CLIP_LABEL,
  broadcast: BROADCAST_THUMBNAIL_LABEL,
  game: GAME_ART_LABEL,
  none: 'No picture yet',
}

/** The label's full words, for its title and for a screen reader. */
export function pictureLabelLong(preview: MomentPreview): string {
  switch (preview.kind) {
    case 'frame': return 'Stream frame from this moment'
    case 'clip': return `Nearby clip from the same stream, ${Math.round(preview.clip.distanceSeconds)} s from the moment`
    case 'broadcast': return 'The stream’s thumbnail, not this moment'
    case 'game': return preview.gameName ? `Game art for ${preview.gameName}, not this moment` : 'Game art, not this moment'
    case 'none': return NO_PICTURE_LINE
  }
}

/**
 * A row's picture slot (88 px, the row's own slot): the picture and its label, always the same height, so
 * a row never moves when its picture arrives. Reads start only once the row is near the screen; the slot
 * is hidden in a narrow list, so a phone asks for nothing.
 *
 * With no picture the label stays blank until the row's reads have run, and only then says there is none.
 * An empty slot says nothing to a screen reader; a picture's label is read as its full words only.
 */
export function MomentRowPicture({ moment, artwork }: { moment: DiscoveryMoment; artwork?: ArchiveArtwork }) {
  const [ref, near] = useNearScreen<HTMLDivElement>()
  const timing = useRowTiming(moment, near)
  const gameArt = momentGameArtUrl(moment, 76, 100)
  const { preview, loading, onImageError } = useDiscoveryMomentPreview(moment, { enabled: near, timing, broadcast: artwork ?? null, gameArt })
  const unread = preview.kind === 'none' && (!near || timing === null || loading)
  const long = unread ? undefined : pictureLabelLong(preview)
  return <div ref={ref} className="moments-card-slot" data-preview={preview.kind} aria-hidden={preview.kind === 'none' ? 'true' : undefined}>
    <span className="moments-card-artwork" title={long}>
      <span className="moments-card-pic" data-kind={preview.kind} aria-hidden="true"><MomentPictureImage preview={preview} onImageError={onImageError} /></span>
      <span className="moments-card-label">{unread ? null : <><span aria-hidden="true">{ROW_PICTURE_LABEL[preview.kind]}</span><span className="sr-only">{long}</span></>}</span>
    </span>
  </div>
}
