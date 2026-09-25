import { mergeRecapMoments, recapMomentAnalyticalOffset, type RecapMomentLike } from '@streampulse/pulse-core'
import type { BroadcastGroup } from './broadcastGroups'
import type { DiscoveryMoment } from './discoveryMoments'
import type { PortalStreamRecapResponse } from './streamcloneAnalytics'

/** What the recap endpoint itself returns per stream. Not a locally chosen page size. */
export const TOP_MOMENTS_PER_BROADCAST = 20
/** The tolerance pulse-core already uses to decide two recap moments are one moment. */
export const RANK_MATCH_TOLERANCE_SECONDS = 60

export interface RankedMoment {
  moment: DiscoveryMoment
  /**
   * Position in the server's ranking, or `null` when no server ranking was
   * available. Never render a number for a `null` rank: the row order is then
   * only time, and numbering it would claim a strength ordering that no one
   * computed.
   */
  rank: number | null
  /** The server also nominated this minute as a clip candidate. */
  clipCandidate: boolean
}

export interface BroadcastRanking {
  /**
   * `server_score` — rows are the backend's ranked top moments for this exact
   * broadcast. `time_fallback` — no usable recap, so rows are simply the first
   * loaded detections in stream order and must not be labelled "top".
   */
  ordering: 'server_score' | 'time_fallback'
  ranked: RankedMoment[]
  /** Loaded detections outside the shown set, in stream order. */
  remainder: DiscoveryMoment[]
}

function recapMatchesBroadcast(
  recap: PortalStreamRecapResponse | null | undefined,
  group: BroadcastGroup,
): recap is PortalStreamRecapResponse {
  // Never rank one broadcast by another broadcast's recap.
  return Boolean(
    recap &&
      recap.streamId === group.streamId &&
      typeof recap.login === 'string' &&
      recap.login.toLowerCase() === group.login,
  )
}

function hasReactionCoverage(recap: PortalStreamRecapResponse): boolean {
  return [...(recap.topMoments ?? []), ...(recap.clipCandidates ?? [])].some(
    moment => (moment.chatCount ?? 0) > 0 || (moment.emoteCount ?? 0) > 0,
  )
}

/** Nearest loaded detection to a ranked minute, within the dedupe tolerance. */
function nearestLoadedMoment(
  moments: readonly DiscoveryMoment[],
  used: ReadonlySet<string>,
  offsetSeconds: number,
): DiscoveryMoment | null {
  let best: DiscoveryMoment | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const moment of moments) {
    if (used.has(moment.key)) continue
    const delta = Math.abs(moment.offsetSeconds - offsetSeconds)
    if (delta <= RANK_MATCH_TOLERANCE_SECONDS && delta < bestDelta) {
      best = moment
      bestDelta = delta
    }
  }
  return best
}

function candidateOffsets(recap: PortalStreamRecapResponse): number[] {
  return (recap.clipCandidates ?? []).map(candidate => recapMomentAnalyticalOffset(candidate as RecapMomentLike))
}

/**
 * The rows to show for one broadcast, and everything held back.
 *
 * A stored day can hold a hundred detections for a single broadcast, and every
 * adjacent minute of a busy stretch is its own detection. The backend already
 * ranks and de-duplicates them — `/streams/:id/recap` returns its own top set
 * with a score per minute — so this joins that ranking onto the detections that
 * are actually loaded instead of inventing a client-side one.
 *
 * Nothing here scores, clusters or re-baselines anything. A ranked minute with
 * no loaded detection is skipped rather than fabricated, and ranks stay dense so
 * the list never shows an unexplained gap.
 */
export function rankBroadcastMoments(
  group: BroadcastGroup,
  recap: PortalStreamRecapResponse | null | undefined,
  limit = TOP_MOMENTS_PER_BROADCAST,
): BroadcastRanking {
  const cap = Math.max(0, Math.floor(limit))
  if (recapMatchesBroadcast(recap, group)) {
    const merged = mergeRecapMoments(
      { topMoments: recap.topMoments as RecapMomentLike[] | undefined, clipCandidates: recap.clipCandidates as RecapMomentLike[] | undefined },
      undefined,
      cap,
      hasReactionCoverage(recap),
    )
    const candidates = candidateOffsets(recap)
    const used = new Set<string>()
    const ranked: RankedMoment[] = []
    for (const recapMoment of merged) {
      const offsetSeconds = recapMomentAnalyticalOffset(recapMoment)
      const moment = nearestLoadedMoment(group.moments, used, offsetSeconds)
      if (!moment) continue
      used.add(moment.key)
      ranked.push({
        moment,
        rank: ranked.length + 1,
        clipCandidate: candidates.some(
          candidate => Math.abs(candidate - moment.offsetSeconds) <= RANK_MATCH_TOLERANCE_SECONDS,
        ),
      })
      if (ranked.length >= cap) break
    }
    if (ranked.length) {
      return {
        ordering: 'server_score',
        ranked,
        remainder: group.moments.filter(moment => !used.has(moment.key)),
      }
    }
  }
  // No usable ranking: show the opening detections in stream order and say so.
  return {
    ordering: 'time_fallback',
    ranked: group.moments.slice(0, cap).map(moment => ({ moment, rank: null, clipCandidate: false })),
    remainder: group.moments.slice(cap),
  }
}
