// @vitest-environment jsdom

// The sliding selection band (F23, selSlide): placed at once on the first select and on a
// level change, slides to a new selection with prod's useSmoothedScalar (fake rAF here),
// jumps under reduced motion, and snaps once it is within 0.25 px.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpChart } from '../src/sp/SpChart.tsx'
import { createSpViewportStore } from '../src/sp/viewportStore.ts'
import type { SpBarOptions, SpChartData, SpLane, SpSelSlide } from '../src/sp/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MIN = 60_000
const START = Date.UTC(2026, 9, 11, 18, 3, 0)
const N = 195
const PW = 1400
const SX = PW / N

function data(n: number): SpChartData {
  const chat = new Float64Array(n), emotes = new Float64Array(n), viewers = new Float64Array(n), coverage = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    chat[i] = 20 + ((i * 7) % 34)
    emotes[i] = 4 + (i % 9)
    viewers[i] = 30_000 + i * 20
  }
  return { startMs: START, stepMs: MIN, chat, emotes, viewers, coverage, overlay: null }
}

const LANES: SpLane[] = [
  { key: 'viewers', label: 'Viewers', kind: 'area', color: '#22d3ee', smooth: true, gradient: [0.16, 0] },
  { key: 'chat', label: 'Chat', kind: 'bars', color: '#a78bfa', unit: '/min', barOpacity: 0.12, minBarPx: 1, trend: { opacity: 0.84 } },
]
const BARS: SpBarOptions = { minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 1500 }
const D = data(N)
const VIEW = createSpViewportStore({ count: N, reducedMotion: () => true, raf: () => 0, cancelRaf: () => undefined, now: () => 0 })

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const minute = (i: number) => ({ startMs: START + i * MIN, endMs: START + (i + 1) * MIN, kind: 'minute' as const })

describe('SpChart selSlide band', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  let queue: Map<number, FrameRequestCallback>
  let nextId = 0
  let clock = 0
  beforeEach(() => {
    queue = new Map()
    clock = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (queue.set(++nextId, cb), nextId))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void queue.delete(id))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const band = () => container.querySelector('rect[data-chart-selband]')
  const bx = () => Number(band()!.getAttribute('x'))
  /** One 16 ms frame: runs every queued callback. */
  const frame = () =>
    act(() => {
      clock += 16
      const due = [...queue.values()]
      queue.clear()
      due.forEach(cb => cb(clock))
    })
  const render = (sel: ReturnType<typeof minute> | null, slide: SpSelSlide = { reducedMotion: () => false }, bars: SpBarOptions = BARS) =>
    act(() =>
      root!.render(<SpChart data={D} viewport={VIEW} plotHeight={440} width={PW + 56} tickColumnPx={56} barOptions={bars} lanes={LANES} selected={sel} selSlide={slide} />),
    )

  it('places the band in place on the first select, through every lane', () => {
    render(minute(120))
    const b = band()!
    expect(b.getAttribute('class')).toBe('spc-selband')
    expect(bx()).toBe(r4(120 + 0.5 / SX))
    expect(Number(b.getAttribute('width'))).toBe(r4(1 - 1 / SX))
    expect(b.hasAttribute('data-sliding')).toBe(false)
    expect(Number(b.getAttribute('y'))).toBe(22.5)
    // no outline path with a band
    expect(container.querySelector('path.spc-sel')).toBeNull()
  })

  it('slides to a new selection frame by frame and snaps within 0.25 px', () => {
    render(minute(120))
    render(minute(60))
    // still where it was until a frame runs
    expect(bx()).toBe(r4(120 + 0.5 / SX))
    expect(band()!.hasAttribute('data-sliding')).toBe(true)
    frame()
    const one = bx()
    expect(one).toBeLessThan(120)
    expect(one).toBeGreaterThan(60)
    // exponential settle (190 ms): about 8% of the way after one 16 ms frame
    expect(120 + 0.5 / SX - one).toBeCloseTo(60 * (1 - Math.exp(-16 / 190)), 2)
    const xs = [one]
    for (let k = 0; k < 200 && queue.size; k += 1) {
      frame()
      xs.push(bx())
    }
    const target = r4(60 + 0.5 / SX)
    expect(xs[xs.length - 1]).toBe(target)
    expect(band()!.hasAttribute('data-sliding')).toBe(false)
    // the last eased value before the snap is within 0.25 px of the target
    const before = xs.filter(x => x !== target).at(-1)!
    expect(Math.abs(before - target) * SX).toBeLessThan(0.25)
    // it never overshoots
    expect(xs.every(x => x >= target - 1e-9)).toBe(true)
  })

  it('jumps under reduced motion', () => {
    render(minute(120), { reducedMotion: () => true })
    render(minute(30), { reducedMotion: () => true })
    expect(bx()).toBe(r4(30 + 0.5 / SX))
    expect(band()!.hasAttribute('data-sliding')).toBe(false)
  })

  it('re-places in place when the bar level changes', () => {
    render(minute(120))
    // a rect cap of 60 coarsens the level, so the selection snaps outward to a wider bar
    render(minute(121), { reducedMotion: () => false }, { ...BARS, maxRects: 60 })
    const step = Number(container.querySelector('svg[data-bench-plot]')!.getAttribute('data-activity-bucket-minutes'))
    expect(step).toBeGreaterThan(1)
    const b = band()!
    expect(b.hasAttribute('data-sliding')).toBe(false)
    const x0 = bx() - 0.5 / SX
    expect(x0).toBeLessThanOrEqual(121)
    expect(x0 + Number(b.getAttribute('width')) + 1 / SX).toBeGreaterThanOrEqual(122 - 1e-3)
    expect(Number(b.getAttribute('width')) + 1 / SX).toBeCloseTo(step, 3)
  })

  it('draws no band without a selection, and the outline without selSlide', () => {
    render(null)
    expect(band()).toBeNull()
    act(() => root!.render(<SpChart data={D} viewport={VIEW} plotHeight={440} width={PW + 56} tickColumnPx={56} barOptions={BARS} lanes={LANES} selected={minute(120)} />))
    expect(band()).toBeNull()
    expect(container.querySelector('path.spc-sel')).not.toBeNull()
  })
})
