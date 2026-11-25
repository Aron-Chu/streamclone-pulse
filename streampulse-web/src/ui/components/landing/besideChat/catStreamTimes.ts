/**
 * The made-up stream in the front page's "beside Twitch chat" demo: a cat streaming itself on its phone from a store
 * shelf. Stream seconds the scene, the clock and the panel pictures all agree on. Kept apart from the three.js scene
 * so the demo can use them without loading it.
 */

/** The stream is three hours long (the panel's "3h 0m"). */
export const STREAM_SECONDS = 3 * 3600

/** The demo opens at 0:02:00, when the cat pushes one can off the shelf and chat floods. */
export const OPEN_S = 120
/** The can tips over the shelf edge. */
export const KNOCK_S = 120.68

/** Jump in VOD lands five seconds before the moment (1:36:55)... */
export const LAND_S = 5815
/** ...which is 1:37:00, when the cat shoves the can pyramid over. */
export const MOMENT_S = 5820
/** The shove starts the pyramid's fall, a moment before the peak second. */
export const SHOVE_S = 5819.78

/** The frame each step shows when picked by hand, or with reduced motion: the falling can, then the setup before the jump's moment. */
export const STILL_VT = [120.78, 120.78, 120.78, 120.78, LAND_S] as const

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
