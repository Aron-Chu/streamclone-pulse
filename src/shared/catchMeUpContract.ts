import type { LiveHeatPoint } from '@streampulse/pulse-core'
import type { MomentPictureAt, MomentPictureView } from './momentFramesContract.ts'

/**
 * Contract between the Twitch content script and `content/catch-me-up.js`,
 * the lazily injected script that draws the top of a stream recap: a summary
 * of the stream (CatchMeUpSummary), its #1 moment and the two after it.
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
  /** Minute rollups, for the peak minute. */
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
  /** The summary at the top of the recap (card board, S1). */
  summary: CatchMeUpSummary
  /** The stream Pulse shows, for pictures this tab holds no frames of. */
  at?: MomentPictureAt
}

/**
 * Twitch's cover and title of the stream's VOD (read through the frames
 * script) and the games in the order played; the Catch me up script adds the
 * minute with the most chat, which selects that minute on the chart.
 */
export interface CatchMeUpSummary {
  vodId?: string | null
  /** False where the recap names the stream's title itself. */
  withTitle: boolean
  /** Game names, in the order played. */
  games: string[]
}

/**
 * On a VOD page the recap puts its chart first, so the block draws in three
 * places: the facts line in `head` above the chart, the best three as tiles in
 * the mount's host under it, and Watch best in `tail` under the tiles' card.
 * Elsewhere both are null and the block draws in its host alone.
 */
export interface CatchMeUpParts {
  head: HTMLElement | null
  tail: HTMLElement | null
}

export interface CatchMeUpActions {
  /** Jumps to the moment at `index`, as its card's Jump does. */
  jump: (index: number) => void
  /** Picks the moment at `index` for the card under the block; picked again, clears it. */
  pick: (index: number) => void
  /** Selects the chart's minute at `offsetSeconds`, as clicking it there does. */
  minute: (offsetSeconds: number) => void
}

export interface CatchMeUpBlock {
  /** Marks the mini or tile whose card is open under the block, or none. */
  select: (index: number | null) => void
  remove: () => void
}

export interface CatchMeUpApi {
  /** Draws the block into elements the caller leaves empty. */
  mount: (host: HTMLElement, model: CatchMeUpModel, actions: CatchMeUpActions, parts?: CatchMeUpParts) => CatchMeUpBlock
}

/** Fired on window once the Catch me up script has registered itself. */
export const CATCH_ME_UP_READY_EVENT = 'pulse-catch-me-up'

declare global {
  var __pulseCatchMeUp: CatchMeUpApi | undefined
}
