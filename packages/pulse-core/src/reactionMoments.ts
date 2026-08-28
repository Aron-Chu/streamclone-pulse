/**
 * Canonical reaction moment contract shared by the portal and extension.
 *
 * `offsetSeconds` is the coarse source bucket kept for compatibility.  The
 * onset/apex/seek fields are optional because a minute-level heatmap can be
 * produced without persisted VOD message features.  Consumers must use the
 * precision/status fields to describe that fallback honestly.
 */
export interface ReactionMoment {
  offsetSeconds: number
  durationSeconds?: number
  score?: number
  compositeScore?: number
  reactionScore?: number
  viewerMomentumScore?: number
  confidence?: number
  reactionOnsetOffsetSeconds?: number
  reactionApexOffsetSeconds?: number
  seekOffsetSeconds?: number
  precisionSeconds?: number
  refinementStatus?: string
  refinementConfidence?: number
  reactionScoringVersion?: string
  reason?: string
  reasonLabel?: string
  reasons?: string[]
}

export interface ReactionMomentWindow {
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegative(value: unknown, fallback = 0): number {
  return finite(value) ? Math.max(0, Math.round(value)) : fallback
}

/** Reaction-only rank, with the legacy score as a backwards-compatible fallback. */
export function reactionMomentScore(moment: ReactionMoment): number {
  const value = finite(moment.reactionScore) ? moment.reactionScore! : moment.score
  return finite(value) ? Math.max(0, Math.min(100, value)) : 0
}

/** Canonical playback target. This is intentionally separate from the apex. */
export function reactionMomentSeekOffset(moment: ReactionMoment): number {
  return nonNegative(moment.seekOffsetSeconds, nonNegative(moment.offsetSeconds))
}

export function reactionMomentIsRefined(moment: ReactionMoment): boolean {
  return moment.refinementStatus === 'refined'
    && finite(moment.reactionOnsetOffsetSeconds)
    && finite(moment.reactionApexOffsetSeconds)
    && finite(moment.precisionSeconds)
    && moment.precisionSeconds! > 0
    && moment.precisionSeconds! < 60
}

/** User-facing reason without trusting arbitrary display markup. */
export function reactionMomentReason(moment: ReactionMoment): string {
  return String(moment.reasonLabel ?? moment.reason ?? moment.reasons?.[0] ?? 'reaction').trim() || 'reaction'
}

/**
 * Derive the visible interval without inventing second-level precision.
 * Refined equal onset/apex points receive their declared precision as width;
 * coarse/unavailable points retain the canonical minute window.
 */
export function reactionMomentWindow(moment: ReactionMoment): ReactionMomentWindow {
  const coarseStart = nonNegative(moment.offsetSeconds)
  const coarseDuration = Math.max(1, nonNegative(moment.durationSeconds, 60))
  if (!reactionMomentIsRefined(moment)) {
    return { startSeconds: coarseStart, endSeconds: coarseStart + coarseDuration, durationSeconds: coarseDuration }
  }

  const start = nonNegative(moment.reactionOnsetOffsetSeconds, coarseStart)
  const apex = Math.max(start, nonNegative(moment.reactionApexOffsetSeconds, start))
  const precision = Math.max(1, nonNegative(moment.precisionSeconds, 1))
  const end = Math.max(start + precision, apex + precision)
  return { startSeconds: start, endSeconds: end, durationSeconds: end - start }
}

export function reactionMomentFromHeatmapPoint(point: ReactionMoment): ReactionMoment {
  return sanitizeReactionMoment({ ...point, refinementStatus: point.refinementStatus ?? 'unavailable' })
}

export function reactionMomentFromExtensionPeak(peak: ReactionMoment): ReactionMoment {
  return sanitizeReactionMoment({ ...peak })
}

export function reactionMomentFromRecapMoment(moment: ReactionMoment): ReactionMoment {
  return sanitizeReactionMoment({ ...moment })
}

/** Clamp untrusted response numbers before they reach SVG geometry or seeking. */
export function sanitizeReactionMoment(moment: ReactionMoment): ReactionMoment {
  const copy: ReactionMoment = { ...moment }
  copy.offsetSeconds = nonNegative(copy.offsetSeconds)
  if (finite(copy.durationSeconds)) copy.durationSeconds = Math.min(3600, Math.max(1, copy.durationSeconds!))
  if (finite(copy.score)) copy.score = Math.max(0, Math.min(100, copy.score!))
  if (finite(copy.compositeScore)) copy.compositeScore = Math.max(0, Math.min(100, copy.compositeScore!))
  if (finite(copy.reactionScore)) copy.reactionScore = Math.max(0, Math.min(100, copy.reactionScore!))
  if (finite(copy.viewerMomentumScore)) copy.viewerMomentumScore = Math.max(0, Math.min(100, copy.viewerMomentumScore!))
  if (finite(copy.confidence)) copy.confidence = Math.max(0, Math.min(1, copy.confidence!))
  if (finite(copy.refinementConfidence)) copy.refinementConfidence = Math.max(0, Math.min(1, copy.refinementConfidence!))
  if (finite(copy.reactionOnsetOffsetSeconds)) copy.reactionOnsetOffsetSeconds = nonNegative(copy.reactionOnsetOffsetSeconds)
  if (finite(copy.reactionApexOffsetSeconds)) copy.reactionApexOffsetSeconds = nonNegative(copy.reactionApexOffsetSeconds)
  if (finite(copy.seekOffsetSeconds)) copy.seekOffsetSeconds = nonNegative(copy.seekOffsetSeconds)
  if (finite(copy.precisionSeconds)) copy.precisionSeconds = Math.min(3600, Math.max(0, Math.round(copy.precisionSeconds!)))
  copy.reason = copy.reason?.slice(0, 160)
  copy.reasonLabel = copy.reasonLabel?.slice(0, 160)
  copy.reasons = copy.reasons?.slice(0, 8).map(reason => String(reason).slice(0, 160))
  return copy
}
