export type ChartHitRegion = {
  index: number
  centerX: number
  startX: number
  endX: number
  selectable: boolean
}

export type ChartHitPoint = {
  index: number
  centerX: number
  selectable?: boolean
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/**
 * Precompute non-overlapping pointer hit regions for timestamp-positioned data.
 * Region widths are capped to the typical bucket spacing so a real timestamp
 * gap remains non-interactive instead of assigning the whole gap to a neighbor.
 */
export function buildChartHitRegions(points: ChartHitPoint[]): ChartHitRegion[] {
  if (points.length === 0) return []
  const sorted = [...points]
    .filter(point => Number.isFinite(point.centerX))
    .sort((a, b) => a.centerX - b.centerX)
  if (sorted.length === 0) return []

  const spacings: number[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const spacing = sorted[index]!.centerX - sorted[index - 1]!.centerX
    if (spacing > 0) spacings.push(spacing)
  }
  const typicalSpacing = median(spacings) || 1
  const maximumHalfWidth = Math.max(0.5, typicalSpacing * 0.58)

  return sorted.map((point, index) => {
    const previous = sorted[index - 1]
    const next = sorted[index + 1]
    const midpointStart = previous
      ? (previous.centerX + point.centerX) / 2
      : point.centerX - maximumHalfWidth
    const midpointEnd = next
      ? (point.centerX + next.centerX) / 2
      : point.centerX + maximumHalfWidth
    return {
      index: point.index,
      centerX: point.centerX,
      startX: Math.max(midpointStart, point.centerX - maximumHalfWidth),
      endX: Math.min(midpointEnd, point.centerX + maximumHalfWidth),
      selectable: point.selectable !== false,
    }
  })
}

/** Resolve one precomputed bucket in O(log n). */
export function chartHitRegionAtX(
  regions: ChartHitRegion[],
  plotX: number,
): ChartHitRegion | null {
  let low = 0
  let high = regions.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const region = regions[middle]!
    if (plotX < region.startX) {
      high = middle - 1
      continue
    }
    if (plotX > region.endX) {
      low = middle + 1
      continue
    }
    return region.selectable ? region : null
  }
  return null
}
