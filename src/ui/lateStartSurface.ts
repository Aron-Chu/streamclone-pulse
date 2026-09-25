/**
 * Late-start presentation ownership (Overlay P0).
 * CoverageCard is the single authoritative surface for late-start / missing-prefix /
 * unknown coverage / coverage CTA. Chart may only show a factual plotted-range label.
 */

export type LateStartSurface = 'coverage_card' | 'chart_range_label' | 'none'

export function lateStartPresentationOwner(input: {
  coverageStartOffsetSeconds?: number
  hasBackendCoverageTruth?: boolean
  shouldShowCoverageCard?: boolean
}): LateStartSurface {
  const start = Math.max(0, input.coverageStartOffsetSeconds ?? 0)
  const late = start > 120
  if (!late && !input.shouldShowCoverageCard) return 'none'
  if (input.shouldShowCoverageCard) return 'coverage_card'
  if (late) return 'coverage_card'
  return 'none'
}

/** Chart / LiveStatsBand must not emit a second late-start story. */
export function chartMayEmitLateStartNarrative(owner: LateStartSurface): boolean {
  return false
}

/** Factual range label only — not a late-start explanation. */
export function plottedRangeLabel(input: {
  fullTimelineState: 'recent' | 'full_loading' | 'full_loaded' | 'full_error'
  recentWindowMinutes?: number
}): string | null {
  if (input.fullTimelineState === 'full_loaded') return null
  const n = input.recentWindowMinutes ?? 0
  if (n <= 0) return 'Recent window'
  return `Recent ${n} minutes`
}
