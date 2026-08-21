export const OBSERVED_PREFIX_THRESHOLD_SEC = 120

export interface ObservedRollup {
  offsetSeconds: number
  missing?: boolean
}

export interface ObservedViewport {
  startSeconds: number
  endSeconds: number
}

export function firstObservedOffsetSeconds(rollups: ObservedRollup[]): number | null {
  const first = rollups.find((rollup) => rollup.missing !== true)
  return first ? Math.max(0, first.offsetSeconds) : null
}

export function shouldApplyObservedInitialViewport(opts: {
  missingPrefixSeconds: number
  userHasNavigated: boolean
  alreadyAppliedForStream: boolean
}): boolean {
  return (
    opts.missingPrefixSeconds >= OBSERVED_PREFIX_THRESHOLD_SEC
    && !opts.userHasNavigated
    && !opts.alreadyAppliedForStream
  )
}

export function observedViewport(
  rollups: ObservedRollup[],
  timelineEndSeconds: number,
): ObservedViewport {
  return {
    startSeconds: firstObservedOffsetSeconds(rollups) ?? 0,
    endSeconds: Math.max(0, timelineEndSeconds),
  }
}

export function fullStreamWithGapsViewport(
  timelineEndSeconds: number,
): ObservedViewport {
  return {
    startSeconds: 0,
    endSeconds: Math.max(0, timelineEndSeconds),
  }
}
