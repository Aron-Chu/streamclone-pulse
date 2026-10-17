import type { LiveHeatPoint } from '@streampulse/pulse-core'
import type { MomentPictureView } from './momentFramesContract.ts'

/**
 * Contract between the Twitch content script and `content/catch-me-up.js`,
 * the lazily injected script that draws the top of a stream recap: a one-line
 * story of the stream, its #1 moment and the two after it.
 *
 * The content script owns the data and what a click does (jump, or open the
 * moment's card under the block); the Catch me up script owns the markup.
 * Pictures come from the moment-frames script when this tab captured them,
 * and the block shows none otherwise.
 */

export interface CatchMeUpMoment {
  point: LiveHeatPoint
  /** The hero's picture and a mini's thumbnail. */
  card: MomentPictureView
  thumb: MomentPictureView
  /** The game on screen then. */
  game?: { name: string; art?: string }
}

export interface CatchMeUpModel {
  /** Ranked moments, best first; the block shows the first three. */
  moments: CatchMeUpMoment[]
  /** Minute rollups, for the busiest half hour. */
  rollups: ReadonlyArray<{ offsetSeconds: number; chatCount: number }>
  durationSeconds: number
  peakChatPerMin: number
  /** Every ranked moment in the recap, the three above included. */
  momentCount: number
  /** More than one game was played, so the block names the #1 moment's. */
  namesGame: boolean
  backendUrl: string
  /** A VOD page: jumps seek this player, so the best three can be played in turn. */
  vodPage: boolean
}

export interface CatchMeUpActions {
  /** Jumps to the moment at `index`, as its card's Jump does. */
  jump: (index: number) => void
  /** Picks the moment at `index` for the card under the block; picked again, clears it. */
  pick: (index: number) => void
}

export interface CatchMeUpBlock {
  /** Marks the mini whose card is open under the block, or none. */
  select: (index: number | null) => void
  remove: () => void
}

export interface CatchMeUpApi {
  /** Draws the block into an element the caller leaves empty. */
  mount: (host: HTMLElement, model: CatchMeUpModel, actions: CatchMeUpActions) => CatchMeUpBlock
}

/** Fired on window once the Catch me up script has registered itself. */
export const CATCH_ME_UP_READY_EVENT = 'pulse-catch-me-up'

declare global {
  var __pulseCatchMeUp: CatchMeUpApi | undefined
}
