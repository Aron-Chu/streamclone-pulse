import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { findHeatPointAtOffset } from './mostReacted.ts'

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
  return findHeatPointAtOffset(heatPoints, pinOffsetSeconds)
}
