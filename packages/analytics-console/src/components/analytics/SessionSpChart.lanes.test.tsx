import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { createSpHoverStore, createSpViewportStore } from '@streampulse/pulse-charts/spchart'
import type { AnalyticsMinuteRollup } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { SessionSpChart, sessionLanes, sessionPlotHeight, type SessionSpChartProps } from './SessionSpChart.tsx'
import type { SessionPin } from './SessionChartPins.tsx'
import { buildSessionChartModel } from './sessionSpChartModel.ts'
import { HARNESS_STARTED_AT, harnessDetail, holdFrames, setStackWidth, type HeldFrames } from './__fixtures__/sessionChartHarness.ts'

const motion = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: motion.enabled }) }))

let frames: HeldFrames | null = null
let restoreWidth: (() => void) | null = null
afterEach(() => {
  cleanup()
  frames?.restore()
  restoreWidth?.()
  frames = null
  restoreWidth = null
  motion.enabled = false
})

const detail = harnessDetail(180)
const model = buildSessionChartModel({ rollups: detail.rollups, streamStartedAt: HARNESS_STARTED_AT, overlayKeys: ['Kappa'] })!

type ChartProps = ComponentProps<typeof AnalyticsChart>
function renderChart(overrides: Partial<ChartProps> = {}) {
  restoreWidth = setStackWidth(1400)
  frames = holdFrames(act)
  const props: ChartProps = {
    detail,
    selectedEmotes: new Set(['Kappa']),
    onSelectEmote: vi.fn(),
    selectedRollup: null,
    onSelectRollup: vi.fn(),
    viewMode: 'overview',
    onViewModeChange: vi.fn(),
    ...overrides,
  }
  const view = render(<AnalyticsChart {...props} />)
  frames.flush()
  const rerenderWith = (more: Partial<ChartProps>, flush = true) => {
    view.rerender(<AnalyticsChart {...props} {...more} />)
    if (flush) frames!.flush()
  }
  return { ...view, rerenderWith }
}

const lanesOf = (container: HTMLElement) => [...container.querySelectorAll('g.spc-lane-bg')].map(g => g.getAttribute('data-lane'))

describe('session lanes (d3-v2 session-original)', () => {
  it('builds Viewers, Chat, Emotes and the plotted-emote lane in prod’s colours and opacities', () => {
    const lanes = sessionLanes(model, { series: {}, overlays: model.overlays, showAvg: false })
    expect(lanes.map(L => [L.key, L.kind, L.color])).toEqual([
      ['viewers', 'area', '#22d3ee'],
      ['chat', 'bars', '#a78bfa'],
      ['emotes', 'bars', '#34d399'],
      ['overlay', 'line', '#fb7185'],
    ])
    const [v, c, e, o] = lanes
    expect([v!.lineOpacity, v!.gradient, v!.smooth]).toEqual([0.85, [0.16, 0], true])
    expect([c!.barOpacity, c!.trend?.opacity, c!.gap]).toEqual([0.12, 0.84, 8])
    expect([e!.barOpacity, e!.spikeOpacity, e!.trend?.opacity, e!.gap]).toEqual([0.4, 0.72, 0.84, 0])
    // F24: the emote lane has no caption; one trace per plotted emote, a shorter lane
    expect([o!.caption, o!.weight, o!.bridge, o!.lines?.map(l => [l.key, l.color])]).toEqual([false, 0.55, false, [['Kappa', '#fb7185']]])
    // no lane draws a baseline (session-original: baseline false)
    expect(lanes.every(L => L.baseline === false)).toBe(true)
  })

  it('sets one emote spike threshold for the stream: 0.55 of ceil(max + 5 % of the min-max span)', () => {
    // emotes 2..10: 0.55 * ceil(10 + 0.4) = 6.05
    expect(model.emoteSpike).toBeCloseTo(6.05, 10)
    expect(sessionLanes(model, { series: {}, overlays: [], showAvg: false })[2]!.spikeAbs).toBeCloseTo(6.05, 10)
  })

  it('picks lanes with the series segment; the emote lane shows with All and Emotes only', () => {
    const { container, rerenderWith } = renderChart()
    expect(lanesOf(container)).toEqual(['viewers', 'chat', 'emotes', 'overlay'])
    const line = container.querySelector('path[data-lane-line="Kappa"]')!
    expect(line.getAttribute('stroke')).toBe('#fb7185')
    expect(container.querySelector('[data-chart-lane-caption="overlay"]')).toBeNull()
    // the emote lane keeps its own max tick
    expect(container.querySelector('text.spc-tk[data-lane="overlay"]')).not.toBeNull()
    rerenderWith({ viewMode: 'chat' })
    expect(lanesOf(container)).toEqual(['chat'])
    rerenderWith({ viewMode: 'emotes' })
    expect(lanesOf(container)).toEqual(['emotes', 'overlay'])
    rerenderWith({ viewMode: 'viewers' })
    expect(lanesOf(container)).toEqual(['viewers'])
    expect(container.querySelector('path[data-lane-line]')).toBeNull()
  })

  it('lights emote bars over the spike threshold at .72, the rest at .4', () => {
    const { container } = renderChart()
    const rects = [...container.querySelectorAll('g.spc-lane-bars[data-lane="emotes"] rect.spc-bar')]
    expect(rects).toHaveLength(180)
    // emotes at minute i are 2 + i % 9: 7..10 are over 6.05
    rects.forEach((r, i) => expect(r.getAttribute('fill-opacity')).toBe(2 + (i % 9) > 6.05 ? '0.72' : '0.4'))
  })

  it('draws the selected minute as a band through every lane, and slides it to the next selection', () => {
    motion.enabled = true
    const rollup = (i: number) => detail.rollups[i] as AnalyticsMinuteRollup
    const { container, rerenderWith } = renderChart({ selectedRollup: rollup(40) })
    const band = () => container.querySelector('rect[data-chart-selband]')!
    const sx = 1344 / 180
    expect(Number(band().getAttribute('x'))).toBeCloseTo(40 + 0.5 / sx, 3)
    expect(band().hasAttribute('data-sliding')).toBe(false)
    expect(band().getAttribute('y')).toBe('22.5')
    rerenderWith({ selectedRollup: rollup(100) }, false)
    // mid-slide after one frame, then settled on minute 100
    expect(band().hasAttribute('data-sliding')).toBe(true)
    frames!.step(16)
    const mid = Number(band().getAttribute('x'))
    expect(mid).toBeGreaterThan(40)
    expect(mid).toBeLessThan(100)
    frames!.flush()
    expect(Number(band().getAttribute('x'))).toBeCloseTo(100 + 0.5 / sx, 3)
    expect(band().hasAttribute('data-sliding')).toBe(false)
  })

  it('jumps the band under reduced motion', () => {
    const rollup = (i: number) => detail.rollups[i] as AnalyticsMinuteRollup
    const { container, rerenderWith } = renderChart({ selectedRollup: rollup(40) })
    rerenderWith({ selectedRollup: rollup(100) })
    const band = container.querySelector('rect[data-chart-selband]')!
    expect(Number(band.getAttribute('x'))).toBeCloseTo(100 + 0.5 / (1344 / 180), 3)
    expect(band.hasAttribute('data-sliding')).toBe(false)
  })

  it('breaks the lines at an unmeasured minute 6 px or wider, and joins across a narrower one', () => {
    // 1344 / 180 = 7.5 px a minute: the one-minute hole breaks the viewers line
    const { container } = renderChart({ detail: harnessDetail(180, { skip: [60] }), selectedEmotes: new Set() })
    const viewersRuns = () => container.querySelector('g.spc-lane-area path[stroke="#22d3ee"]')!.getAttribute('d')!.match(/M/g)!.length
    expect(viewersRuns()).toBe(2)
    cleanup()
    frames?.restore()
    restoreWidth?.()
    // 1344 / 748 = 1.8 px a minute: the same hole joins
    renderChart({ detail: harnessDetail(748, { skip: [60] }), selectedEmotes: new Set() })
    expect(document.querySelector('g.spc-lane-area path[stroke="#22d3ee"]')!.getAttribute('d')!.match(/M/g)).toHaveLength(1)
  })
})

describe('SessionSpChart heights', () => {
  it('uses 440 / 580 and 340 / 420 on phones', () => {
    expect([sessionPlotHeight(false, false), sessionPlotHeight(true, false), sessionPlotHeight(false, true), sessionPlotHeight(true, true)]).toEqual([440, 580, 340, 420])
  })

  it('adds extraPlotPx (the column fill) to the plot height, and leaders run to the last lane’s floor', () => {
    const store = createSpViewportStore({ count: model.n, reducedMotion: () => true, raf: () => 0, cancelRaf: () => undefined, now: () => 0 })
    const pin: SessionPin = { rank: 1, offsetSeconds: 600, atMs: model.originMs + 600_000, pinMs: model.originMs + 630_000, emote: null, tokens: [] }
    const props: SessionSpChartProps = {
      model, store, hover: createSpHoverStore(), width: 1400, plotHeight: 440, phone: false, series: {},
      captions: {}, liveEdge: null, highlightRange: null, selected: null,
      band: { segments: [], highlightedKey: null, onHoverKey: () => {} },
      pins: { list: [pin], selectedIndex: 0, onSelect: () => {}, onClear: () => {} },
      showPins: true, overlays: [], previewOffsetSeconds: null, navigator: null, onBarClick: () => {},
    }
    frames = holdFrames(act)
    const { container, rerender } = render(<SessionSpChart {...props} />)
    frames.flush()
    expect(container.querySelector<HTMLElement>('.spc-plot')?.style.height).toBe('440px')
    expect(container.querySelector('.ssc-leader-on')!.getAttribute('d')).toMatch(/V440\.0$/)
    rerender(<SessionSpChart {...props} extraPlotPx={60} />)
    frames.flush()
    expect(container.querySelector<HTMLElement>('.spc-plot')?.style.height).toBe('500px')
    expect(container.querySelector('.ssc-leader-on')!.getAttribute('d')).toMatch(/V500\.0$/)
  })
})
