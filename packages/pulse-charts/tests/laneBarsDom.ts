/**
 * Lane bars as drawn: stroked paths, one `M cx y V bottom` segment per bar (lanes.ts laneBarPaths). Read back as one
 * record per bar in data units, ordered by x, the way the old one-rect-per-bar tests read them.
 */
export interface LaneBarRead { x: number; y: number; width: number; height: number; opacity: string | null; partial: boolean }

export function laneBarsOf(root: ParentNode, lane?: string): LaneBarRead[] {
  const out: LaneBarRead[] = []
  const sel = lane ? `g.spc-lane-bars[data-lane="${lane}"] path.spc-barline` : 'g.spc-lane-bars path.spc-barline'
  for (const p of root.querySelectorAll(sel)) {
    const w = Number(p.getAttribute('stroke-width')), opacity = p.getAttribute('stroke-opacity'), partial = p.hasAttribute('data-lane-partial')
    for (const m of (p.getAttribute('d') ?? '').matchAll(/M(-?[\d.e+-]+) (-?[\d.e+-]+)V(-?[\d.e+-]+)/g)) {
      const y = Number(m[2])
      out.push({ x: Number(m[1]) - w / 2, y, width: w, height: Number(m[3]) - y, opacity, partial })
    }
  }
  return out.sort((a, b) => a.x - b.x)
}
