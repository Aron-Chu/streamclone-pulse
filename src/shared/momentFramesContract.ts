/**
 * Contract between the Twitch content script and `content/moment-frames.js`,
 * the lazily injected script that keeps small frames of what this tab played
 * and draws them into Top Moments rows and moment cards.
 *
 * The content script owns the data (which moment, where it starts, which game)
 * and leaves an empty element for each picture; the frames script owns the
 * pixels. Frames never leave the tab's memory and are gone when it closes.
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
  mount: (element: HTMLElement, view: MomentPictureView) => () => void
}

/** Fired on window once the frames script has registered itself. */
export const MOMENT_FRAMES_READY_EVENT = 'pulse-moment-frames'

declare global {
  var __pulseMomentFrames: MomentFramesApi | undefined
}
