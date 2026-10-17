// @vitest-environment jsdom

import { act, createRef, Profiler, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSpPerfForTests } from '../src/perfMarks.ts'
import { buildSpLevels } from '../src/sp/bars.ts'
import { SpChart } from '../src/sp/SpChart.tsx'
import { createSpViewportStore } from '../src/sp/viewportStore.ts'
import type { SpBarOptions, SpChartData, SpChartHandle, SpChartProps, SpViewportStore } from '../src/sp/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MIN = 60_000
const SESSION: SpBarOptions = { minSlotPx: 5, maxBars: 72, tolerance: 0.85, maxLevelMinutes: 10 }
const START = Date.UTC(2026, 9, 11, 18, 3, 0)

/** 3h15 of minute samples; samples 50-59 are not measured. */
function sessionData(n = 195): SpChartData {
  const chat = new Float64Array(n), emotes = new Float64Array(n), viewers = new Float64Array(n), coverage = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    const gap = i >= 50 && i < 60
    coverage[i] = gap ? 2 : 0
    chat[i] = gap ? NaN : 20 + ((i * 7) % 34)
    emotes[i] = gap ? NaN : 4 + (i % 9)
    viewers[i] = gap ? NaN : 30_000 + i * 20
  }
  return { startMs: START, stepMs: MIN, chat, emotes, viewers, coverage }
}

function fakeStore(count: number) {
  let t = 0, id = 0
  const queue = new Map<number, (now: number) => void>()
  const store = createSpViewportStore({
    count,
    reducedMotion: () => false,
    now: () => t,
    raf: cb => (queue.set(++id, cb), id),
    cancelRaf: k => void queue.delete(k),
  })
  const frame = () => {
    t += 16
    const cbs = [...queue.values()]
    queue.clear()
    cbs.forEach(cb => cb(t))
  }
  return { store, frame, pending: () => queue.size }
}

describe('SpChart render', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  let commits = 0
  let rafQueue: FrameRequestCallback[] = []
  let marks: string[] = []

  beforeEach(() => {
    resetSpPerfForTests()
    commits = 0
    rafQueue = []
    marks = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (rafQueue.push(cb), rafQueue.length))
    if (typeof performance.mark !== 'function') (performance as unknown as { mark: () => void }).mark = () => undefined
    vi.spyOn(performance, 'mark').mockImplementation(((name: string) => void marks.push(name)) as unknown as typeof performance.mark)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const show = (node: ReactNode) => act(() => root!.render(<Profiler id="spc" onRender={() => void (commits += 1)}>{node}</Profiler>))
  const props = (store: SpViewportStore, more: Partial<SpChartProps> = {}): SpChartProps => ({
    data: sessionData(),
    viewport: store,
    plotHeight: 420,
    width: 1456,
    barOptions: SESSION,
    ...more,
  })
  const q = <E extends Element = Element>(sel: string) => container.querySelector<E>(sel)
  const qa = (sel: string) => [...container.querySelectorAll(sel)]
  const runRaf = () => {
    const cbs = rafQueue
    rafQueue = []
    cbs.forEach(cb => cb(0))
  }

  it('shows the skeleton and no <rect> before data', () => {
    const { store } = fakeStore(195)
    show(<SpChart {...props(store, { data: null, skeleton: <i className="sk" /> })} />)
    expect(q('div[data-skeleton] .sk')).not.toBeNull()
    expect(qa('rect')).toHaveLength(0)
    expect(q('[data-bench-plot]')).toBeNull()
    expect(q('[data-bench-axis]')).toBeNull()
    expect(rafQueue).toHaveLength(0)
  })

  it('draws one <rect> per bar and the bench hooks', () => {
    const d = sessionData()
    const { store } = fakeStore(d.chat.length)
    show(<SpChart {...props(store, { data: d })} />)
    expect(q('div[data-skeleton]')).toBeNull()
    const svg = q<SVGSVGElement>('svg[data-bench-plot]')!
    expect(svg).not.toBeNull()
    expect(q('svg[data-bench-axis]')).not.toBeNull()
    expect(svg.getAttribute('data-bench-viewport')).toBe('0-194')
    // session at 3h15 on a 1400 px plot: 5-minute bars
    expect(svg.getAttribute('data-activity-bucket-minutes')).toBe('5')
    const level = buildSpLevels(d, d.startMs).find(l => l.step === 5)!
    const bars = qa('rect.spc-bar')
    expect(bars).toHaveLength(level.buckets.length)
    expect(bars).toHaveLength(37) // 39 slots, two of them wholly unmeasured
    // the only other rect is the touch target
    expect(qa('svg[data-bench-plot] rect')).toHaveLength(bars.length + 1)
    const touch = q('rect[data-chart-touch-action]')!
    expect(touch.getAttribute('data-chart-touch-action')).toBe('pan-y')
    expect(touch.getAttribute('data-chart-viewport-start')).toBe('0')
    expect(touch.getAttribute('data-chart-viewport-end')).toBe(String(194 * 60))
    expect(touch.getAttribute('width')).toBe('1400')
  })

  it('draws no peak cap or tick (F3): bars stand on the panel floor and nothing else marks a bar', () => {
    const { store } = fakeStore(195)
    const ref = createRef<SpChartHandle>()
    show(<SpChart ref={ref} {...props(store)} />)
    const rates = ref.current!.layout()!.rates!
    const floor = rates.y + rates.height
    const group = q('g.spc-bars')!
    expect([...group.children].every(el => el.tagName === 'rect' && el.getAttribute('class')!.startsWith('spc-bar'))).toBe(true)
    for (const el of group.children) expect(Number(el.getAttribute('y')) + Number(el.getAttribute('height'))).toBeCloseTo(floor, 0)
    const plot = q('svg[data-bench-plot]')!
    expect(plot.querySelectorAll('line')).toHaveLength(0)
    for (const el of plot.querySelectorAll('*')) {
      const named = [el.getAttribute('class') ?? '', ...el.getAttributeNames()].join(' ')
      expect(named).not.toMatch(/peak|cap/i)
    }
  })

  it('shows captions as passed (the chart computes none)', () => {
    const { store } = fakeStore(195)
    show(
      <SpChart
        {...props(store, {
          captions: { rates: { peak: 87, avg: 41.6, unit: 'msg/min' }, viewers: { peak: 41234, avg: 30500 } },
        })}
      />,
    )
    const text = (sel: string) => q(sel)?.textContent
    // the data's chat max is 53; the caption shows the passed 87
    expect(text('[data-chart-scale-value="peak"]')).toBe('Peak 87')
    expect(text('[data-chart-scale-value="avg"]')).toBe('avg 42')
    expect(text('[data-chart-scale-row="rates"]')).toBe('Peak 87, avg 42 msg/min')
    expect(text('[data-chart-scale-value="viewers-peak"]')).toBe('Peak 41,234')
    expect(text('[data-chart-scale-value="viewers-avg"]')).toBe('avg 30,500')
    expect(text('[data-chart-scale-row="viewers"]')).toBe('Peak 41,234, avg 30,500 viewers')
    // an avg hairline per passed avg
    expect(q('path.spc-avg')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)

    show(<SpChart {...props(store, { captions: { rates: { peak: null } } })} />)
    expect(text('[data-chart-scale-row="rates"]')).toBe('Peak —')
    expect(q('[data-chart-scale-row="viewers"]')).toBeNull()
    expect(q('path.spc-avg')).toBeNull()
  })

  it('a store frame commits nothing; settle commits once', () => {
    const { store, frame, pending } = fakeStore(195)
    const onSettle = vi.fn()
    show(<SpChart {...props(store, { onSettle })} />)
    const scaled = q('g[data-spc-scaled]')!
    const t0 = scaled.getAttribute('transform')
    const before = commits
    const rootEl = q('.spc')!
    act(() => store.setTarget({ startIndex: 20, endIndex: 174 }))
    let frames = 0
    while (store.isMoving() && frames < 100) {
      const last = pending() === 1 && store.getVisual().startIndex === 20 && store.getVisual().endIndex === 174
      act(() => frame())
      frames += 1
      if (store.isMoving()) {
        // mid-gesture: transforms move, React does not commit
        expect(commits).toBe(before)
        expect(rootEl.hasAttribute('data-gesture')).toBe(true)
      } else expect(last).toBe(true)
    }
    expect(frames).toBeGreaterThan(5)
    expect(scaled.getAttribute('transform')).not.toBe(t0)
    expect(commits).toBe(before + 1)
    expect(onSettle).toHaveBeenCalledTimes(1)
    expect(rootEl.hasAttribute('data-gesture')).toBe(false)
    expect(q('svg[data-bench-plot]')!.getAttribute('data-bench-viewport')).toBe('20-174')
    expect(q('rect[data-chart-touch-action]')!.getAttribute('data-chart-viewport-start')).toBe('1200')
    expect(q('rect[data-chart-touch-action]')!.getAttribute('data-chart-viewport-end')).toBe(String(174 * 60))
    // the frame layer write: px = offset + scale * index
    expect(scaled.getAttribute('transform')).toBe('translate(' + (-20 * 1400) / 155 + ' 0) scale(' + 1400 / 155 + ' 1)')
  })

  it('re-windows once per half overscan of travel, never per frame, and the rect cap holds', () => {
    const n = 7 * 1440
    const d = { ...sessionData(n), coverage: new Uint8Array(n), chat: Float64Array.from({ length: n }, (_, i) => 10 + (i % 7)) }
    const { store, frame } = fakeStore(n)
    act(() => store.setTarget({ startIndex: 5000, endIndex: 5059 }, { animate: false }))
    act(() => frame())
    show(<SpChart {...props(store, { data: d })} />)
    // 60 one-minute bars plus one viewport of overscan each side
    expect(qa('rect.spc-bar').length).toBe(60 + 2 * 62)
    const before = commits
    let s = 5000, frames = 0
    // a steady pan of 4 samples a frame for 120 samples
    for (let i = 0; i < 30; i += 1) {
      s += 4
      act(() => store.setTarget({ startIndex: s, endIndex: s + 59 }))
      act(() => frame())
      frames += 1
      expect(qa('rect.spc-bar').length).toBeLessThanOrEqual(600)
    }
    while (store.isMoving()) {
      const moving = commits
      act(() => frame())
      frames += 1
      if (!store.isMoving()) expect(commits - moving).toBe(1) // the settle commit
    }
    // re-windows: one per 31 samples (half the 62-sample overscan) of travel at most, plus settle
    const mid = commits - before - 1
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(Math.ceil(120 / 31))
    expect(frames).toBeGreaterThan(30)
    expect(qa('rect.spc-bar').length).toBe(60 + 2 * 62)
    expect(q('svg[data-bench-plot]')!.getAttribute('data-bench-viewport')).toBe(s + '-' + (s + 59))
  })

  it('caps the window at 600 rects for any view', () => {
    const n = 7 * 1440
    const d = { ...sessionData(n), coverage: new Uint8Array(n), chat: Float64Array.from({ length: n }, (_, i) => 10 + (i % 7)) }
    for (const [width, span, bo] of [[8000, n - 1, null], [4000, 2000, null], [1456, 400, SESSION], [400, 3000, SESSION]] as const) {
      const { store, frame } = fakeStore(n)
      act(() => store.setTarget({ startIndex: 1000, endIndex: 1000 + span }, { animate: false }))
      act(() => frame())
      show(<SpChart {...props(store, { data: d, width, barOptions: bo })} />)
      const rects = qa('rect.spc-bar').length
      expect(rects).toBeGreaterThan(0)
      expect(rects).toBeLessThanOrEqual(600)
      show(null)
    }
  })

  it('marks sp:chart-ready once, at the first rAF after the first commit with bars', () => {
    const d = sessionData()
    const { store } = fakeStore(d.chat.length)
    show(<SpChart {...props(store, { data: d, series: { chat: false } })} />)
    expect(qa('rect.spc-bar')).toHaveLength(0)
    expect(rafQueue).toHaveLength(0)
    show(<SpChart {...props(store, { data: d })} />)
    expect(rafQueue).toHaveLength(1)
    expect(marks).toEqual([])
    runRaf()
    expect(marks).toEqual(['sp:chart-ready'])
    // later commits and a remount do not mark again
    show(<SpChart {...props(store, { data: d, captions: { rates: { peak: 1 } } })} />)
    expect(rafQueue).toHaveLength(0)
    show(null)
    show(<SpChart {...props(store, { data: d })} />)
    runRaf()
    expect(marks).toEqual(['sp:chart-ready'])
  })

  it('hub: a fixed 6-minute level at 24h, all bars on the clock grid', () => {
    const n = 1440
    const start = Date.UTC(2026, 9, 11, 21, 28)
    const d: SpChartData = { ...sessionData(n), startMs: start, coverage: new Uint8Array(n), chat: Float64Array.from({ length: n }, (_, i) => 10 + (i % 7)) }
    const { store } = fakeStore(n)
    const onLevel = vi.fn()
    show(<SpChart {...props(store, { data: d, density: 'hub', barOptions: null, fixedLevelMinutes: 6, width: 1068, onLevel })} />)
    const svg = q('svg[data-bench-plot]')!
    expect(svg.getAttribute('data-activity-bucket-minutes')).toBe('6')
    expect(onLevel).toHaveBeenCalledWith(6)
    expect(onLevel).toHaveBeenCalledTimes(1)
    expect(qa('rect.spc-bar')).toHaveLength(241) // 21:24 .. 21:24 next day
    // hub: no band row, value column 68 px
    expect(q('rect[data-chart-touch-action]')!.getAttribute('width')).toBe('1000')
  })

  it('click opens a bar; keys move the cursor, open it and close', () => {
    const { store } = fakeStore(195)
    const onBarClick = vi.fn(), onEscape = vi.fn()
    const ref = createRef<SpChartHandle>()
    show(<SpChart ref={ref} {...props(store, { onBarClick, onEscape })} />)
    const svg = q<SVGSVGElement>('svg[data-bench-plot]')!
    act(() => void svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700 })))
    expect(onBarClick).toHaveBeenCalledTimes(1)
    const hit = onBarClick.mock.calls[0]![0]
    expect(hit.index).toBe(Math.floor(700 / (1400 / 195)))
    expect(hit.levelMinutes).toBe(5)
    expect(hit.bar.fromIndex).toBeLessThanOrEqual(hit.index)
    expect(hit.bar.toIndex).toBeGreaterThan(hit.index)
    expect(hit.source).toBe('pointer')
    // over the gap there is no bar
    expect(ref.current!.hitTest((55.5 * 1400) / 195)!.bar).toBeNull()
    expect(ref.current!.hitTest(-5)).toBeNull()
    const key = (k: string) => act(() => void svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
    // the first arrow lands on the newest sample; lines run per sample at 7 px a sample
    key('ArrowLeft')
    expect(q('path.spc-hov')!.getAttribute('d')).toBe('M194 22H195V420H194Z')
    key('ArrowLeft')
    expect(q('path.spc-cross')!.getAttribute('d')).toBe('M193.5 22V420')
    key('Enter')
    expect(onBarClick).toHaveBeenCalledTimes(2)
    expect(onBarClick.mock.calls[1]![0].source).toBe('keyboard')
    expect(onBarClick.mock.calls[1]![0].index).toBe(193)
    expect(onBarClick.mock.calls[1]![0].fine).toBe(true)
    key('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('live edge: a dot with a ring per new poll value, hidden as an aria label', () => {
    const { store } = fakeStore(195)
    const live = (pollSeq: number) => props(store, { liveEdge: { atMs: START + 194 * MIN, pollSeq, label: 'Live', tone: 'live' } })
    show(<SpChart {...live(1)} />)
    const dot = q<HTMLSpanElement>('[data-chart-live-edge]')!
    expect(dot.getAttribute('data-chart-live-edge-tone')).toBe('live')
    expect(dot.style.transform).toBe('translate(' + (194 * 1400) / 195 + 'px,27px)')
    expect(q('.spc-ring')).toBeNull()
    show(<SpChart {...live(2)} />)
    const ring = q('.spc-ring')
    expect(ring).not.toBeNull()
    show(<SpChart {...live(3)} />)
    expect(q('.spc-ring')).not.toBe(ring)
    expect(q('path.spc-live-rule')).not.toBeNull()
  })
})
