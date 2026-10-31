import { measurementTimeMs } from '@streampulse/pulse-core'
import type { AnalyticsStream } from '../apiTypes.ts'

/**
 * When a stream that has ended ended, for the meta line's "Ended 31h ago" and
 * the first figure's "Viewers at end". Null while the session is live, when the
 * lifecycle says live or unknown, or when no usable end time was recorded; the
 * page then keeps its read time ("Updated 1m ago") as before.
 *
 * Only an hour-level age is ever shown. The exact end time is not measured (see
 * the lifecycle sentence: "exact end time unknown"), so this never feeds a
 * duration or an exact clock time.
 *  - confirmed ended: the confirmed-offline time, else the stored end;
 *  - lifecycle not stated (older rows): the stored end;
 *  - confirmed live, or an explicit unknown: nothing.
 */
export function sessionEndedAtMs(
  stream: Pick<AnalyticsStream, 'endedAt' | 'lifecycleState' | 'lifecycleDetectedAt'> | null | undefined,
  live: boolean,
  nowMs = Date.now(),
): number | null {
  if (live || !stream) return null
  const state = stream.lifecycleState
  if (state === 'confirmed_live' || state === 'unknown') return null
  const stored = measurementTimeMs(stream.endedAt, nowMs)
  if (state === 'confirmed_ended') return measurementTimeMs(stream.lifecycleDetectedAt, nowMs) ?? stored
  return stored
}
