// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import { makeFullHistoryActivation } from '../src/shared/fullHistoryAuth.ts'
import { ChartReadoutBand } from '../src/ui/ChartReadoutBand.tsx'
import { RecapTimelineChart } from '../src/ui/RecapTimelineChart.tsx'
import { PulseOverviewChart, type ChartBarSummary } from '../src/ui/PulseOverviewChart.tsx'
import { FULL_TIMELINE_MAX_POINTS, prepareBarRollups, prepareChartRollups } from '../src/ui/chatActivityEmotes.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Zoom-aware bars: the panel's chat and emote bars average aligned minute
 * slots whose length follows the zoom (spec §3, 2026-10-09). At the 340px
 * chat column a 12 h stream draws 48 bars of 15 minutes per lane.
 */

const PANEL_WIDTH = 340

function minutes(count: number, value: (index: number) => Partial<ExtensionRollup> = () => ({})): ExtensionRollup[] {
  return Array.from({ length: count }, (_, index) => ({
    offsetSeconds: index * 60,
    chatCount: 40,
    sevenTvEmoteCount: 4,
    totalEmoteCount: 10,
    viewerCount: 1000,
    ...value(index),
  }))
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  // The chart sizes itself from its container; give it the chat column width.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: PANEL_WIDTH, bottom: 160, width: PANEL_WIDTH, height: 160, toJSON: () => ({}),
  } as DOMRect)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function render(props: Parameters<typeof PulseOverviewChart>[0]): SVGSVGElement {
  act(() => root.render(<PulseOverviewChart reducedMotion {...props} />))
  const svg = host.querySelector<SVGSVGElement>('svg[data-testid="pulse-overview-chart"]')
  if (!svg) throw new Error('chart did not render')
  return svg
}

const bars = (svg: SVGSVGElement, lane: 'chat' | 'emotes') =>
  [...svg.querySelectorAll<SVGRectElement>(`rect[data-chart-signal-bar="${lane}"]`)]
const num = (element: Element, name: string) => Number(element.getAttribute(name))

describe('PulseOverviewChart zoom-aware bars', () => {
  it('draws 48 fifteen-minute bars per lane for 12 h at the 340px chat column', () => {
    const rollups = minutes(720)
    const svg = render({ rollups, durationSeconds: 720 * 60, viewport: { startSeconds: 0, endSeconds: 720 * 60 } })
    expect(svg.getAttribute('data-chart-bar-minutes')).toBe('15')
    expect(bars(svg, 'chat')).toHaveLength(48)
    expect(bars(svg, 'emotes')).toHaveLength(48)
    // Evenly sized: every full bar has the same width (slot less a 20% gap).
    const widths = new Set(bars(svg, 'chat').slice(1, -1).map(bar => num(bar, 'width').toFixed(2)))
    expect(widths.size).toBe(1)
    expect(num(bars(svg, 'chat')[10]!, 'width')).toBeGreaterThan(4)
  })

  it('re-buckets to 5 and then 1 minute as the view narrows, with hysteresis', () => {
    const rollups = minutes(720)
    const at = (startSeconds: number, endSeconds: number) =>
      render({ rollups, durationSeconds: 720 * 60, viewport: { startSeconds, endSeconds } }).getAttribute('data-chart-bar-minutes')
    expect(at(0, 720 * 60)).toBe('15')
    expect(at(0, 180 * 60)).toBe('5')
    // One hour on 324 px is 5.4 px a minute: a fresh pick is 1, but coming
    // from 5 the view holds 2 until 1-minute slots clear 5.75 px.
    expect(at(0, 60 * 60)).toBe('2')
    expect(at(0, 50 * 60)).toBe('1')
    // Zooming back out to an hour keeps 1 (it only coarsens below 4.25 px).
    expect(at(0, 60 * 60)).toBe('1')
    expect(at(0, 21 * 60)).toBe('1')
    // A fresh chart at one hour picks 1 straight away.
    act(() => root.unmount())
    root = createRoot(host)
    expect(at(0, 60 * 60)).toBe('1')
  })

  it('averages each slot, caps it at its peak minute, and leaves level 1 uncapped', () => {
    // Slot 0-14: chat 10 with one 100 minute; slot 15-29: chat 20 throughout.
    const rollups = minutes(720, index => ({
      chatCount: index < 15 ? (index === 7 ? 100 : 10) : index < 30 ? 20 : 15,
    }))
    const svg = render({ rollups, durationSeconds: 720 * 60, viewport: { startSeconds: 0, endSeconds: 720 * 60 } })
    const [first, second] = bars(svg, 'chat')
    const average = (10 * 14 + 100) / 15
    // Heights follow the averages (both sit under the lane's axis maximum).
    expect(num(first!, 'height') / num(second!, 'height')).toBeCloseTo(average / 20, 2)
    const caps = [...svg.querySelectorAll<SVGRectElement>('rect[data-chart-bar-peak]')]
    const firstCap = caps.find(cap => num(cap, 'x') === num(first!, 'x'))
    expect(firstCap).toBeTruthy()
    expect(num(firstCap!, 'height')).toBe(1)
    expect(num(firstCap!, 'y')).toBeLessThan(num(first!, 'y'))
    expect(firstCap!.getAttribute('fill')).toBe(first!.getAttribute('fill'))
    // An even slot has no cap.
    expect(caps.some(cap => num(cap, 'x') === num(second!, 'x'))).toBe(false)

    const zoomed = render({ rollups, durationSeconds: 720 * 60, viewport: { startSeconds: 0, endSeconds: 40 * 60 } })
    expect(zoomed.getAttribute('data-chart-bar-minutes')).toBe('1')
    expect(zoomed.querySelectorAll('rect[data-chart-bar-peak]')).toHaveLength(0)
  })

  it('marks a slot with unmeasured minutes as partial and fades it', () => {
    const rollups = minutes(720, index => (index >= 33 && index < 36 ? { missing: true, chatCount: 0 } : {}))
    const svg = render({ rollups, durationSeconds: 720 * 60, viewport: { startSeconds: 0, endSeconds: 720 * 60 } })
    const chat = bars(svg, 'chat')
    expect(chat[2]!.getAttribute('data-chart-bar-partial')).toBe('true')
    expect(chat[1]!.hasAttribute('data-chart-bar-partial')).toBe(false)
    expect(chat[3]!.hasAttribute('data-chart-bar-partial')).toBe(false)
    // 12 of 15 minutes measured: the bar fades to 80% of its neighbours.
    expect(num(chat[2]!, 'opacity') / num(chat[1]!, 'opacity')).toBeCloseTo(12 / 15, 5)
  })

  it('reports the pinned bar with its slot, averages and measured share', () => {
    const onBarChange = vi.fn<(bar: ChartBarSummary | null) => void>()
    const rollups = minutes(720, index => ({
      chatCount: index === 40 ? 845 : 280,
      missing: index >= 41 && index < 44 ? true : undefined,
    }))
    const svg = render({
      rollups,
      durationSeconds: 720 * 60,
      viewport: { startSeconds: 0, endSeconds: 720 * 60 },
      selectedIndex: 37,
      onBarChange,
    })
    const bar = onBarChange.mock.lastCall?.[0]
    expect(bar).toMatchObject({ step: 15, startSeconds: 1800, endSeconds: 2700, observed: 12, expected: 15 })
    expect(bar!.peak[0]).toBe(845)
    expect(bar!.avg[0]).toBeCloseTo((280 * 11 + 845) / 12)
    expect(bar!.avg[2]).toBe(1000)
    // The pinned minute's bar is the locked one.
    const locked = bars(svg, 'chat').filter(rect => rect.getAttribute('data-chart-bar-highlight') === 'locked')
    expect(locked).toHaveLength(1)
    expect(locked[0]).toBe(bars(svg, 'chat')[2])
  })

  it('reports the keyboard-previewed bar, and none at level 1', () => {
    const onBarChange = vi.fn<(bar: ChartBarSummary | null) => void>()
    const rollups = minutes(720)
    const svg = render({
      rollups,
      durationSeconds: 720 * 60,
      viewport: { startSeconds: 0, endSeconds: 720 * 60 },
      onSelectIndex: () => undefined,
      onBarChange,
    })
    const scrubber = svg.querySelector<SVGRectElement>('[data-chart-scrubber="true"]')!
    act(() => {
      scrubber.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(onBarChange.mock.lastCall?.[0]).toMatchObject({ step: 15, startSeconds: 705 * 60, endSeconds: 720 * 60 })
    const hovered = bars(svg, 'chat').filter(rect => rect.getAttribute('data-chart-bar-highlight') === 'hovered')
    expect(hovered).toEqual([bars(svg, 'chat').at(-1)])

    onBarChange.mockClear()
    render({
      rollups: minutes(21),
      durationSeconds: 21 * 60,
      viewport: { startSeconds: 0, endSeconds: 21 * 60 },
      selectedIndex: 5,
      onBarChange,
    })
    expect(onBarChange).toHaveBeenLastCalledWith(null)
  })

  it('uses the one-minute bar rows when the chart rows are thinned', () => {
    const minuteRows = minutes(720, index => ({ chatCount: index % 15 === 0 ? 200 : 20 }))
    // 480 averaged rows of mixed width, as Full past 8 h hands the lines.
    const thinned = Array.from({ length: 480 }, (_, index) => ({ ...minuteRows[Math.floor(index * 1.5)]!, chatCount: 30 }))
    const svg = render({
      rollups: thinned,
      barRollups: minuteRows,
      durationSeconds: 720 * 60,
      viewport: { startSeconds: 0, endSeconds: 720 * 60 },
    })
    expect(bars(svg, 'chat')).toHaveLength(48)
    // No false partial bars from the mixed-width rows, and the peaks come from real minutes.
    expect(svg.querySelectorAll('[data-chart-bar-partial]')).toHaveLength(0)
    expect(svg.querySelectorAll('rect[data-chart-bar-peak][data-chart-bar-peak=""]').length).toBeGreaterThan(40)
  })
})

describe('RecapTimelineChart bar readout (Past streams and VODs)', () => {
  it('names the pinned bar in the readout band, and the exact minute at 1-minute level', () => {
    const recap = (count: number) => ({
      login: 'fixturechan',
      isLive: false,
      tracking: true,
      streamId: 'stream-recap-bars',
      vodId: '2806037629',
      currentOffsetSeconds: count * 60,
      durationSeconds: count * 60,
      rollups: minutes(count, index => ({ chatCount: index === 40 ? 845 : 280 })),
      lanes: { composite: [], chat: [], seventv: [] },
      recap: null,
    }) as PulsePayload
    const props = { backendUrl: 'https://api.streampulse.stream', peakOffsets: [], catalog: [], onSelectPoint: () => undefined }
    act(() => root.render(<RecapTimelineChart {...props} payload={recap(720)} pinOffsetSeconds={37 * 60} />))
    const readout = () => host.querySelector('[data-chart-readout="true"]')
    expect(readout()?.getAttribute('data-chart-readout-state')).toBe('selected')
    expect(host.querySelector('[data-chart-readout-bar]')?.getAttribute('data-chart-readout-bar')).toBe('15')
    expect(readout()?.querySelector('.pulse-readout-time')?.textContent).toBe('00:30:00–00:45:00')
    expect(readout()?.textContent).toContain('pk 845')

    act(() => root.render(<RecapTimelineChart {...props} payload={recap(21)} pinOffsetSeconds={5 * 60} />))
    expect(host.querySelector('[data-chart-readout-bar]')).toBeNull()
    expect(readout()?.querySelector('.pulse-readout-time')?.textContent).toBe('00:05:00')
  })
})

describe('ChartReadoutBand bar summary', () => {
  const summary: ChartBarSummary = {
    step: 15,
    slotMs: undefined as never,
    startMs: 1_800_000,
    firstMs: 1_800_000,
    lastMs: 2_640_000,
    from: 30,
    to: 45,
    observed: 12,
    expected: 15,
    avg: [280.4, 98, 1234.6],
    peak: [845, 410, 1300],
    peakAt: [40, 31, 30],
    startSeconds: 1800,
    endSeconds: 2700,
  } as ChartBarSummary

  it('shows the slot, the average with its peak, and the measured share', () => {
    const html = renderToStaticMarkup(
      <ChartReadoutBand mode="preview" offsetSeconds={2220} chatValue={300} emoteValue={100} viewerValue={1200} backendUrl="https://api.streampulse.stream" bar={summary} topEmotes={[{ name: 'KEKW', count: 3 }]} />,
    )
    expect(html).toContain('00:30:00–00:45:00')
    expect(html).toContain('data-chart-readout-bar="15"')
    expect(html).toContain('15-min avg · 12/15 min')
    expect(html).toContain('280.4<small class="pulse-readout-peak"> pk 845</small>')
    expect(html).toContain('98<small class="pulse-readout-peak"> pk 410</small>')
    expect(html).toContain('>1,235<')
    // Per-minute emote chips are hidden while a bar summary shows.
    expect(html).not.toContain('data-chart-readout-emotes')
  })

  it('reads the exact minute as before without a summary, and ignores one at rest', () => {
    const props = { offsetSeconds: 2220, chatValue: 300, emoteValue: 100, viewerValue: 1200, backendUrl: 'https://api.streampulse.stream' }
    const plain = renderToStaticMarkup(<ChartReadoutBand mode="preview" {...props} />)
    expect(plain).toContain('00:37:00')
    expect(plain).not.toContain('data-chart-readout-bar')
    expect(plain).not.toContain(' pk ')
    expect(renderToStaticMarkup(<ChartReadoutBand mode="preview" {...props} bar={null} />)).toBe(plain)
    expect(renderToStaticMarkup(<ChartReadoutBand mode="idle" {...props} bar={summary} />)).not.toContain('min avg')
  })
})

describe('prepareBarRollups', () => {
  function payload(totalMinutes: number, hole?: [number, number]): PulsePayload {
    const fullRollups = minutes(totalMinutes).filter(rollup => !hole || rollup.offsetSeconds < hole[0] || rollup.offsetSeconds >= hole[1])
    return {
      login: 'fixturechan',
      streamId: 'stream-bars',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: totalMinutes * 60,
      coverageStartOffsetSeconds: 0,
      rollups: fullRollups.slice(-30),
      fullRollups,
      coverage: {
        state: hole ? 'missing_ranges_detected' : 'full_stream_tracked',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: totalMinutes * 60,
        hasFullStreamCoverage: !hole,
        trackedFromStart: true,
        hasGaps: Boolean(hole),
        missingRanges: hole ? [{ fromOffsetSeconds: hole[0], toOffsetSeconds: hole[1] }] : [],
        canBackfill: false,
      },
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    } as PulsePayload
  }
  const activation = makeFullHistoryActivation({ login: 'fixturechan', streamId: 'stream-bars' })

  it('is undefined until Full is thinned past 8 h, and without validated full history', () => {
    const short = payload(FULL_TIMELINE_MAX_POINTS)
    expect(prepareBarRollups(short, { chartWindow: 'full', currentOffsetSeconds: short.currentOffsetSeconds!, activation })).toBeUndefined()
    const long = payload(720)
    expect(prepareBarRollups(long, { chartWindow: '4h', currentOffsetSeconds: long.currentOffsetSeconds!, activation })).toBeUndefined()
    const other = makeFullHistoryActivation({ login: 'fixturechan', streamId: 'another-stream' })
    expect(prepareBarRollups(long, { chartWindow: 'full', currentOffsetSeconds: long.currentOffsetSeconds!, activation: other })).toBeUndefined()
  })

  it('returns the uncapped one-minute grid with its missing minutes past 8 h', () => {
    const long = payload(720, [3 * 3600, 3 * 3600 + 30 * 60])
    const options = { chartWindow: 'full' as const, currentOffsetSeconds: long.currentOffsetSeconds!, activation }
    expect(prepareChartRollups(long, options)).toHaveLength(FULL_TIMELINE_MAX_POINTS)
    const grid = prepareBarRollups(long, options)!
    expect(grid.length).toBeGreaterThanOrEqual(720)
    const steps = new Set(grid.slice(1).map((rollup, index) => rollup.offsetSeconds - grid[index]!.offsetSeconds))
    expect([...steps]).toEqual([60])
    const missing = grid.filter(rollup => rollup.missing).map(rollup => rollup.offsetSeconds)
    expect(missing).toHaveLength(30)
    expect(missing[0]).toBe(3 * 3600)
  })
})
