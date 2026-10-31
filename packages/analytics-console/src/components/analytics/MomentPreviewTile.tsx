/**
 * The picture box of a moment or a selected bar (mockup `.mpl-box`, d3-v2
 * moment-rows.js playerHTML / session-original.js previewHTML).
 *
 * A VOD storyboard tile cropped with CSS when one exists; otherwise a plain
 * dark box with the reason there is no frame (candidate, 10-30, PIC-2: the
 * game's sharp cover sits beside it, in the strip's caption; until 10-30 the
 * 210x280 box art was stretched and blurred behind the box and read as a
 * broken preview). Never a stand-in or a live frame. Over it: Play (the caller
 * loads Twitch's player only on click), or a line saying why there is no Play.
 * Shared by the bar strip (U14) and the moment rows (U11). Styles:
 * WEB/src/ui/charts/sp-session-strip.css (`.mpl-*`).
 */
import { forwardRef, type ReactNode } from 'react'
import { frameBackgroundStyle, frameTimingPhrase, type VodFrame } from '../../utils/vodFrames.ts'

export type PreviewSubject = 'minute' | 'bar' | 'moment'

export const PREVIEW_PLAYER_LOADS_COPY = "Twitch's player loads only when you press play."
// PIC-3 (candidate, 10-30): the copy for Aron. Until 10-30 the reel said "no VOD preview frames for this stream",
// which blamed Twitch and the stream for our lookup (F6: the backend asks Twitch for a field that doesn't exist,
// so every VOD answers no_storyboard, ended ones too), and the bar said "when the VOD finishes" on a stream that
// had long ended. Say "recording" only while the page says the stream records; otherwise say it's on our side.
export const PREVIEW_RECORDING_COPY = 'No preview frames while the stream is live.'
export const PREVIEW_UNAVAILABLE_COPY = "Preview frames aren't available right now."
const PREVIEW_BOX_ART_COPY = "Pictures are the game's box art."

/**
 * The one line for a picture with no frame (fix, 10-30, PIC-3): the reel's note, the bar's picture and the row
 * player say it alike, from the page's one `recording` flag. `hasArt`: a game cover shows with it, so the line
 * may say what the pictures are.
 */
export function previewMissLine(args: { recording?: boolean; hasArt?: boolean }): string {
  if (args.recording) return PREVIEW_RECORDING_COPY
  return args.hasArt ? `${PREVIEW_UNAVAILABLE_COPY} ${PREVIEW_BOX_ART_COPY}` : PREVIEW_UNAVAILABLE_COPY
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z" fill="currentColor" />
    </svg>
  )
}

export interface MomentPreviewTileProps {
  /** The storyboard tile; null = no frame (the reason instead). */
  frame: VodFrame | null
  /** The frame request is still out: hold the reason back so it never flips. */
  loading?: boolean
  /** What the picture previews; picks the copy ("this minute", "this bar", "the moment"). */
  subject: PreviewSubject
  /** The subject's start on the VOD's clock, for "Preview frame from about N s before …". */
  subjectVodStart?: number | null
  /** The game's cover shows beside the box (the strip's caption): the note may say the pictures are box art. (fix, 10-30) */
  hasArt?: boolean
  /** The page's flag: this is the channel's current live stream, still recording. */
  recording?: boolean
  /** Play's label, e.g. "Play VOD from 0:50:39"; null = no Play, `message` says why. */
  playLabel?: string | null
  /** Shown instead of Play. */
  message?: string | null
  onPlay?: () => void
  /** Twitch's player, once the viewer pressed Play: it replaces the picture. */
  player?: ReactNode
}

/** The frame note's lines (mockup copy). */
export function previewNoteLines(args: {
  frame: VodFrame | null
  subject: PreviewSubject
  subjectVodStart?: number | null
  recording?: boolean
  hasArt?: boolean
  canPlay: boolean
}): Array<{ text: string; quiet: boolean }> {
  const { frame, subject, subjectVodStart, recording, hasArt, canPlay } = args
  if (frame) {
    const lines: Array<{ text: string; quiet: boolean }> = []
    if (canPlay) lines.push({ text: PREVIEW_PLAYER_LOADS_COPY, quiet: false })
    const when = frameTimingPhrase(frame, subjectVodStart, subject)
    if (when) lines.push({ text: `Preview frame ${when}.`, quiet: true })
    return lines
  }
  // the reel's line, word for word (fix, 10-30, PIC-3; it was "No preview frame for this minute.")
  const lines = [{ text: previewMissLine({ recording, hasArt }), quiet: false }]
  // the moment player says both; the bar's picture only the reason (session-original.js previewHTML)
  if (subject === 'moment' && canPlay) lines.push({ text: PREVIEW_PLAYER_LOADS_COPY, quiet: true })
  return lines
}

export const MomentPreviewTile = forwardRef<HTMLDivElement, MomentPreviewTileProps>(function MomentPreviewTile(
  { frame, loading, subject, subjectVodStart, hasArt, recording, playLabel, message, onPlay, player },
  ref,
) {
  if (player) {
    return (
      <div ref={ref} className="mpl-box on" tabIndex={-1} data-preview-tile="playing">
        {player}
      </div>
    )
  }
  const canPlay = Boolean(playLabel && onPlay)
  const lines = loading ? [] : previewNoteLines({ frame, subject, subjectVodStart, recording, hasArt, canPlay })
  return (
    <div
      ref={ref}
      className={`mpl-box ${frame ? 'fr' : 'nofr'}`}
      data-preview-tile={frame ? 'frame' : loading ? 'loading' : 'fallback'}
    >
      {/* a frame or nothing: no blurred box art behind the box (candidate, 10-30, PIC-2) */}
      {frame ? (
        <span className="mpl-pic" aria-hidden="true">
          <span className="mpl-fr" style={frameBackgroundStyle(frame)} data-preview-frame />
        </span>
      ) : null}
      {canPlay ? (
        <button type="button" className="mpl-go" onClick={onPlay} data-preview-play>
          <PlayIcon />
          <span>{playLabel}</span>
        </button>
      ) : message ? (
        <p className="mpl-msg">{message}</p>
      ) : null}
      {lines.length > 0 ? (
        <p className="mpl-note">
          {lines.map((line) => (
            <span key={line.text} className={line.quiet ? 't3' : undefined}>{line.text}</span>
          ))}
        </p>
      ) : null}
    </div>
  )
})
