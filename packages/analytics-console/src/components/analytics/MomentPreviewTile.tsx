/**
 * The picture box of a moment or a selected bar (mockup `.mpl-box`, d3-v2
 * moment-rows.js playerHTML / session-original.js previewHTML).
 *
 * A VOD storyboard tile cropped with CSS when one exists; otherwise a plain dark
 * box with the reason there is no frame (the game's box art sits beside it, in the
 * strip's caption; until 2026-10-21 it was blurred behind the box too). Never a
 * stand-in or a live frame. Over it: Play (the caller loads Twitch's player only on click),
 * or a line saying why there is no Play. Shared by the bar strip (U14) and the
 * moment rows (U11). Styles: WEB/src/ui/charts/sp-session-strip.css (`.mpl-*`).
 */
import { forwardRef, type ReactNode } from 'react'
import { frameBackgroundStyle, frameTimingPhrase, type VodFrame } from '../../utils/vodFrames.ts'

export type PreviewSubject = 'minute' | 'bar' | 'moment'

export const PREVIEW_PLAYER_LOADS_COPY = "Twitch's player loads only when you press play."
export const PREVIEW_RECORDING_COPY = 'Twitch publishes preview frames when the VOD finishes.'

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
  /** The VOD is still recording (Twitch has no storyboard yet). */
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
  canPlay: boolean
}): Array<{ text: string; quiet: boolean }> {
  const { frame, subject, subjectVodStart, recording, canPlay } = args
  if (frame) {
    const lines: Array<{ text: string; quiet: boolean }> = []
    if (canPlay) lines.push({ text: PREVIEW_PLAYER_LOADS_COPY, quiet: false })
    const when = frameTimingPhrase(frame, subjectVodStart, subject)
    if (when) lines.push({ text: `Preview frame ${when}.`, quiet: true })
    return lines
  }
  const unit = subject === 'bar' ? 'this bar' : 'this minute'
  const lines = [{ text: recording ? PREVIEW_RECORDING_COPY : `No preview frame for ${unit}.`, quiet: false }]
  // the moment player says both; the bar's picture only the reason (session-original.js previewHTML)
  if (subject === 'moment' && canPlay) lines.push({ text: PREVIEW_PLAYER_LOADS_COPY, quiet: true })
  return lines
}

export const MomentPreviewTile = forwardRef<HTMLDivElement, MomentPreviewTileProps>(function MomentPreviewTile(
  { frame, loading, subject, subjectVodStart, recording, playLabel, message, onPlay, player },
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
  const lines = loading ? [] : previewNoteLines({ frame, subject, subjectVodStart, recording, canPlay })
  return (
    <div
      ref={ref}
      className={`mpl-box ${frame ? 'fr' : 'nofr'}`}
      data-preview-tile={frame ? 'frame' : loading ? 'loading' : 'fallback'}
    >
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
