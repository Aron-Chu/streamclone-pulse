import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { BROADCAST_THUMBNAIL_LABEL, NO_PICTURE_LINE, type MomentPreview, type MomentPreviewState } from '@streampulse/analytics-console/moment-previews'
import type { MomentFacts, WindowClip } from '../../../../lib/momentFeedback'
import type { ArchiveArtwork } from '../../../../lib/archiveArtwork'
import { formatStreamOffset } from '../../../../lib/formatStreamOffset'
import { ChannelAvatar, formatClock } from '../../clips/NativeClipParts'
import { MomentPictureImage, ROW_PICTURE_LABEL, pictureLabelLong } from '../MomentPreview'
import './moment-watch.css'

/** The Moment's headline: the clip's title when its window has one, else "Moment at {offset}". */
export function momentHeadline(clip: WindowClip | null, offsetSeconds: number): string {
  return clip?.title || `Moment at ${formatStreamOffset(offsetSeconds)}`
}

/**
 * A picture's label on its box: the short name for the eye, the full words on hover and, alone, for a
 * screen reader. `quiet` inside a link that already names its row: for the eye only.
 */
export function MomentPictureLabel({ preview, quiet = false }: { preview: MomentPreview; quiet?: boolean }) {
  const long = pictureLabelLong(preview)
  return (
    <span className="nc-thumb-badge mw-picture-label" title={long} aria-hidden={quiet || undefined}>
      <span aria-hidden="true">{ROW_PICTURE_LABEL[preview.kind]}</span>{quiet ? null : <span className="sr-only">{long}</span>}
    </span>
  )
}

/** The Watch pill's room while the Moment is on its way, so the pill lands without moving anything (it wraps on a phone). */
function PillHold({ at }: { at: string }) {
  return (
    <span className="nc-btn nc-pill nc-pill-light mw-pill-hold" aria-hidden="true">
      Watch on Twitch from {at}
      <ExternalLink size={14} aria-hidden="true" />
    </span>
  )
}

/**
 * The head's shape before anything about the Moment is known (a link that handed nothing over): the
 * picture box, the title's line and the channel row, as placeholders of the same size.
 */
export function MomentWatchHeadPlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="mw-picture"><div className="nc-player nc-skel-player" /></div>
      <div className="nc-watch-title"><span className="mw-skel-text">Moment at 0:00:00</span></div>
      <div className="nc-watch-row">
        <div className="nc-watch-channel">
          <span className="nc-avatar mw-skel-avatar" />
          <span className="nc-watch-channel-text"><span className="mw-skel-text">Channel name</span></span>
          <PillHold at="0:00:00" />
        </div>
      </div>
    </div>
  )
}

/** The stream's thumbnail as a labelled picture: the approved artwork is that thumbnail. */
export const artworkPreview = (artwork: ArchiveArtwork): MomentPreview =>
  ({ kind: 'broadcast', label: BROADCAST_THUMBNAIL_LABEL, imageUrl: artwork.url })

/** A picture of (or near) the moment itself, or its game. The stream's thumbnail stays the approved artwork. */
export const ownPicture = (preview: MomentPreview | undefined): boolean =>
  preview?.kind === 'frame' || preview?.kind === 'clip' || preview?.kind === 'game'

/**
 * The head shows its own picture once it is decided: a stream frame at once (nothing ranks above it),
 * any other only when its reads are done, so game art or a nearby clip never shows and is then replaced.
 */
const decided = (picture: MomentPreviewState): boolean => !picture.loading || picture.preview.kind === 'frame'

/**
 * The picture box, the title and the channel row of a Moment's page. The
 * page has no video player: the box is a link that opens Twitch.
 * `twitchHref` is the Twitch link at the current `at`, or null when none is confirmed.
 */
export function MomentWatchHead({ stream, clip, clipsChecked, offsetSeconds, atSeconds, twitchHref, artwork, picture, pending = false }: {
  stream: Pick<MomentFacts['stream'], 'login' | 'displayName' | 'profileImageUrl' | 'category'>
  clip: WindowClip | null
  /** True when the feedback answer listed the window's clips: only then does the box say there is no clip. */
  clipsChecked: boolean
  /** The Moment's minute, in seconds into the stream. */
  offsetSeconds: number
  /** The instant the page points Twitch at, in seconds into the stream. */
  atSeconds: number
  twitchHref: string | null
  artwork: ArchiveArtwork | null
  /** The moment's own picture once the page is idle (VOD frame, nearby clip, game art), or null before. */
  picture: MomentPreviewState | null
  /** The Moment is still on its way: the box is a placeholder of the same size. */
  pending?: boolean
}) {
  const channel = { id: '', login: stream.login, displayName: stream.displayName || stream.login, profileImageUrl: stream.profileImageUrl }
  const at = formatStreamOffset(atSeconds)

  let box
  let label = null
  if (pending) {
    box = <div className="nc-player nc-skel-player" />
  } else if (clip) {
    box = (
      <a className="nc-thumb" href={clip.url} target="_blank" rel="noopener noreferrer" aria-label={`${clip.title} (opens on Twitch)`}>
        {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} alt="" loading="eager" decoding="async" /> : null}
        <span className="nc-thumb-badge nc-thumb-length">{formatClock(clip.durationSeconds)}</span>
      </a>
    )
  } else if (picture && ownPicture(picture.preview) && decided(picture)) {
    // The moment's own picture, whole and labelled. The pill below is the same Twitch link.
    const inner = <MomentPictureImage preview={picture.preview} onImageError={picture.onImageError} eager />
    box = twitchHref ? (
      <a className="nc-thumb" data-kind={picture.preview.kind} href={twitchHref} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">{inner}</a>
    ) : (
      <div className="nc-thumb" data-kind={picture.preview.kind}>{inner}</div>
    )
    label = <MomentPictureLabel preview={picture.preview} />
  } else if (!artwork && !clipsChecked && (picture === null || picture.loading)) {
    // No picture to show yet, and none ruled out: the neutral placeholder stays until the picture reads decide.
    box = twitchHref ? (
      <a className="nc-player nc-skel-player" href={twitchHref} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true" />
    ) : (
      <div className="nc-player nc-skel-player" />
    )
  } else {
    // "No clip" only when the feedback answer listed the window's clips; "no picture" only once the picture reads found none.
    const noPicture = !artwork && picture !== null && !picture.loading && picture.preview.kind === 'none'
    const line = clipsChecked ? 'No clip of this one yet.' : noPicture ? NO_PICTURE_LINE : null
    const inner = (
      <>
        {artwork ? <img src={artwork.url} alt="" loading="eager" decoding="async" /> : null}
        <span className="nc-thumb-gone">
          <span className="mw-gone-text">
            {line ? <strong>{line}</strong> : null}
            {twitchHref ? <span>Watch on Twitch from {at}</span> : null}
          </span>
        </span>
      </>
    )
    const cls = artwork ? 'nc-thumb' : 'nc-thumb nc-thumb-missing'
    box = twitchHref ? (
      // The pill below is the same link; this one stays out of the tab order.
      <a className={cls} data-unavailable={artwork ? '' : undefined} href={twitchHref} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">{inner}</a>
    ) : (
      <div className={cls} data-unavailable={artwork ? '' : undefined}>{inner}</div>
    )
    if (artwork) label = <MomentPictureLabel preview={artworkPreview(artwork)} />
  }

  return (
    <>
      {/* The label sits beside the box, not in it: the box link is hidden from screen readers, the label is not. */}
      <div className="mw-picture">{box}{label}</div>
      <h1 className="nc-watch-title">{momentHeadline(clip, offsetSeconds)}</h1>
      <div className="nc-watch-row">
        <div className="nc-watch-channel">
          <ChannelAvatar channel={channel} size={40} />
          <span className="nc-watch-channel-text">
            <Link className="nc-strong nc-link-quiet" to={`/analytics/${encodeURIComponent(stream.login)}`}>{channel.displayName}</Link>
            {stream.category ? <span className="nc-muted">{stream.category}</span> : null}
          </span>
          {twitchHref ? (
            <a className="nc-btn nc-pill nc-pill-light" href={twitchHref} target="_blank" rel="noopener noreferrer">
              Watch on Twitch from {at}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : pending ? <PillHold at={at} /> : null}
        </div>
      </div>
    </>
  )
}
