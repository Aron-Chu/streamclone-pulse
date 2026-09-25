export * from './liveHeat.ts'
export * from './liveStats.ts'
export * from './extensionAdapters.ts'
export * from './vodDeepLink.ts'
export * from './momentRef.ts'
export * from './momentScoring.ts'
export * from './momentScore.ts'
export * from './portalHeatmapMoments.ts'
export * from './momentActivityLine.ts'
export * from './emoteImageUrl.ts'
export * from './emoteKey.ts'
export * from './vodId.ts'
export * from './momentTime.ts'
export * from './recapMoments.ts'
export * from './reactionMoments.ts'
export * from './reactionIdentity.ts'
export type * from './types/heatmap.ts'

/** Measurement timestamps are modern UTC instants, not Go zero times or scheduled events. */
export function measurementTimeMs(value: unknown, nowMs = Date.now()): number | null {
  const timestamp = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN
  // Five minutes tolerates source clock skew without turning future events into "just now".
  return Number.isFinite(timestamp) && timestamp >= Date.UTC(2000, 0, 1)
    && timestamp <= nowMs + 5 * 60_000 ? timestamp : null
}

export function measurementTimeIso(value: unknown, nowMs = Date.now()): string | undefined {
  const timestamp = measurementTimeMs(value, nowMs)
  return timestamp == null ? undefined : new Date(timestamp).toISOString()
}

/** A rounded label must not claim complete coverage for an incomplete value. */
export function formatCoveragePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100) return 'Unknown'
  return `${value === 100 ? 100 : Math.floor(value * 10) / 10}%`
}
