import { displayMomentReasonLabel } from "./momentScore.ts";
import { reactionAnalyticalOffset } from "./reactionIdentity.ts";
import {
  compareStreamEdgeLast,
  momentStreamEdge,
  OPENING_STREAM_EDGE,
  type StreamEdges,
} from "./streamEdges.ts";

export interface RecapMomentLike {
  offsetSeconds: number;
  score: number;
  compositeScore?: number;
  reactionScore?: number;
  viewerMomentumScore?: number;
  reactionOnsetOffsetSeconds?: number;
  reactionApexOffsetSeconds?: number;
  seekOffsetSeconds?: number;
  precisionSeconds?: number;
  refinementStatus?: string;
  refinementConfidence?: number;
  reactionScoringVersion?: string;
  reasons?: string[];
  chatCount?: number;
  emoteCount?: number;
  topEmotes?: Array<{ code: string; count: number; provider?: string }>;
  /** "opening" / "closing" for hello / goodbye spam, ranked last (see streamEdges.ts). */
  streamEdge?: string;
}

export interface RecapPeakLike {
  offsetSeconds: number;
  seekOffsetSeconds?: number;
  score: number;
  compositeScore?: number;
  reactionScore?: number;
  viewerMomentumScore?: number;
  reactionOnsetOffsetSeconds?: number;
  reactionApexOffsetSeconds?: number;
  precisionSeconds?: number;
  refinementStatus?: string;
  refinementConfidence?: number;
  reactionScoringVersion?: string;
  reasons?: string[];
  chatCount?: number;
  emoteCount?: number;
  topEmotes?: Array<{ name: string; count: number; provider?: string }>;
  streamEdge?: string;
}

const MOMENT_DEDUPE_TOLERANCE_SECONDS = 60;
const REFINED_MOMENT_DEDUPE_TOLERANCE_SECONDS = 12;

function momentIsRefined(moment: RecapMomentLike): boolean {
  return (
    moment.refinementStatus === "refined" &&
    Number.isFinite(moment.precisionSeconds) &&
    (moment.precisionSeconds ?? 60) < MOMENT_DEDUPE_TOLERANCE_SECONDS
  );
}

function momentDedupeTolerance(a: RecapMomentLike, b: RecapMomentLike): number {
  return momentIsRefined(a) && momentIsRefined(b)
    ? REFINED_MOMENT_DEDUPE_TOLERANCE_SECONDS
    : MOMENT_DEDUPE_TOLERANCE_SECONDS;
}

/** Canonical user-facing playback target for a recap candidate. */
export function recapMomentSeekOffset(moment: {
  offsetSeconds: number;
  seekOffsetSeconds?: number;
}): number {
  return Number.isFinite(moment.seekOffsetSeconds)
    ? Math.max(0, Math.round(moment.seekOffsetSeconds!))
    : Math.max(0, Math.round(moment.offsetSeconds));
}

/** Canonical analytical identity for recap ranking, matching, and dedupe. */
export function recapMomentAnalyticalOffset(
  moment: RecapMomentLike,
): number {
  return reactionAnalyticalOffset(moment);
}

function momentHasReactionData(moment: RecapMomentLike): boolean {
  return (moment.chatCount ?? 0) > 0 || (moment.emoteCount ?? 0) > 0;
}

function streamHasReactionCoverage(hasReactionCoverage?: boolean): boolean {
  return hasReactionCoverage ?? false;
}

function compareMomentRank(
  a: RecapMomentLike,
  b: RecapMomentLike,
  hasReactionCoverage: boolean,
): number {
  if (hasReactionCoverage) {
    const rankA = momentHasReactionData(a) ? 0 : 1;
    const rankB = momentHasReactionData(b) ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
  }
  // Hello / goodbye spam at the stream's edges ranks after every other moment.
  const edge = compareStreamEdgeLast(a, b);
  if (edge !== 0) return edge;
  const rankScoreA = Number.isFinite(a.reactionScore)
    ? (a.reactionScore ?? 0)
    : a.score;
  const rankScoreB = Number.isFinite(b.reactionScore)
    ? (b.reactionScore ?? 0)
    : b.score;
  if (rankScoreA !== rankScoreB) return rankScoreB - rankScoreA;
  return recapMomentAnalyticalOffset(a) - recapMomentAnalyticalOffset(b);
}

function sortMomentsByRank(
  moments: RecapMomentLike[],
  hasReactionCoverage: boolean,
): RecapMomentLike[] {
  return [...moments].sort((a, b) =>
    compareMomentRank(a, b, hasReactionCoverage),
  );
}

/**
 * Merge recap moments, clip candidates, and optional peaks into one ranked list.
 *
 * Each moment is tagged with its stream edge: the backend's flag, else from
 * `edges` (the opening edge alone unless the caller knows the stream ended).
 */
export function mergeRecapMoments(
  recap:
    | {
        topMoments?: readonly RecapMomentLike[];
        clipCandidates?: readonly RecapMomentLike[];
      }
    | null
    | undefined,
  peaks: readonly RecapPeakLike[] | undefined,
  limit = 20,
  hasReactionCoverage = false,
  edges: StreamEdges = OPENING_STREAM_EDGE,
): RecapMomentLike[] {
  const candidates: RecapMomentLike[] = [];
  const push = (moment: RecapMomentLike) => {
    const streamEdge = momentStreamEdge(moment, edges);
    candidates.push(
      streamEdge === moment.streamEdge ? moment : { ...moment, streamEdge },
    );
  };
  for (const moment of recap?.topMoments ?? []) {
    push(moment);
  }
  for (const moment of recap?.clipCandidates ?? []) {
    push(moment);
  }
  for (const peak of peaks ?? []) {
    push({
      offsetSeconds: Math.max(0, Math.round(peak.offsetSeconds)),
      score: peak.score,
      compositeScore: peak.compositeScore,
      reactionScore: peak.reactionScore,
      viewerMomentumScore: peak.viewerMomentumScore,
      reactionOnsetOffsetSeconds: peak.reactionOnsetOffsetSeconds,
      reactionApexOffsetSeconds: peak.reactionApexOffsetSeconds,
      seekOffsetSeconds: Number.isFinite(peak.seekOffsetSeconds)
        ? Math.max(0, Math.round(peak.seekOffsetSeconds!))
        : undefined,
      precisionSeconds: peak.precisionSeconds,
      refinementStatus: peak.refinementStatus,
      refinementConfidence: peak.refinementConfidence,
      reactionScoringVersion: peak.reactionScoringVersion,
      reasons: peak.reasons,
      chatCount: peak.chatCount,
      emoteCount: peak.emoteCount,
      topEmotes: peak.topEmotes?.map((emote) => ({
        code: emote.name,
        count: emote.count,
        provider: emote.provider,
      })),
      streamEdge: peak.streamEdge,
    });
  }

  candidates.sort((a, b) =>
    compareMomentRank(a, b, streamHasReactionCoverage(hasReactionCoverage)),
  );
  const merged: RecapMomentLike[] = [];
  for (const moment of candidates) {
    const duplicate = merged.find(
      (existing) =>
        Math.abs(
          recapMomentAnalyticalOffset(existing) -
            recapMomentAnalyticalOffset(moment),
        ) <=
        momentDedupeTolerance(existing, moment),
    );
    if (duplicate) {
      // One moment seen twice (recap, clip candidate, peak or heatmap point):
      // keep the edge flag from whichever copy carries it.
      const streamEdge = duplicate.streamEdge ?? moment.streamEdge;
      const index = merged.indexOf(duplicate);
      if (
        compareMomentRank(
          moment,
          duplicate,
          streamHasReactionCoverage(hasReactionCoverage),
        ) < 0
      ) {
        merged[index] = moment;
      }
      if (streamEdge && merged[index].streamEdge !== streamEdge) {
        merged[index] = { ...merged[index], streamEdge };
      }
      continue;
    }
    merged.push(moment);
    if (merged.length >= limit) break;
  }
  return sortMomentsByRank(
    merged,
    streamHasReactionCoverage(hasReactionCoverage),
  );
}

export function recapMomentReasonLabel(moment: RecapMomentLike): string {
  const reason = moment.reasons?.[0] ?? "";
  return displayMomentReasonLabel(reason);
}
