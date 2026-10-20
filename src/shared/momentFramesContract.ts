/**
 * Contract between the Twitch content script and `content/moment-frames.js`,
 * the lazily injected script that keeps small frames of what this tab played
 * and draws them into Top Moments rows and moment cards.
 *
 * The content script owns the data (which moment, where it starts, which game)
 * and leaves an empty element for each picture; the frames script owns the
 * pixels. Frames stay in the tab's memory and are gone when it closes, except
 * the one the worker asks for when a moment is saved or watched. A moment the
 * tab holds no frame of shows Twitch's VOD tile of it, else the backend's
 * picture (MomentPictureAt), else a card's stand-in (`art`, `emote`).
 */

/** A stream offset the picture is about, and the span it may scrub across. */
export interface MomentPictureView {
  /** A row thumbnail (flips through frames on hover) or a card picture (drag to scrub). */
  kind: 'thumb' | 'card'
  /** Stream offsets, in seconds. */
  from: number
  to: number
  /** The frame shown at rest and marked "peak". */
  peak: number
  /**
   * A card with no picture of the moment opens on the game's box art, else
   * on this emote (chat's top one then); without either it has no picture.
   */
  art?: string
  emote?: string
}

/** The stream Pulse shows, so the frames script can ask the backend for a picture it holds no frames of. */
export interface MomentPictureAt {
  /** The backend Pulse reads from. */
  api?: string
  login?: string | null
  /** The stream id; without one there is no backend picture. */
  key?: string | null
  /** The stream's VOD: the backend checks it against the stream; Twitch's VOD tiles come from it. */
  vodId?: string | null
  /** Where the VOD starts in the stream, in seconds; 0 when unknown. */
  vodOriginDeltaSeconds?: number
}

export interface MomentFrameSource {
  /** The stream the offsets belong to; another stream's frames are dropped. */
  key: string
  /** Twitch's main player. */
  video: () => HTMLVideoElement | null
  /** The stream offset the player shows right now, or null when it shows something else. */
  offset: (video: HTMLVideoElement) => number | null
}

export interface MomentFramesApi {
  /** Starts keeping frames from the player; the returned function stops. */
  start: (source: MomentFrameSource) => () => void
  /** Spans whose frames outlive the rolling window, such as ranked moments. */
  keep: (spans: ReadonlyArray<readonly [number, number]>) => void
  /** Draws a picture into an element the caller leaves empty; the returned function removes it. */
  mount: (element: HTMLElement, view: MomentPictureView, at?: MomentPictureAt) => () => void
  /** Twitch's title, cover and scrub sheets of the stream's VOD, asked once per VOD. */
  vod: (at?: MomentPictureAt) => Promise<import('./vodPictures.ts').VodPictures | null>
}

/** Fired on window once the frames script has registered itself. */
export const MOMENT_FRAMES_READY_EVENT = 'pulse-moment-frames'

/**
 * A frame the worker asks this tab for: the picture of a moment just saved or
 * watched, kept with it on this device (src/shared/momentPictureStore.ts).
 * The worker sends the tab's open requests as `MOMENT_PICTURE_WANTS`; the
 * frames script answers each once with `MOMENT_PICTURE` `frame`.
 */
export interface MomentPictureWant {
  token: string
  /** The stream the frame must come from; any while unknown (a VOD-only save). */
  stream?: string
  from: number
  to: number
  peak: number
  /** Epoch ms after which the tab drops it. */
  until: number
}

export const MOMENT_PICTURE_WANTS = 'MOMENT_PICTURE_WANTS'

/**
 * Where a saved moment's picture comes from, as its card picture does: a few
 * seconds before chat reacted for a moment timed to the second, else across
 * its minute.
 */
export function savedPictureView(offsetSeconds: number): Pick<MomentPictureView, 'from' | 'to' | 'peak'> {
  const at = Math.floor(offsetSeconds)
  return at % 60 === 0 ? { from: at - 10, to: at + 60, peak: at + 30 } : { from: at - 20, to: at + 30, peak: at - 3 }
}

declare global {
  var __pulseMomentFrames: MomentFramesApi | undefined
}
