import type { AnalyticsStreamDetail, SessionAvailability } from '../apiTypes.ts'

/** Merge a lightweight status poll into the first full timeline shell. */
export function mergeSessionStatusIntoDetail(
  base: AnalyticsStreamDetail,
  status: {
    state?: string
    syncPhase?: string
    vodId?: string
    vodAlignSeconds?: number
    vodDurationSeconds?: number
    analyticsQuality?: string
    chatCoveragePct?: number
    dataCoveragePct?: number
    updatedAt?: number
    availability?: SessionAvailability
    stream?: AnalyticsStreamDetail['stream']
  },
): AnalyticsStreamDetail {
  // A source recheck is atomic: never combine a new/cleared ID with the
  // previous archive's clock. A status without source fields is unrelated.
  const sourceUpdated = Object.prototype.hasOwnProperty.call(status, 'vodId')
  const availability = status.availability
    ? { ...base.availability, ...status.availability }
    : base.availability
  return {
    ...base,
    state: status.state ?? base.state,
    syncPhase: status.syncPhase ?? base.syncPhase,
    vodId: status.vodId ?? base.vodId,
    vodAlignSeconds: sourceUpdated ? status.vodAlignSeconds : base.vodAlignSeconds,
    vodDurationSeconds: sourceUpdated ? status.vodDurationSeconds : base.vodDurationSeconds,
    analyticsQuality: status.analyticsQuality ?? base.analyticsQuality,
    chatCoveragePct: status.chatCoveragePct ?? base.chatCoveragePct,
    updatedAt: status.updatedAt ?? base.updatedAt,
    availability: sourceUpdated && availability ? { ...availability, vodId: status.vodId } : availability,
    stream: status.stream
      ? {
          ...base.stream,
          ...status.stream,
          streamId: base.stream?.streamId ?? status.stream.streamId ?? '',
          vodId: sourceUpdated ? status.vodId : status.stream.vodId ?? base.stream?.vodId,
        }
      : base.stream
        ? { ...base.stream, vodId: status.vodId ?? base.stream.vodId }
        : base.stream,
    rollups: base.rollups,
    momentRollups: base.momentRollups,
    topEmotes: base.topEmotes,
  }
}
