// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { laneFigure, laneLayout, laneTick, laneWidth, snapToSlots } from '../src/sp/lanes.ts'
import { SpChart } from '../src/sp/SpChart.tsx'
import { createSpViewportStore } from '../src/sp/viewportStore.ts'
import type { SpChartData, SpChartHandle, SpChartProps, SpLane } from '../src/sp/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MIN = 60_000
const START = Date.UTC(2026, 9, 11, 18, 3, 0)
const BAND = 'rgb(255 255 255 / .025)'
const W2: readonly [number, number] = [1.55, 2.15]

function data(n: number, gaps: [number, number][] = [[50, 60]]): SpChartData {
  const chat = new Float64Array(n), emotes = new Float64Array(n), viewers = new Float64Array(n), coverage = new Uint8Array(n)
  const overlay = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const gap = gaps.some(([a, b]) => i >= a && i < b)
    coverage[i] = gap ? 2 : i === 70 ? 1 : 0
    chat[i] = gap ? NaN : 20 + ((i * 7) % 34)
    emotes[i] = gap ? NaN : 4 + (i % 9)
    viewers[i] = gap || i === 90 ? NaN : 30_000 + i * 20
    overlay[i] = gap ? NaN : i % 5
  }
  return { startMs: START, stepMs: MIN, chat, emotes, viewers, coverage, overlay }
}

/** The session-original lane set (d3-v2 session-original.js), with a fixed spike threshold. */
function sessionLanes(d: SpChartData, more: { spike?: number; caption?: Partial<Record<string, SpLane['caption']>> } = {}): SpLane[] {
  const ov = new Float64Array(d.chat.length).map((_, i) => (i % 7 ? (i % 11) * 3 : NaN))
  return [
    { key: 'viewers', label: 'Viewers', kind: 'area', color: '#22d3ee', unit: ' viewers', smooth: true, lineOpacity: 0.85, gradient: [0.16, 0], width: W2, baseline: false, caption: more.caption?.viewers },
    { key: 'chat', label: 'Chat', kind: 'bars', color: '#a78bfa', unit: '/min', gap: 8, barOpacity: 0.12, minBarPx: 1, trend: { opacity: 0.84, width: W2 }, bg: BAND, baseline: false, caption: more.caption?.chat },
    { key: 'emotes', label: 'Emotes', kind: 'bars', color: '#34d399', unit: '/min', gap: 0, barOpacity: 0.4, spikeOpacity: 0.72, spikeAbs: more.spike ?? 9, minBarPx: 1, trend: { opacity: 0.84, width: W2 }, bg: BAND, baseline: false, caption: more.caption?.emotes },
    { key: 'overlay', label: 'Emote overlays', kind: 'line', color: '#fb7185', unit: '/min', weight: 0.55, caption: false, gap: 0, lines: [{ key: 'LUL', color: '#fb7185', values: ov }], lineOpacity: 0.95, width: [1.15, 1.7], bridge: false, bg: [BAND, 'rgb(148 163 184 / .055)'], topLine: 'rgb(148 163 184 / .18)', baseline: false },
  ]
}

const store = (count: number, initial?: { startIndex: number; endIndex: number }) =>
  createSpViewportStore({ count, initial, reducedMotion: () => true, raf: () => 0, cancelRaf: () => undefined, now: () => 0 })

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null

describe('lanes layout and formats', () => {
  it('splits the plot under the band by weight, with per-lane gaps; the last lane takes the rest', () => {
    const d = data(195)
    const lanes = sessionLanes(d)
    const L = laneLayout({ width: 1456, height: 440, tickColumn: 56, band: true, topPx: 0, gap: 12, lanes, raw: [34_282, 757, 699, 160] })
    const b = L.lanes!
    // avail = 440 - 22 - 8 = 410; weights 1, 1, 1, 0.55 -> round(410 / 3.55) = 115
    expect(b.map(x => [x.y, x.height])).toEqual([[22, 115], [145, 115], [260, 115], [375, 65]])
    expect(b.map(x => x.dataTop - x.y)).toEqual([20, 20, 20, 20])
    expect(b.map(x => laneTick(x.max))).toEqual(['40K', '800', '800', '200'])
    // rates spans every lane; viewers is not a panel in lanes mode
    expect(L.rates).toMatchObject({ y: 22, height: 418 })
    expect(L.viewers).toBeNull()
  })

  it('formats ticks like the mockup (40K, 1.5K, 800) and captions like the stat cards (34.3K, 757)', () => {
    expect([40_000, 1_500, 4_000, 800, 200, 0].map(laneTick)).toEqual(['40K', '1.5K', '4K', '800', '200', '0'])
    expect([34_282, 1_550, 757, 15.5, null].map(laneFigure)).toEqual(['34.3K', '1.6K', '757', '16', '—'])
  })

  it('eases line weight from far to near with the zoom (1 - sqrt of the visible share)', () => {
    expect(laneWidth(W2, 675, 675)).toBeCloseTo(1.55)
    expect(laneWidth(W2, 0, 675)).toBeCloseTo(2.15)
    expect(laneWidth(W2, 675 / 4, 675)).toBeCloseTo(1.55 + 0.6 * 0.5)
  })

  it('snaps a span outward to whole slots at a level', () => {
    expect(snapToSlots(12, 13, 5, 0, 100)).toEqual([10, 15])
    expect(snapToSlots(12, 13, 1, 0, 100)).toEqual([12, 13])
    expect(snapToSlots(0, 1, 10, 3, 100)).toEqual([0, 7])
  })
})

describe('SpChart lanes mode', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  const q = <E extends Element = Element>(sel: string) => container.querySelector<E>(sel)
  const qa = (sel: string) => [...container.querySelectorAll(sel)]
  const show = (props: Partial<SpChartProps> & { data: SpChartData }, initial?: { startIndex: number; endIndex: number }) => {
    const ref = createRef<SpChartHandle>()
    act(() =>
      root!.render(
        <SpChart
          ref={ref}
          viewport={store(props.data.chat.length, initial)}
          plotHeight={440}
          width={1456}
          barOptions={{ minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 1500 }}
          lanes={sessionLanes(props.data)}
          minHatchPx={6}
          {...props}
        />,
      ),
    )
    return ref
  }

  it('draws one bar per minute in each bar lane, a trend over each, and no value grid or peak caps', () => {
    const d = data(675, [])
    show({ data: d })
    expect(q('svg[data-bench-plot]')!.getAttribute('data-activity-bucket-minutes')).toBe('1')
    expect(qa('g.spc-lane-bars[data-lane="chat"] rect.spc-bar')).toHaveLength(675)
    expect(qa('g.spc-lane-bars[data-lane="emotes"] rect.spc-bar')).toHaveLength(675)
    expect(qa('g.spc-lane-trend path')).toHaveLength(2)
    expect(q('.spc-grid')!.getAttribute('d')).toBe('')
    expect(qa('[data-activity-bar-peak], .spc-cap, .spc-peak')).toHaveLength(0)
    // the hub's single bars group and panel lines stay empty
    expect(qa('g.spc-bars rect')).toHaveLength(0)
    expect(qa('.spc-line-viewers, .spc-line-emotes')).toHaveLength(0)
  })

  it('stands bars on the lane floor at the lane scale, with the spike and partial opacities', () => {
    const d = data(195)
    const ref = show({ data: d })
    const lanes = ref.current!.layout()!.lanes!
    const em = lanes[2]!, floor = em.y + em.height
    const rects = qa('g.spc-lane-bars[data-lane="emotes"] rect')
    for (const r of rects) expect(Number(r.getAttribute('y')) + Number(r.getAttribute('height'))).toBeCloseTo(floor, 0)
    const ops = new Set(rects.map(r => r.getAttribute('fill-opacity')))
    // 0.4 bars, 0.72 spikes (emotes over 9), the half-lit partial minute is not a bar here (1-min bars)
    expect(ops).toEqual(new Set(['0.4', '0.72']))
    expect(q('g.spc-lane-bars[data-lane="emotes"]')!.getAttribute('fill')).toBe('#34d399')
    // chat lane: bars at .12 under the trend, min 1 px tall
    expect(new Set(qa('g.spc-lane-bars[data-lane="chat"] rect').map(r => r.getAttribute('fill-opacity')))).toEqual(new Set(['0.12']))
  })

  it('marks each lane with one max tick: in the column, or inside the lane head with no column', () => {
    const d = data(195)
    const ref = show({ data: d })
    const lanes = ref.current!.layout()!.lanes!
    const ticks = qa('text.spc-tk[data-lane]')
    expect(ticks.map(t => t.textContent)).toEqual(lanes.map(b => laneTick(b.max)))
    expect(ticks[0]!.getAttribute('x')).toBe(String(1400 + 10))
    expect(Number(ticks[0]!.getAttribute('y'))).toBeCloseTo(lanes[0]!.dataTop + 4, 1)
    expect(q('path.spc-tkmark')!.getAttribute('d')).toContain('M1400 ' + lanes[0]!.dataTop + 'h4v1h-4Z')
    show({ data: d, tickColumnPx: 0 })
    const inside = qa('text.spc-tk[data-lane]')
    expect(inside.every(t => t.getAttribute('class') === 'spc-tk spc-tk-in' && t.getAttribute('text-anchor') === 'end')).toBe(true)
    expect(inside[0]!.getAttribute('x')).toBe(String(1456 - 6))
    expect(q('path.spc-tkmark')).toBeNull()
  })

  it('captions each lane in its head; caption false draws none; a passed caption wins over the plotted max', () => {
    const d = data(195)
    act(() =>
      root!.render(
        <SpChart
          data={d}
          viewport={store(195)}
          plotHeight={440}
          width={1456}
          lanes={sessionLanes(d, { caption: { viewers: { peak: 34_282 }, chat: { peak: 757, avg: 400.4 } } })}
        />,
      ),
    )
    const chips = qa('.spc-lcap')
    expect(chips.map(c => c.getAttribute('data-chart-lane-caption'))).toEqual(['viewers', 'chat', 'emotes'])
    expect(text(chips[0])).toBe('Viewers·, peak 34.3K')
    expect(text(chips[1])).toBe('Chat·, peak 757/min·, avg 400/min')
    // emotes: no caption passed -> the lane's plotted maximum (4 + 8)
    expect(text(chips[2])).toBe('Emotes·, peak 12/min')
    expect(q('[data-chart-lane-caption="overlay"]')).toBeNull()
    expect(q('[data-chart-scale-value="chat-avg"]')!.textContent).toBe('400/min')
    // an average draws its dotted hairline in that lane only
    expect(q('.spc-avg')!.getAttribute('d')!.match(/M0 /g)).toHaveLength(1)
  })

  it('joins breaks under 6 px and hatches only gaps at least 6 px wide; bridge false keeps every break', () => {
    // 600 samples on 1200 px: 2 px a minute. A 2-minute gap (4 px) joins; a 5-minute gap (10 px) breaks.
    const d = data(600, [[100, 102], [300, 305]])
    act(() =>
      root!.render(
        <SpChart data={d} viewport={store(600)} plotHeight={440} width={1256} barOptions={{ minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 1500 }} lanes={sessionLanes(d)} minHatchPx={6} gaps={[{ startMs: START + 100 * MIN, endMs: START + 102 * MIN }, { startMs: START + 300 * MIN, endMs: START + 305 * MIN }]} />,
      ),
    )
    const viewersLine = q('g.spc-lane-area path[stroke="#22d3ee"]')!.getAttribute('d')!
    // one break (the 5-minute gap) plus the unmeasured viewer minute 90 (one slot, 2 px, joined): two runs
    expect(viewersLine.match(/M/g)).toHaveLength(2)
    const hatch = q('path.spc-hatch')!.getAttribute('d')!
    expect(hatch.match(/M/g)).toHaveLength(1)
    expect(hatch.startsWith('M300 ')).toBe(true)
    // the overlay lane (bridge false) breaks at every value-less minute
    const ov = q('path[data-lane-line="LUL"]')!.getAttribute('d')!
    expect(ov.match(/M/g)!.length).toBeGreaterThan(60)
    // without minHatchPx both gaps hatch; the viewer-less minute 90 never hatches in lanes (session-original)
    act(() => root!.render(<SpChart data={d} viewport={store(600)} plotHeight={440} width={1256} lanes={sessionLanes(d)} gaps={[{ startMs: START + 100 * MIN, endMs: START + 102 * MIN }, { startMs: START + 300 * MIN, endMs: START + 305 * MIN }]} />))
    expect(q('path.spc-hatch')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)
  })

  it('caps rects per bar lane with maxRects: the level coarsens until the visible bars fit', () => {
    const d = data(675, [])
    show({ data: d, barOptions: { minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 300 } })
    const minutes = Number(q('svg[data-bench-plot]')!.getAttribute('data-activity-bucket-minutes'))
    expect(minutes).toBeGreaterThan(1)
    for (const k of ['chat', 'emotes']) expect(qa(`g.spc-lane-bars[data-lane="${k}"] rect`).length).toBeLessThanOrEqual(300)
    // default cap (600) also holds in lanes mode
    show({ data: d, barOptions: { minSlotPx: 1.05, tolerance: 0.85, rule: 'prod' } })
    for (const k of ['chat', 'emotes']) expect(qa(`g.spc-lane-bars[data-lane="${k}"] rect`).length).toBeLessThanOrEqual(600)
  })

  it('dims bars outside a selection to 0.4 of their opacity and lines to 0.65, snapped to the bar level', () => {
    const d = data(195)
    show({ data: d, selected: { startMs: START + 120 * MIN, endMs: START + 121 * MIN, kind: 'minute' } })
    const chat = qa('g.spc-lane-bars[data-lane="chat"] rect')
    const lit = chat.filter(r => r.getAttribute('fill-opacity') === '0.12')
    expect(lit).toHaveLength(1)
    expect(Number(lit[0]!.getAttribute('x'))).toBeGreaterThan(120)
    expect(Number(lit[0]!.getAttribute('x'))).toBeLessThan(121)
    expect(chat.filter(r => r.getAttribute('fill-opacity') === '0.048').length).toBe(chat.length - 1)
    expect(q('g.spc-lane-trend path')!.getAttribute('stroke-opacity')).toBe('0.546')
    // the outline runs through every lane (no selSlide)
    expect(q('path.spc-sel')!.getAttribute('d')).toBe('M120 22H121V440H120Z')
  })

  it('dims outside a highlighted span without the dashed edges', () => {
    const d = data(195)
    show({ data: d, highlightRange: { startMs: START + 20 * MIN, endMs: START + 40 * MIN } })
    expect(q('.spc-hl-dim')).not.toBeNull()
    expect(q('.spc-hl-edge')).toBeNull()
  })

  it('labels 0:00 at the first minute’s edge when the stream started under a minute before it (session-original)', () => {
    const at = (offsetS: number, initial?: { startIndex: number; endIndex: number }) => {
      const d = { ...data(675, []), startMs: START + offsetS * 1000 }
      show({ data: d, viewportOriginMs: START }, initial)
      return qa('svg[data-bench-axis] g').filter(g => g.getAttribute('visibility') === 'visible')
    }
    // xqc: the first measured minute starts 54 s in
    const first = at(54)[0]!
    expect([first.textContent, first.getAttribute('transform'), first.lastElementChild!.getAttribute('text-anchor')]).toEqual(['0:00', 'translate(0 0)', 'start'])
    expect(at(54).map(g => g.textContent).slice(0, 2)).toEqual(['0:00', '1:00'])
    // zoomed in, it leaves with the left edge
    expect(at(54, { startIndex: 300, endIndex: 400 }).map(g => g.textContent)).not.toContain('0:00')
    // a minute or more before the data: no 0:00
    expect(at(60).map(g => g.textContent)).not.toContain('0:00')
    expect(at(90).map(g => g.textContent)).not.toContain('0:00')
  })
})

// Byte-identical hub check (no lanes): SPC_PARITY_OUT dumps the DOM of five no-lanes configurations
// so a run before and after a core change can be compared with cmp.
describe('no-lanes parity capture', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('renders the no-lanes configurations without lane nodes', () => {
    const d = data(195)
    const cfgs: (Partial<SpChartProps> & { initial?: { startIndex: number; endIndex: number } })[] = [
      { density: 'hub', barOptions: null, fixedLevelMinutes: 6 },
      { density: 'session', barOptions: { minSlotPx: 5, maxBars: 72, tolerance: 0.85, maxLevelMinutes: 10 }, captions: { rates: { peak: 53, avg: 30, unit: 'chat/min' }, viewers: { peak: 34_000, avg: 31_000, unit: 'viewers' } } },
      { density: 'session', gaps: [{ startMs: START + 50 * MIN, endMs: START + 60 * MIN }], selected: { startMs: START + 100 * MIN, endMs: START + 105 * MIN }, highlightRange: { startMs: START + 20 * MIN, endMs: START + 40 * MIN }, liveEdge: { atMs: START + 194 * MIN, pollSeq: 1, label: 'live' } },
      { density: 'session', tickColumnPx: 0, selected: { startMs: START + 10 * MIN, endMs: START + 11 * MIN, kind: 'minute' }, series: { viewers: false } },
      { density: 'session', initial: { startIndex: 40, endIndex: 80 } },
    ]
    const out: string[] = []
    for (const { initial, ...rest } of cfgs) {
      act(() => root!.render(<SpChart data={d} viewport={store(d.chat.length, initial)} plotHeight={420} width={1456} {...rest} />))
      out.push(container.innerHTML)
    }
    if (process.env.SPC_PARITY_OUT) writeFileSync(process.env.SPC_PARITY_OUT, out.join('\n\n'))
    expect(out.every(s => s.includes('data-bench-plot') && !s.includes('spc-lane') && !s.includes('spc-selband'))).toBe(true)
  })
})
