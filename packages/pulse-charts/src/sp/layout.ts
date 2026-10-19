/**
 * Panels (d3-v2 chart.js layout): a 22 px category band, the rates panel, and
 * viewers in a lower panel of 25 % (at least 64 px) with a 14 px gap. Value
 * scales are fixed from the full-data max, so zoom and pan move x only.
 */
import { niceTicks } from './scale.ts'
import type { SpLayout, SpValuePanel } from './types.ts'

export const SP_BAND_PX = 22
export const SP_AXIS_PX = 22
export const SP_TICK_COLUMN = { hub: 68, session: 56 } as const

export interface SpLayoutInput {
  width: number
  height: number
  tickColumn: number
  band: boolean
  topPx: number
  rates: boolean
  viewers: boolean
  /** Viewers head: 22 with a caption, else 10. */
  viewersCaption: boolean
  ratesMax: number
  viewersMax: number
}

export function spLayout(i: SpLayoutInput): SpLayout {
  const plotWidth = Math.max(40, i.width - i.tickColumn)
  const H = i.height
  const band = i.band ? SP_BAND_PX : 0
  const panel = (y0: number, y1: number, head: number, max: number, count: number): SpValuePanel => {
    const ticks = niceTicks(max, count)
    return { x: 0, y: y0, width: plotWidth, height: y1 - y0, dataTop: y0 + head, max: ticks[ticks.length - 1]! || 1, ticks }
  }
  let rates: SpValuePanel | null = null
  let viewers: SpValuePanel | null = null
  const vHead = i.viewersCaption ? 22 : 10
  if (i.rates && i.viewers) {
    const vh = Math.max(64, Math.round((H - band) * 0.25))
    rates = panel(band, H - vh - 14, 28, i.ratesMax, 3)
    viewers = panel(H - vh, H, vHead, i.viewersMax, 2)
  } else if (i.rates) rates = panel(band, H, 28, i.ratesMax, 3)
  else if (i.viewers) viewers = panel(band, H, vHead, i.viewersMax, 2)
  return {
    width: i.width,
    plotWidth,
    height: H,
    tickColumn: i.tickColumn,
    top: i.topPx > 0 ? { x: 0, y: 0, width: plotWidth, height: i.topPx } : null,
    band: band ? { x: 0, y: 0, width: plotWidth, height: band } : null,
    rates,
    viewers,
  }
}

/** Plot y of a value in a value panel (0 at the panel bottom). */
export const panelY = (p: SpValuePanel | null, value: number): number =>
  p ? p.y + p.height - (value / p.max) * (p.y + p.height - p.dataTop) : 0
