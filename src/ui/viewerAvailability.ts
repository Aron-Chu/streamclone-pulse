export type ViewerAvailability = 'visible' | 'historical' | 'paused' | 'absent'

export interface ViewerAvailabilityInput {
  sampleCount: number
  samplesInRange: number
  isLive: boolean
  latestSampleOffsetSeconds?: number | null
  currentOffsetSeconds?: number | null
  pauseThresholdSeconds?: number
}

/**
 * Classify the viewer timeline without treating a headline viewer snapshot as
 * a sampled point. Gaps remain data gaps; this helper only describes what the
 * client can honestly render.
 */
export function classifyViewerAvailability({
  sampleCount,
  samplesInRange,
  isLive,
  latestSampleOffsetSeconds = null,
  currentOffsetSeconds = null,
  pauseThresholdSeconds = 120,
}: ViewerAvailabilityInput): ViewerAvailability {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 'absent'
  if (!Number.isFinite(samplesInRange) || samplesInRange <= 0) return 'historical'
  if (
    isLive
    && Number.isFinite(latestSampleOffsetSeconds)
    && Number.isFinite(currentOffsetSeconds)
    && (latestSampleOffsetSeconds ?? 0) < (currentOffsetSeconds ?? 0) - pauseThresholdSeconds
  ) {
    return 'paused'
  }
  return 'visible'
}
