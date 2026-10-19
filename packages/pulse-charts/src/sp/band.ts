/**
 * Category band segment geometry (d3-v2 chart.js renderOverlay): text-only
 * segments in the 22 px band row, hidden under 2 px, label only when it fits.
 */
export interface SpBandBox { left: number; width: number; hidden: boolean; showLabel: boolean; showArt: boolean }

export function bandBox(x0: number, x1: number, plotWidth: number, hasArt = false): SpBandBox {
  const left = Math.max(0, x0)
  const width = Math.min(plotWidth, x1) - left
  return { left, width, hidden: width < 2, showLabel: width > (hasArt ? 64 : 44), showArt: hasArt && width > 26 }
}
