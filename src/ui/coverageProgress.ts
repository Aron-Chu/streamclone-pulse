/** Progress presentation for CoverageCard — never invent a fake percent. */
export type CoverageProgressPresentation =
  | { kind: 'none' }
  | { kind: 'determinate'; percent: number }
  | { kind: 'indeterminate_shimmer' }
  | { kind: 'indeterminate_static' }

export function coverageProgressPresentation(input: {
  showBar: boolean
  percent?: number | null
  reducedMotion: boolean
}): CoverageProgressPresentation {
  if (!input.showBar) return { kind: 'none' }
  const pct = input.percent
  if (typeof pct === 'number' && pct > 0) {
    return { kind: 'determinate', percent: Math.min(100, pct) }
  }
  // Unknown progress: shimmer when motion is ok; empty static track when reduced.
  // Never a fake 35% (or any) fill.
  if (input.reducedMotion) return { kind: 'indeterminate_static' }
  return { kind: 'indeterminate_shimmer' }
}
