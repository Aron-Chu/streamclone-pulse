// @vitest-environment jsdom

import { act, useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSpPerfForTests } from '../src/perfMarks.ts'
import { SpChart } from '../src/sp/SpChart.tsx'
import { createSpViewportStore } from '../src/sp/viewportStore.ts'
import type { SpChartData, SpFrame, SpLayer, SpLayerContext } from '../src/sp/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MIN = 60_000
const START = Date.UTC(2026, 9, 11, 18, 3, 0)

function data(n = 195): SpChartData {
  return {
    startMs: START,
    stepMs: MIN,
    chat: Float64Array.from({ length: n }, (_, i) => 20 + (i % 30)),
    emotes: Float64Array.from({ length: n }, (_, i) => 3 + (i % 5)),
    viewers: Float64Array.from({ length: n }, (_, i) => 1000 + i),
    coverage: new Uint8Array(n),
  }
}

function fakeStore(count: number) {
  let t = 0, id = 0
  const queue = new Map<number, (now: number) => void>()
  const store = createSpViewportStore({ count, reducedMotion: () => false, now: () => t, raf: cb => (queue.set(++id, cb), id), cancelRaf: k => void queue.delete(k) })
  const frame = () => {
    t += 16
    const cbs = [...queue.values()]
    queue.clear()
    cbs.forEach(cb => cb(t))
  }
  return { store, frame }
}

/** A frame-mode layer body: subscribes to the frame and writes per frame. */
function FrameDot({ ctx, onFrame }: { ctx: SpLayerContext; onFrame: (f: SpFrame) => void }) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null)
  useEffect(
    () =>
      ctx.frame.subscribe(f => {
        onFrame(f)
        if (el) el.style.left = f.xOfMs(START + 100 * MIN) + 'px'
      }),
    [ctx.frame, el, onFrame],
  )
  return <span ref={setEl} className="pin spc-pe" />
}

describe('SpChart layers', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  const seen: Record<string, SpLayerContext> = {}
  const onFrame = vi.fn()

  beforeEach(() => {
    resetSpPerfForTests()
    vi.stubGlobal('requestAnimationFrame', () => 0)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onFrame.mockClear()
  })
  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const layer = (id: string, panel: SpLayer['panel'], mode: SpLayer['mode'], surface: SpLayer['surface'], body: (ctx: SpLayerContext) => ReactNode): SpLayer => ({
    id,
    panel,
    mode,
    surface,
    render: ctx => ((seen[id] = ctx), body(ctx)),
  })
  const LAYERS: SpLayer[] = [
    layer('band-segs', 'band', 'settle', undefined, ctx => <text className="seg" x={ctx.xOfMs(START)} />),
    layer('lanes', 'viewers', 'scaled', undefined, ctx => <path className="lane" d={'M' + ctx.uOfMs(START + 10 * MIN) + ' 0H20'} />),
    layer('stamp', 'rates', 'settle', 'html', () => <b className="stamp">Peak</b>),
    layer('pins', 'top', 'frame', 'html', ctx => <FrameDot ctx={ctx} onFrame={onFrame} />),
    layer('top-marks', 'top', 'settle', undefined, () => <circle className="tm" />),
    layer('top-scaled', 'top', 'scaled', undefined, () => <circle className="never" />),
  ]

  const q = (sel: string) => container.querySelector(sel)

  it('renders each layer in its panel and slot, with the panel box', () => {
    const { store } = fakeStore(195)
    act(() => root!.render(<SpChart data={data()} viewport={store} plotHeight={420} width={1456} topPx={26} layers={LAYERS} />))
    const plot = q('svg[data-bench-plot]')!
    const scaled = q('g[data-spc-scaled]')!
    const ov = q('.spc-ov')!
    const topRail = q('.spc-top')!
    // svg layers sit in the plot svg, outside the scaled group
    const segs = plot.querySelector('[data-sp-layer="band-segs"]')!
    expect(segs.tagName).toBe('g')
    expect(scaled.contains(segs)).toBe(false)
    expect(segs.querySelector('text.seg')).not.toBeNull()
    // scaled layers sit inside the scaled group, in data units
    const lanes = scaled.querySelector('[data-sp-layer="lanes"]')!
    expect(lanes.querySelector('path.lane')!.getAttribute('d')).toBe('M10 0H20')
    // html layers are divs over their panel
    const stamp = ov.querySelector('div[data-sp-layer="stamp"]') as HTMLDivElement
    const layout = seen.stamp!.layout
    expect(stamp.style.top).toBe(layout.rates!.y + 'px')
    expect(stamp.style.height).toBe(layout.rates!.height + 'px')
    expect(stamp.style.width).toBe('1400px')
    // the top rail holds top layers (svg and html), never in the plot
    expect(topRail.querySelector('svg.spc-top-svg [data-sp-layer="top-marks"] circle.tm')).not.toBeNull()
    expect(topRail.querySelector('div[data-sp-layer="pins"] .pin')).not.toBeNull()
    expect(plot.querySelector('[data-sp-layer="pins"], [data-sp-layer="top-marks"]')).toBeNull()
    // a scaled layer in the top rail is not drawn
    expect(q('[data-sp-layer="top-scaled"]')).toBeNull()
    // each context carries its own panel box and the settled scales
    expect(seen['band-segs']!.box).toEqual(layout.band)
    expect(seen.lanes!.box).toEqual(layout.viewers)
    expect(seen.pins!.box).toEqual(layout.top)
    // no barOptions: the plain 5 px rule (7.2 px a sample) keeps 1-minute bars
    expect(seen.stamp!.level.minutes).toBe(1)
    expect(seen.stamp!.xOfMs(START)).toBe(0)
    expect(seen.stamp!.xOfIndex(195)).toBe(1400)
    expect(seen.stamp!.yRates(0)).toBe(layout.rates!.y + layout.rates!.height)
    // settle layers are marked; others are not
    expect(segs.hasAttribute('data-spc-settle')).toBe(true)
    expect(stamp.hasAttribute('data-spc-settle')).toBe(true)
    expect(lanes.hasAttribute('data-spc-settle')).toBe(false)
    expect(q('[data-sp-layer="pins"]')!.hasAttribute('data-spc-settle')).toBe(false)
  })

  it('marks the root while the view moves and clears it at settle; frame layers get every frame', () => {
    const { store, frame } = fakeStore(195)
    act(() => root!.render(<SpChart data={data()} viewport={store} plotHeight={420} width={1456} topPx={26} layers={LAYERS} />))
    const rootEl = q('.spc')!
    expect(rootEl.hasAttribute('data-gesture')).toBe(false)
    act(() => store.setTarget({ startIndex: 50, endIndex: 149 }))
    act(() => frame())
    expect(rootEl.hasAttribute('data-gesture')).toBe(true)
    const pin = q('.pin') as HTMLSpanElement
    const mid = pin.style.left
    expect(onFrame).toHaveBeenCalled()
    expect(onFrame.mock.calls.at(-1)![0].moving).toBe(true)
    let guard = 0
    while (store.isMoving() && guard++ < 100) act(() => frame())
    expect(rootEl.hasAttribute('data-gesture')).toBe(false)
    // at settle: 100 samples on 1400 px, the pin at sample 100 sits at (100 - 50) * 14
    expect((q('.pin') as HTMLSpanElement).style.left).toBe('700px')
    expect(mid).not.toBe('700px')
    expect(seen.stamp!.range).toEqual({ startIndex: 50, endIndex: 149 })
    expect(seen['band-segs']!.xOfMs(START + 50 * MIN)).toBe(0)
  })
})
