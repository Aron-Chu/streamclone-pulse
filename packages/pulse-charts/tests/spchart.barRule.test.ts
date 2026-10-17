// @vitest-environment jsdom

// Prod's bar rule (F21): bar width = max(1, min(48, pitch - max(1.5, pitch * .18), pitch * .72)),
// centred in its slot. Checked as a pure function and on rendered lanes / hub rects.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { barWidthPx } from '../src/sp/bars.ts'
import { SpChart } from '../src/sp/SpChart.tsx'
import { createSpViewportStore } from '../src/sp/viewportStore.ts'
import type { SpChartData, SpChartProps, SpLane } from '../src/sp/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MIN = 60_000
const START = Date.UTC(2026, 9, 11, 18, 3, 0)

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
  { key: 'chat', label: 'Chat', kind: 'bars', color: '#a78bfa', unit: '/min', barOpacity: 0.12, minBarPx: 1, trend: null },
  { key: 'emotes', label: 'Emotes', kind: 'bars', color: '#34d399', unit: '/min', barOpacity: 0.4, minBarPx: 1, trend: null },
]

const store = (count: number) => createSpViewportStore({ count, reducedMotion: () => true, raf: () => 0, cancelRaf: () => undefined, now: () => 0 })

describe('barWidthPx', () => {
  it('follows prod at 1.05, 2, 3.5 and 12 px a slot, and caps at 48', () => {
    expect(barWidthPx(1.05, 'prod')).toBe(1)
    expect(barWidthPx(2, 'prod')).toBe(1)
    expect(barWidthPx(3.5, 'prod')).toBe(2)
    expect(barWidthPx(12, 'prod')).toBeCloseTo(8.64, 10)
    expect(barWidthPx(100, 'prod')).toBe(48)
  })

  it('keeps the hub rule (a 2 / 1 / 0.5 px gap, at least 0.6 px) without a rule', () => {
    expect(barWidthPx(12)).toBe(10)
    expect(barWidthPx(3.5)).toBe(3)
    expect(barWidthPx(2)).toBe(1.5)
    expect(barWidthPx(1.05)).toBe(0.6)
  })
})

describe('rendered bars under the prod rule', () => {
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
  const render = (n: number, PW: number, more: Partial<SpChartProps> = {}) =>
    act(() =>
      root!.render(
        createElement(SpChart, {
          data: data(n),
          viewport: store(n),
          plotHeight: 440,
          width: PW + 56,
          tickColumnPx: 56,
          barOptions: { minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 1500 },
          ...more,
        }),
      ),
    )
  const rects = (sel: string) => [...container.querySelectorAll(sel)]

  // pitch = PW / n px a minute; 1-minute bars at every pitch here
  for (const [pitch, n, PW] of [[12, 100, 1200], [3.5, 200, 700], [2, 600, 1200], [1.05, 1000, 1050]] as const) {
    it(`draws ${pitch} px slots as ${barWidthPx(pitch, 'prod')} px bars centred in each minute (lanes)`, () => {
      render(n, PW, { lanes: LANES })
      expect(container.querySelector('svg[data-bench-plot]')!.getAttribute('data-activity-bucket-minutes')).toBe('1')
      const rs = rects('g.spc-lane-bars[data-lane="chat"] rect.spc-bar')
      expect(rs).toHaveLength(n)
      const sx = PW / n
      rs.forEach((r, i) => {
        const x = Number(r.getAttribute('x')), w = Number(r.getAttribute('width'))
        expect(w * sx).toBeCloseTo(barWidthPx(pitch, 'prod'), 2)
        expect(x + w / 2).toBeCloseTo(i + 0.5, 3)
      })
    })
  }

  it('applies the rule to the hub bars when passed, and keeps the hub gap rule otherwise', () => {
    render(100, 1200, { density: 'session', barOptions: { minSlotPx: 5, tolerance: 0.85, rule: 'prod' } })
    const prod = rects('g.spc-bars rect.spc-bar')
    expect(prod).toHaveLength(100)
    expect(Number(prod[3]!.getAttribute('width')) * 12).toBeCloseTo(8.64, 2)
    expect(Number(prod[3]!.getAttribute('x')) + Number(prod[3]!.getAttribute('width')) / 2).toBeCloseTo(3.5, 3)
    render(100, 1200, { density: 'session', barOptions: { minSlotPx: 5, tolerance: 0.85 } })
    const hub = rects('g.spc-bars rect.spc-bar')
    // 12 px slots: a 2 px gap, the bar starts 1 px in
    expect(Number(hub[3]!.getAttribute('width')) * 12).toBeCloseTo(10, 2)
    expect(Number(hub[3]!.getAttribute('x')) * 12).toBeCloseTo(3 * 12 + 1, 2)
  })
})
