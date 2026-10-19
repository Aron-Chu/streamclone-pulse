/**
 * Layer slot. Page-specific marks (pins, band segments, stamp, lanes) are
 * layers in the page's own files. Each layer renders into a container on its
 * panel: a <g> (svg) or an absolutely placed <div> (html). Containers ignore
 * the pointer (sp-chart.css); children with class "spc-pe" opt in. Settle
 * layers carry data-spc-settle and are hidden while the view moves.
 */
import { createElement, type ReactNode } from 'react'
import type { SpFrame, SpLayer, SpLayerContext, SpLayerPanel, SpRange } from './types.ts'

export interface SpFrameControl extends SpFrame {
  range: SpRange
  scale: number
  offset: number
  moving: boolean
  update(visual: SpRange, plotWidth: number): void
  setData(startMs: number, stepMs: number): void
  emit(): void
}

export function createSpFrame(): SpFrameControl {
  const subs = new Set<(frame: SpFrame) => void>()
  let startMs = 0, stepMs = 60_000
  const f: SpFrameControl = {
    range: { startIndex: 0, endIndex: 0 },
    scale: 1,
    offset: 0,
    moving: false,
    xOfIndex: i => f.offset + f.scale * i,
    xOfMs: ms => f.xOfIndex((ms - startMs) / stepMs),
    subscribe: cb => (subs.add(cb), () => void subs.delete(cb)),
    update(v, plotWidth) {
      f.range.startIndex = v.startIndex
      f.range.endIndex = v.endIndex
      f.scale = plotWidth / Math.max(1e-6, v.endIndex + 1 - v.startIndex)
      f.offset = -v.startIndex * f.scale
    },
    setData(s, st) {
      startMs = s
      stepMs = st
    },
    emit: () => subs.forEach(cb => cb(f)),
  }
  return f
}

export type SpLayerSlot = 'scaled' | 'svg' | 'html'
export type SpLayerBase = Omit<SpLayerContext, 'box'>

/** Containers for the layers of some panels in one slot. */
export const layerNodes = (
  layers: readonly SpLayer[] | undefined,
  panels: readonly SpLayerPanel[],
  slot: SpLayerSlot,
  base: SpLayerBase | null,
): ReactNode[] =>
  (base && layers ? layers : []).flatMap(l => {
    const box = base!.layout[l.panel]
    const html = l.surface === 'html'
    if (!box || !panels.includes(l.panel) || slot !== (html ? 'html' : l.mode === 'scaled' ? 'scaled' : 'svg')) return []
    return createElement(
      html ? 'div' : 'g',
      {
        key: l.id,
        className: 'spc-layer',
        'data-sp-layer': l.id,
        'data-spc-settle': l.mode === 'settle' ? '' : undefined,
        style: html ? { top: box.y, width: box.width, height: box.height } : undefined,
      },
      l.render({ ...base!, box }),
    )
  })
