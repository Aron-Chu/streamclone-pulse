/**
 * Why a live channel has no archive VOD yet.
 *
 * Twitch publishes an archive id shortly after a broadcast starts. When one is
 * still missing well into a stream, the likely cause is not latency — it is a
 * channel with archives disabled, sub-only, or otherwise restricted. Telling
 * those viewers to "try again in a few minutes" asks them to wait for something
 * that will never arrive.
 *
 * The distinction is a heuristic, not a fact we can read from Twitch, so the
 * copy must stay hedged.
 */

/** Past this, "still publishing" stops being a credible explanation. */
export const LIVE_ARCHIVE_HEURISTIC_MIN_ELAPSED_SECONDS = 10 * 60

export type LiveArchiveAvailability = 'too_early' | 'likely_restricted'

export function resolveLiveArchiveAvailability(input: {
  /** Seconds since the broadcast started (Pulse live offset). */
  elapsedSeconds: number | null | undefined
  /** True if any archive id or archive link has been observed for this stream. */
  hasArchiveEvidence: boolean
}): LiveArchiveAvailability {
  if (input.hasArchiveEvidence) return 'too_early'
  const elapsed = input.elapsedSeconds
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed)) return 'too_early'
  return elapsed >= LIVE_ARCHIVE_HEURISTIC_MIN_ELAPSED_SECONDS ? 'likely_restricted' : 'too_early'
}

export function liveArchiveAbsenceMessage(availability: LiveArchiveAvailability): string {
  return availability === 'likely_restricted'
    ? 'No live archive is available. This channel may have VODs disabled or restricted.'
    : 'Twitch has not published a VOD id for this stream yet — try again after a few minutes or when the stream ends.'
}
