/**
 * Twitch archive VODs do not always begin at the instant the stream did: the
 * recorder can start late, and re-runs/reconnects shift the archive origin.
 * The backend reports that skew as
 *
 *   originDeltaSeconds = vod.startedAt - stream.startedAt
 *
 * Pulse moments are addressed in *stream* offsets. Ignoring the delta — which is
 * what every jump did before this module existed — lands the viewer
 * `originDeltaSeconds` away from the moment they clicked, systematically, on
 * every affected stream.
 */

/** Deltas beyond this are not plausible recorder skew; treat them as corrupt. */
export const MAX_ORIGIN_DELTA_SECONDS = 6 * 60 * 60

export type VodOriginAlignmentReason = 'not_finite' | 'not_integer' | 'out_of_range'

export type VodOriginAlignment =
  | { kind: 'aligned'; originDeltaSeconds: number }
  | { kind: 'unavailable'; reason: VodOriginAlignmentReason }

/**
 * An absent delta is the identity mapping: the archive is assumed to start with
 * the stream. A *present but unusable* delta is never silently coerced to zero —
 * that would forge alignment the backend did not assert.
 */
export function resolveVodOriginAlignment(raw: unknown): VodOriginAlignment {
  if (raw == null) return { kind: 'aligned', originDeltaSeconds: 0 }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { kind: 'unavailable', reason: 'not_finite' }
  }
  if (!Number.isInteger(raw)) return { kind: 'unavailable', reason: 'not_integer' }
  if (Math.abs(raw) > MAX_ORIGIN_DELTA_SECONDS) {
    return { kind: 'unavailable', reason: 'out_of_range' }
  }
  return { kind: 'aligned', originDeltaSeconds: raw }
}

export function isVodOriginAligned(
  alignment: VodOriginAlignment,
): alignment is { kind: 'aligned'; originDeltaSeconds: number } {
  return alignment.kind === 'aligned'
}

/** Stream offset (Pulse moment address) -> position to seek to inside the VOD. */
export function vodOffsetForStreamOffset(
  streamOffsetSeconds: number,
  alignment: VodOriginAlignment,
): number | null {
  if (!isVodOriginAligned(alignment)) return null
  if (!Number.isFinite(streamOffsetSeconds)) return null
  return Math.max(0, Math.floor(streamOffsetSeconds) - alignment.originDeltaSeconds)
}

/** VOD player time -> stream offset, for locating the playhead on a Pulse chart. */
export function streamOffsetForVodTime(
  vodTimeSeconds: number,
  alignment: VodOriginAlignment,
): number | null {
  if (!isVodOriginAligned(alignment)) return null
  if (!Number.isFinite(vodTimeSeconds)) return null
  return Math.max(0, Math.floor(vodTimeSeconds) + alignment.originDeltaSeconds)
}
