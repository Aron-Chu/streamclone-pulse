import { formatMomentClock, formatMomentOffset, momentClockDisplay, type MomentClockDisplay } from '@streampulse/pulse-core'

/**
 * Time into the stream, h:mm:ss like the Twitch player (0:45:00, 1:30:00).
 * One formatter for the site and the extension (K1, 11-13): pulse-core's.
 */
export function formatStreamOffset(seconds: number): string {
  return formatMomentOffset(seconds)
}

/**
 * A moment row's time into the stream. The site's moments know only their
 * minute, so the clock is the minute's start with a quiet 'about' (K1).
 */
export function momentRowClock(offsetSeconds: number): MomentClockDisplay {
  return momentClockDisplay({ offsetSeconds })
}

/** The same clock as one string: 'about 0:42:00'. */
export function momentRowClockText(offsetSeconds: number): string {
  return formatMomentClock({ offsetSeconds })
}
