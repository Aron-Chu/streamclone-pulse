import type { PulsePayload } from '../shared/messages.ts'
import type { TwitchPageContext } from '../content/twitch.ts'
import { effectivePulseIsLive } from './effectivePulseLive.ts'

/**
 * Canonical surface the overlay is rendering for. Derived once per render in
 * `Overlay`, then threaded down. Nothing below the overlay may re-derive live
 * state from `payload.isLive`, page DOM, or its own heuristics — divergent
 * copies of that decision are what produced future-fade on finished streams and
 * live badges on VOD pages.
 */
export type PulseSurfaceMode = 'channel_live' | 'channel_recap' | 'vod_player'

/**
 * Where the "now" boundary on a chart comes from for a given surface.
 * - `live_edge`   the trailing edge advances with wall clock; ahead-of-now is unknown
 * - `player_time` the boundary is the video player's corrected position
 * - `none`        the whole series is history; there is no future to grey out
 */
export type PulseCursorSource = 'live_edge' | 'player_time' | 'none'

export function resolvePulseSurfaceMode(input: {
  context: TwitchPageContext
  payload: PulsePayload | null
  pageIsLive: boolean
}): PulseSurfaceMode {
  if (input.context.kind === 'vod') return 'vod_player'
  return effectivePulseIsLive(input.payload, input.pageIsLive, input.context)
    ? 'channel_live'
    : 'channel_recap'
}

export function pulseSurfaceIsLive(mode: PulseSurfaceMode): boolean {
  return mode === 'channel_live'
}

export function pulseSurfaceCursorSource(mode: PulseSurfaceMode): PulseCursorSource {
  if (mode === 'channel_live') return 'live_edge'
  if (mode === 'vod_player') return 'player_time'
  return 'none'
}

/**
 * The faded ahead-of-now tail was removed across the panel: trend lines stop
 * cleanly at the cursor with no separate "future" stroke. Kept as a no-op so
 * call sites compile and any future per-surface re-introduction is a one-line
 * change.
 */
export function pulseSurfaceShowsFutureFade(_mode: PulseSurfaceMode): boolean {
  return false
}
