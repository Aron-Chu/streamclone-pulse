import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { findExactHeatPointAtOffset, findHeatPointAtOffset } from './mostReacted.ts'

export function resolvePinnedMomentPoint({
  pinOffsetSeconds,
  heatPoints,
}: {
  pinOffsetSeconds: number | null | undefined
  heatPoints: LiveHeatPoint[]
}): LiveHeatPoint | null {
  if (pinOffsetSeconds == null) return null
  // Only backend-provided heat points carry an authoritative Pulse score.
  // Raw chart rollups may still be inspected in the chart, but never become
  // locally scored moments.
  // List/inspector pins carry an analytical onset when available. Prefer an
  // exact match so nearby moments cannot resolve to the wrong row; retain the
  // fuzzy fallback for chart rollup clicks, which intentionally use a coarse
  // minute anchor.
  return findExactHeatPointAtOffset(heatPoints, pinOffsetSeconds)
    ?? findHeatPointAtOffset(heatPoints, pinOffsetSeconds)
}
