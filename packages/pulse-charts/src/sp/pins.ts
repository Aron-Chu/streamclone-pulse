/**
 * Pin clustering (d3-designer session.js placePins), run at settle: pins closer
 * than 46 px merge into one labelled "1·5"; a cluster click shows its moments
 * from 10 min before the first to 11 min after the last.
 */
import type { SpSpanMs } from './types.ts'

export interface SpPinCluster {
  /** Pin indices (0-based), ascending. */
  members: number[]
  x0: number
  x1: number
  /** Pin centre, clamped to [edgePx, plotWidth - edgePx]. */
  left: number
  /** 1-based ranks joined with "·". */
  label: string
}

export function clusterPins(
  points: readonly { index: number; x: number }[],
  plotWidth: number,
  gapPx = 46,
  edgePx = 22,
): SpPinCluster[] {
  const pts = points.filter(p => p.x >= 0 && p.x <= plotWidth).sort((a, b) => a.x - b.x)
  const out: SpPinCluster[] = []
  for (const p of pts) {
    const c = out[out.length - 1]
    if (c && p.x - c.x1 < gapPx) {
      c.members.push(p.index)
      c.x1 = p.x
    } else out.push({ members: [p.index], x0: p.x, x1: p.x, left: 0, label: '' })
  }
  for (const c of out) {
    c.members.sort((a, b) => a - b)
    c.left = Math.min(Math.max((c.x0 + c.x1) / 2, edgePx), plotWidth - edgePx)
    c.label = c.members.map(i => i + 1).join('·')
  }
  return out
}

/** The span a cluster click shows. */
export function pinClusterSpan(timesMs: readonly number[], beforeMs = 600_000, afterMs = 660_000): SpSpanMs {
  return { startMs: Math.min(...timesMs) - beforeMs, endMs: Math.max(...timesMs) + afterMs }
}
