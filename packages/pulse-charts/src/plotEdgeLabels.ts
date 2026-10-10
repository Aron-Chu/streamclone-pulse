/**
 * Value labels drawn inside a full-width plot.
 *
 * The console chart spans the card's full content width, so its scale values
 * no longer get a gutter of their own. Each label is tried as a small chip just
 * inside the plot's left edge, then just inside its right edge, and is placed
 * only where it covers no plotted mark (the obstacles) and no other label.
 * A label that fits neither edge is not drawn in the plot; the caller shows it
 * in the compact scale row above the plot instead, so no value is lost and no
 * value ever covers data.
 */

export type PlotEdgeLabel = {
  key: string
  /** Vertical centre the label marks, in plot coordinates. */
  y: number
  width: number
  height: number
}

/** An axis-aligned box occupied by a plotted mark (line segment, bar, cap). */
export type PlotObstacle = { x0: number; x1: number; y0: number; y1: number }

export type PlotEdgeLabelPlacement = {
  key: string
  side: 'start' | 'end' | null
  x: number
  y: number
  width: number
  height: number
}

export type PlotEdgeLabelOptions = {
  plotLeft: number
  plotRight: number
  /** Highest and lowest y a chip may occupy. */
  top: number
  bottom: number
  obstacles: readonly PlotObstacle[]
  /** Gap between the plot edge and the chip. */
  inset?: number
  /** Minimum clear space between a chip and any mark. */
  clearance?: number
}

const overlaps = (a: PlotObstacle, b: PlotObstacle) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

export function placePlotEdgeLabels(
  labels: readonly PlotEdgeLabel[],
  options: PlotEdgeLabelOptions,
): PlotEdgeLabelPlacement[] {
  const inset = options.inset ?? 4
  const clearance = options.clearance ?? 3
  const placed: PlotObstacle[] = []
  return labels.map((label) => {
    const unplaced: PlotEdgeLabelPlacement = { key: label.key, side: null, x: 0, y: 0, width: label.width, height: label.height }
    if (!Number.isFinite(label.y) || options.bottom - options.top < label.height) return unplaced
    if (options.plotRight - options.plotLeft < label.width + inset * 2) return unplaced
    const y = Math.min(options.bottom - label.height, Math.max(options.top, label.y - label.height / 2))
    for (const side of ['start', 'end'] as const) {
      const x = side === 'start' ? options.plotLeft + inset : options.plotRight - inset - label.width
      const chip = { x0: x, x1: x + label.width, y0: y, y1: y + label.height }
      const padded = { x0: chip.x0 - clearance, x1: chip.x1 + clearance, y0: chip.y0 - clearance, y1: chip.y1 + clearance }
      if (options.obstacles.some((mark) => overlaps(padded, mark))) continue
      if (placed.some((other) => overlaps(padded, other))) continue
      placed.push(chip)
      return { key: label.key, side, x, y, width: label.width, height: label.height }
    }
    return unplaced
  })
}

/**
 * The boxes a polyline occupies: one per segment between neighbouring points
 * (a smoothed curve stays inside its endpoints' box), plus one per lone point.
 */
export function polylineObstacles(
  segments: ReadonlyArray<ReadonlyArray<{ x: number; y: number | null }>>,
  halfStroke = 1.5,
): PlotObstacle[] {
  const boxes: PlotObstacle[] = []
  for (const segment of segments) {
    const points = segment.filter((point): point is { x: number; y: number } =>
      point.y != null && Number.isFinite(point.y) && Number.isFinite(point.x))
    if (points.length === 1) {
      const point = points[0]!
      boxes.push({ x0: point.x - halfStroke, x1: point.x + halfStroke, y0: point.y - halfStroke, y1: point.y + halfStroke })
      continue
    }
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!
      const b = points[index]!
      boxes.push({
        x0: Math.min(a.x, b.x) - halfStroke,
        x1: Math.max(a.x, b.x) + halfStroke,
        y0: Math.min(a.y, b.y) - halfStroke,
        y1: Math.max(a.y, b.y) + halfStroke,
      })
    }
  }
  return boxes
}

/**
 * A generous width for a one-line "LABEL value" chip in the chart's black
 * weight: the label in 12px capitals, the value in 14px figures. An estimate
 * keeps the chip from depending on a layout pass; erring wide only costs a
 * little padding.
 */
export function scaleChipWidth(label: string, value: string): number {
  return Math.ceil(12 + label.length * 12 * 0.74 + 5 + value.length * 14 * 0.68)
}

export const SCALE_CHIP_HEIGHT = 20
