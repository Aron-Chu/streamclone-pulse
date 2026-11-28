import type { Locator } from '@playwright/test'

/**
 * The stream chart draws each lane's bars as a few stroked paths, one `M cx y V bottom` segment per bar and one path
 * per opacity group (pulse-charts laneBarPaths), not a rect per bar. These read them back.
 */
export const LANE_BAR_PATHS = 'g.spc-lane-bars path.spc-barline'

/** How many bars the paths under `scope` draw (each path carries its count). */
export const laneBarCount = (paths: Locator): Promise<number> =>
  paths.evaluateAll(ps => ps.reduce((n, p) => n + Number(p.getAttribute('data-bar-count') || 0), 0))

/** Each bar's centre and width on screen, in px, through the chart's zoom and lane transforms. */
export const laneBarsOnScreen = (paths: Locator): Promise<Array<{ x: number; width: number }>> =>
  paths.evaluateAll(ps =>
    ps.flatMap(p => {
      const m = (p as SVGGraphicsElement).getScreenCTM()!
      const width = Number(p.getAttribute('stroke-width')) * m.a
      return [...(p.getAttribute('d') ?? '').matchAll(/M(-?[\d.e+-]+) (-?[\d.e+-]+)V/g)].map(s => ({ x: m.a * Number(s[1]) + m.e, width }))
    }),
  )
