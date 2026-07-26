import type { AnalyticsStreamDetail, SessionAvailability } from '../apiTypes.ts'

/** Merge lightweight /status (or sparse) poll into the first full timeline shell. */
export function mergeSessionStatusIntoDetail(
  base: AnalyticsStreamDetail,
  status: {
    state?: string
    syncPhase?: string
    vodId?: string
    analyticsQuality?: string
    chatCoveragePct?: number
    updatedAt?: number
    availability?: SessionAvailability
    stream?: AnalyticsStreamDetail['stream']
  },
): AnalyticsStreamDetail {
  return {
    ...base,
    state: status.state ?? base.state,
    syncPhase: status.syncPhase ?? base.syncPhase,
    vodId: status.vodId ?? base.vodId,
    analyticsQuality: status.analyticsQuality ?? base.analyticsQuality,
    chatCoveragePct: status.chatCoveragePct ?? base.chatCoveragePct,
    updatedAt: status.updatedAt ?? base.updatedAt,
    availability: status.availability ?? base.availability,
    stream: status.stream
      ? { ...base.stream, ...status.stream, streamId: base.stream?.streamId ?? status.stream.streamId ?? '' }
      : base.stream
        ? { ...base.stream, vodId: status.vodId ?? base.stream.vodId }
        : base.stream,
    rollups: base.rollups,
    momentRollups: base.momentRollups,
    topEmotes: base.topEmotes,
  }
}
