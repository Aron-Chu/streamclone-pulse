import type { AnalyticsMinuteRollup, AnalyticsStreamDetail } from '../apiTypes.ts'
import { rollupOffsetSeconds } from './momentSelection.ts'

/** Append/replace rollups from a live-tail minutes response without resetting the chart. */
export function mergeMinutesTailIntoDetail(
  base: AnalyticsStreamDetail,
  tail: Pick<AnalyticsStreamDetail, 'rollups' | 'topEmotes' | 'updatedAt'> | null | undefined,
): AnalyticsStreamDetail {
  if (!tail?.rollups?.length) return base
  const startedAt = base.stream?.startedAt
  const byOffset = new Map<number, AnalyticsMinuteRollup>()
  for (const row of base.rollups ?? []) {
    const offset = rollupOffsetSeconds(row, startedAt)
    if (Number.isFinite(offset)) byOffset.set(offset, row)
  }
  for (const row of tail.rollups) {
    const offset = rollupOffsetSeconds(row, startedAt)
    if (!Number.isFinite(offset)) continue
    byOffset.set(offset, row)
  }
  const rollups = Array.from(byOffset.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
  const topByKey = new Map((base.topEmotes ?? []).map((e) => [e.key ?? e.name, e]))
  for (const e of tail.topEmotes ?? []) {
    topByKey.set(e.key ?? e.name, e)
  }
  return {
    ...base,
    rollups,
    topEmotes: Array.from(topByKey.values()),
    updatedAt: tail.updatedAt ?? base.updatedAt,
  }
}

export function maxRollupOffsetSeconds(detail: AnalyticsStreamDetail | undefined | null): number {
  let max = -1
  const startedAt = detail?.stream?.startedAt
  for (const row of detail?.rollups ?? []) {
    const offset = rollupOffsetSeconds(row, startedAt)
    if (Number.isFinite(offset) && offset > max) max = offset
  }
  return max
}
