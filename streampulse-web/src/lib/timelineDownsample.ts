/** Portal minutes for long streams can be 1k+ points — cap chart render density. */
export const PORTAL_CHART_MAX_POINTS = 240

// The minutes payload for a long stream can be MB-scale and slow. A 120s timeout
// meant a slow minutes response could block the whole session detail for two
// minutes. Lower it so a slow minutes fetch degrades gracefully (~<15s) instead
// of freezing the header/chart load.
export const PORTAL_MINUTES_TIMEOUT_MS = 15_000

function uniformDownsample<T>(items: T[], maxPoints: number): T[] {
  const step = Math.ceil(items.length / maxPoints)
  const out: T[] = []
  for (let i = 0; i < items.length; i += step) {
    out.push(items[i])
  }
  const last = items[items.length - 1]
  if (out[out.length - 1] !== last) {
    out.push(last)
  }
  return out
}

/**
 * Reduce chart point count while keeping spikes (chat/emote peaks) visible.
 * Uniform stride alone can flatten early/late activity when downsampling.
 */
export function downsampleTimeline<T>(
  items: T[],
  maxPoints = PORTAL_CHART_MAX_POINTS,
  activityScore?: (item: T) => number,
): T[] {
  if (items.length <= maxPoints) return items
  if (!activityScore) return uniformDownsample(items, maxPoints)

  const bucketCount = maxPoints
  const bucketSize = items.length / bucketCount
  const out: T[] = []
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(items.length, Math.floor((bucket + 1) * bucketSize))
    if (start >= end) continue
    let best = items[start]
    let bestScore = activityScore(best)
    for (let i = start + 1; i < end; i += 1) {
      const score = activityScore(items[i])
      if (score > bestScore) {
        best = items[i]
        bestScore = score
      }
    }
    out.push(best)
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (out[0] !== first) out.unshift(first)
  if (out[out.length - 1] !== last) out.push(last)
  return out.slice(0, maxPoints + 2)
}

export function rollupChartActivityScore(point: {
  chatCount?: number
  totalEmoteCount?: number
  seventvEmoteCount?: number
  viewerLatest?: number
  viewerMax?: number
  viewerAvg?: number
}): number {
  const chat = point.chatCount ?? 0
  const emotes = point.totalEmoteCount ?? point.seventvEmoteCount ?? 0
  const viewers = point.viewerLatest ?? point.viewerMax ?? point.viewerAvg ?? 0
  // Weight chat/emotes above passive viewer samples so spikes survive downsampling.
  return chat * 1000 + emotes * 100 + viewers
}
