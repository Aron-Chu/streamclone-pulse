import type { ExtensionRollup } from '../shared/messages.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'

export const SEGMENT_CHART_MAX_BARS = 64
export const SEGMENT_CHART_MIN_BAR_PX = 4

export interface ChartSegmentBucket {
  bucketIndex: number
  startOffset: number
  endOffset: number
  centerOffset: number
  chatPeak: number
  emotePeak: number
  /** Index into the source rollup array for the highest-activity minute in this bucket. */
  rollupIndex: number
}

export function rollupActivityScore(rollup: ExtensionRollup): number {
  const chat = rollup.chatCount ?? 0
  const emotes = minuteEmoteTotal(rollup)
  return chat * 1000 + emotes * 100
}

export function maxBarsForWidth(plotWidthPx: number, cap = SEGMENT_CHART_MAX_BARS): number {
  if (plotWidthPx <= 0) return Math.min(24, cap)
  const byWidth = Math.floor(plotWidthPx / SEGMENT_CHART_MIN_BAR_PX)
  return Math.max(24, Math.min(cap, byWidth))
}

/** Peak chat + emote per time bucket (portal chatBarsForChart style). */
export function bucketRollupsForChart(
  rollups: ExtensionRollup[],
  options?: { maxBars?: number; plotWidthPx?: number },
): ChartSegmentBucket[] {
  if (rollups.length === 0) return []

  const cap = options?.maxBars ?? maxBarsForWidth(options?.plotWidthPx ?? 320)
  const n = rollups.length

  if (n <= cap) {
    return rollups.map((rollup, index) => ({
      bucketIndex: index,
      startOffset: rollup.offsetSeconds,
      endOffset: rollup.offsetSeconds + 60,
      centerOffset: rollup.offsetSeconds,
      chatPeak: rollup.chatCount ?? 0,
      emotePeak: minuteEmoteTotal(rollup),
      rollupIndex: index,
    }))
  }

  const bucketSize = n / cap
  const out: ChartSegmentBucket[] = []
  for (let bucket = 0; bucket < cap; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(n, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue

    let chatPeak = 0
    let emotePeak = 0
    let bestIndex = start
    let bestScore = -1
    for (let i = start; i < end; i += 1) {
      const rollup = rollups[i]!
      const chat = rollup.chatCount ?? 0
      const emotes = minuteEmoteTotal(rollup)
      if (chat > chatPeak) chatPeak = chat
      if (emotes > emotePeak) emotePeak = emotes
      const score = rollupActivityScore(rollup)
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    const first = rollups[start]!
    const last = rollups[end - 1]!
    const center = rollups[bestIndex]!
    out.push({
      bucketIndex: out.length,
      startOffset: first.offsetSeconds,
      endOffset: last.offsetSeconds + 60,
      centerOffset: center.offsetSeconds,
      chatPeak,
      emotePeak,
      rollupIndex: bestIndex,
    })
  }
  return out
}

export function streamPeakFromBuckets(buckets: ChartSegmentBucket[]): {
  peakChat: number
  peakEmotes: number
} {
  let peakChat = 0
  let peakEmotes = 0
  for (const bucket of buckets) {
    peakChat = Math.max(peakChat, bucket.chatPeak)
    peakEmotes = Math.max(peakEmotes, bucket.emotePeak)
  }
  return { peakChat, peakEmotes }
}
