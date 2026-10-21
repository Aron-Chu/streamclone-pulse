/**
 * Contract between the Twitch content script and `content/catch-me-up.js`,
 * the lazily injected script that draws the summary at the top of a stream
 * recap (CatchMeUpSummary): Twitch's cover of the VOD, the stream's title,
 * the games in the order played and the minute with the most chat.
 *
 * The content script owns the data and what a click does (select a minute on
 * the chart); the script owns the markup. The cover and Twitch's title come
 * through the moment-frames script, so with Moment pictures off there are none.
 */

export interface CatchMeUpModel {
  /** Minute rollups, for the peak minute. */
  rollups: ReadonlyArray<{ offsetSeconds: number; chatCount: number }>
  durationSeconds: number
  peakChatPerMin: number
  summary: CatchMeUpSummary
}

/**
 * Twitch's cover and title of the stream's VOD (read through the frames
 * script) and the games in the order played; the script adds the minute with
 * the most chat, which selects that minute on the chart.
 */
export interface CatchMeUpSummary {
  vodId?: string | null
  /** The stream's title where the recap knows it; else Twitch's title of the VOD. */
  title?: string | null
  /** Game names, in the order played. */
  games: string[]
}

export interface CatchMeUpActions {
  /** Selects the chart's minute at `offsetSeconds`, as clicking it there does. */
  minute: (offsetSeconds: number) => void
}

export interface CatchMeUpBlock {
  remove: () => void
}

export interface CatchMeUpApi {
  /** Draws the summary into an element the caller leaves empty; null with nothing to say. */
  mount: (host: HTMLElement, model: CatchMeUpModel, actions: CatchMeUpActions) => CatchMeUpBlock | null
}

/** Fired on window once the script has registered itself. */
export const CATCH_ME_UP_READY_EVENT = 'pulse-catch-me-up'

declare global {
  var __pulseCatchMeUp: CatchMeUpApi | undefined
}
