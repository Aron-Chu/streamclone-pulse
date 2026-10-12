/**
 * Where the Global activity chart puts its viewer-scale labels.
 *
 * The labels sit inside the plot's left edge, under "Sampled viewers", so the
 * plot can run the full card width. That edge is also where the oldest stretch
 * of the viewer line is drawn, and a label must never cover the line. So each
 * label is centred on its tick when the line leaves room there; otherwise it
 * moves the least distance up or down that clears the line near the left edge,
 * staying in its column. If that would take it more than `maxShift` from its
 * tick, it is hidden instead: the other labels still give the scale, and the
 * line stays in full view.
 */

/** A point of the drawn viewer line in plot percent; `null` breaks the line. */
export type ViewerAxisLinePoint = { x: number; y: number } | null

/** How far (CSS px, + is down) a label moves from its tick, or that it is hidden. */
export type ViewerAxisLabelPlacement = { offset: number; hidden: boolean }

export interface ViewerAxisLabelInput {
  /** Each tick's y, in percent of the plot height (0 is the top). */
  tickYs: readonly number[]
  /** Each label's width in CSS px, plate included. */
  labelWidths: readonly number[]
  /** The viewer line as drawn: x in percent of the plot width, y in percent of its height. */
  line: readonly ViewerAxisLinePoint[]
  /** The plot's size in CSS px. */
  plotWidth: number
  plotHeight: number
  /** Distance from the plot's left edge to each label, in CSS px. */
  labelLeft: number
  /** Label height in CSS px, plate included. */
  labelHeight: number
  /** Room kept between a label and the line (stroke and its dark underlay included), in CSS px. */
  clearance: number
  /** The farthest a label may move from its tick before it hides, in CSS px. */
  maxShift: number
  /** How far down a label may reach, in percent of the plot height (the top of the bar lane). */
  bottomLimit: number
}

/**
 * Rough plate width for a scale label in the chart's 0.75rem Inter figures,
 * padding included. Kept generous: measured plates are 41px for "983K", 52px
 * for "682.5K" and 17.4px for "0"; this gives 44, 60 and 20.
 */
export function estimateViewerAxisLabelWidth(text: string): number {
  return Math.ceil(text.length * 8 + 12)
}

/** The lowest and highest y (plot percent) the line reaches between `xMin` and `xMax` (plot percent). */
export function viewerLineBand(line: readonly ViewerAxisLinePoint[], xMin: number, xMax: number): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  const take = (y: number) => {
    if (y < min) min = y
    if (y > max) max = y
  }
  for (let i = 0; i < line.length; i += 1) {
    const a = line[i]
    if (!a) continue
    if (a.x >= xMin && a.x <= xMax) take(a.y)
    const b = line[i + 1]
    if (!b || b.x === a.x) continue
    // Where the segment from a to b crosses either edge of the label column.
    for (const edge of [xMin, xMax]) {
      const t = (edge - a.x) / (b.x - a.x)
      if (t > 0 && t < 1) take(a.y + (b.y - a.y) * t)
    }
  }
  return min <= max ? { min, max } : null
}

export function placeViewerAxisLabels(input: ViewerAxisLabelInput): ViewerAxisLabelPlacement[] {
  const { tickYs, labelWidths, line, plotWidth, plotHeight, labelLeft, labelHeight, clearance, maxShift, bottomLimit } = input
  const stay = { offset: 0, hidden: false }
  if (!(plotWidth > 0) || !(plotHeight > 0)) return tickYs.map(() => stay)
  const half = labelHeight / 2
  const floor = (bottomLimit / 100) * plotHeight
  return tickYs.map((tickY, index) => {
    const left = Math.max(0, labelLeft - clearance)
    const right = labelLeft + (labelWidths[index] ?? 0) + clearance
    const band = viewerLineBand(line, (left / plotWidth) * 100, (right / plotWidth) * 100)
    if (!band) return stay
    const lineTop = (band.min / 100) * plotHeight - clearance
    const lineBottom = (band.max / 100) * plotHeight + clearance
    const tick = (tickY / 100) * plotHeight
    if (tick + half <= lineTop || tick - half >= lineBottom) return stay
    // The nearest spot just above, or just below, the line in this column.
    const candidates = [lineTop - half, lineBottom + half]
      .filter((centre) => centre - half >= 0 && centre + half <= floor)
      .map((centre) => centre - tick)
      .filter((offset) => Math.abs(offset) <= maxShift)
      .sort((a, b) => Math.abs(a) - Math.abs(b))
    const offset = candidates[0]
    if (offset === undefined) return { offset: 0, hidden: true }
    // Round to 0.01px away from the line, so rounding never eats into the clearance.
    return { offset: (Math.sign(offset) * Math.ceil(Math.abs(offset) * 100 - 1e-6)) / 100, hidden: false }
  })
}
