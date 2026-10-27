import { act, fireEvent, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'
import {
  HubActivityChart,
  hubActivityAriaLabel,
  hubActivityHeading,
  hubActivityTip,
  hubNavigatorPresets,
  hubSpanLabel,
  viewerTrendDisplayValues,
} from '../src/ui/components/hub/HubActivityChartV5'

const MIN = 60_000
/** A clock-aligned bucket end, so the grid starts on a 6-minute boundary. */
const END = Date.UTC(2026, 9, 13, 18, 0, 0)
/** jsdom has no layout: give every element a 1600 px box (plot 1532 px at the 68 px tick column). */
const BOX_WIDTH = 1600

function day(more: (index: number) => Partial<HubActivityPoint> = () => ({})): HubActivityPoint[] {
  return Array.from({ length: 240 }, (_, index) => ({
    t: END - (239 - index) * 6 * MIN,
    chat: (100 + ((index * 37) % 200)) * 6,
    emotes: (40 + ((index * 13) % 80)) * 6,
    seventv: (20 + ((index * 7) % 20)) * 6,
    viewers: 200_000 + index * 100,
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    viewerCoverage: 'complete',
    viewerContributors: 80,
    viewerExpectedContributors: 100,
    ...more(index),
  }))
}

let clientWidth: PropertyDescriptor | undefined
beforeAll(() => {
  clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => BOX_WIDTH })
})
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})
afterEach(() => resetHubBucketSelectionForTests())

describe('HubActivityChart: the d3 activity card on SpChart', () => {
  it('heads the card with the served window and the mockup header row', () => {
    const { container } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    expect(container.querySelector('h2')!.textContent).toBe('Activity · last 24 h')
    const chips = [...container.querySelectorAll('[data-hub-series-chip]')]
    expect(chips.map((chip) => chip.textContent)).toEqual(['Chat/min', 'Emotes/min', 'Viewers (sample)'])
    expect(chips.every((chip) => chip.getAttribute('aria-pressed') === 'true')).toBe(true)
    expect(container.querySelector('[role="group"][aria-label="Series"]')).toBeTruthy()
    expect(container.querySelector('[data-hub-bars-note]')!.textContent).toBe('bars 6-min avg')
    expect(container.querySelector('button.hub-tip')!.getAttribute('aria-label')).toBe('About this chart')
  })

  it('follows the window in the heading and the chart label', () => {
    expect(hubActivityHeading(30)).toBe('Activity · last 30 min')
    expect(hubActivityHeading(1440)).toBe('Activity · last 24 h')
    expect(hubActivityHeading(10080)).toBe('Activity · last 7 days')
    expect(hubActivityAriaLabel(1440)).toBe('Activity, last 24 hours. Arrow keys move the cursor, plus and minus zoom, 0 resets, Enter selects a bucket. With a card open, left and right step; Escape closes.')
    expect(hubActivityTip(6, 1)).toBe('Tracked channels only. Each interval is 6 minutes; one bar each.')
    expect(hubActivityTip(6, 3)).toBe('Tracked channels only. Each interval is 6 minutes; bars average 3.')
    expect(hubSpanLabel(42)).toBe('42 min')
    expect(hubSpanLabel(120)).toBe('2 h')
    expect(hubSpanLabel(150)).toBe('2h 30m')
  })

  it('hatches the viewer panel where the backend states no viewer coverage, and draws no peak caps', () => {
    const gaps = day((index) => (index >= 100 && index < 110 ? { viewerCoverage: undefined, hasViewerRollup: false } : {}))
    const { container } = render(<HubActivityChart points={gaps} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    const hatch = container.querySelector('svg[data-bench-plot] .spc-hatch')
    expect(hatch).toBeTruthy()
    expect(hatch!.getAttribute('d')).toMatch(/^M/)
    const full = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    expect(full.container.querySelector('svg[data-bench-plot] .spc-hatch')).toBeNull()
    expect(container.querySelectorAll('svg[data-bench-plot] [class*="peak"], svg[data-bench-plot] [class*="cap"]')).toHaveLength(0)
  })

  it('shows the window seg only with a range control', () => {
    const { container, rerender } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    expect(container.querySelector('[data-hub-window-seg]')).toBeNull()
    rerender(
      <HubActivityChart
        points={day()}
        windowMinutes={1440}
        channelCount={100}
        bucketMinutes={6}
        rangeControl={{ active: '24h', options: [{ key: '30m', label: '30m' }, { key: '24h', label: '24h' }, { key: '7d', label: '7d' }], onSelect: () => {} }}
      />,
    )
    expect(container.querySelector('[data-hub-window-seg] [aria-pressed="true"]')!.textContent).toBe('24h')
  })

  it('draws bars on the served bucket (activity.bucketMinutes), with no peak caps and no hard-coded size', () => {
    const { container, rerender } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    const plot = container.querySelector('svg[data-bench-plot]')!
    expect(plot.getAttribute('data-activity-bucket-minutes')).toBe('6')
    expect(plot.getAttribute('aria-label')).toBe(hubActivityAriaLabel(1440))
    expect(container.querySelectorAll('.spc-bars rect, .spc-bars path').length).toBeGreaterThan(0)
    expect(container.querySelector('.hx-chat-bar-peak, [data-peak-cap], .spc-peak-cap')).toBeNull()
    expect(container.textContent).not.toMatch(/\bpeak cap\b/i)
    // A 5-minute served bucket draws 5-minute bars on the same 24 h window.
    const five = Array.from({ length: 288 }, (_, index) => ({ ...day()[index % 240]!, t: END - (287 - index) * 5 * MIN }))
    rerender(<HubActivityChart points={five} windowMinutes={1440} channelCount={100} bucketMinutes={5} />)
    expect(container.querySelector('svg[data-bench-plot]')!.getAttribute('data-activity-bucket-minutes')).toBe('5')
    expect(container.querySelector('[data-hub-bars-note]')!.textContent).toBe('bars 5-min avg')
  })

  it('splits the plot: viewers in the lower quarter, rates above (hub density)', () => {
    const { container } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    expect(container.querySelector('.spc.spc--hub')).toBeTruthy()
    expect((container.querySelector('.spc-plot') as HTMLElement).style.height).toBe('420px')
    expect(container.querySelector('svg[data-bench-plot]')!.getAttribute('height')).toBe('420')
  })

  it('keeps at least one series chip on', () => {
    const { container } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    const chip = (key: string) => container.querySelector(`[data-hub-series-chip][data-s="${key}"]`) as HTMLButtonElement
    fireEvent.click(chip('chat'))
    fireEvent.click(chip('emotes'))
    expect(chip('chat').getAttribute('aria-pressed')).toBe('false')
    expect(chip('emotes').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip('viewers'))
    expect(chip('viewers').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('chat'))
    expect(chip('chat').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-k="emotes"]')!.className).toContain('off')
  })

  it('stamps the busiest chat bucket with its top emote as a layer', async () => {
    const points = day((index) => (index === 120 ? { chat: 900 * 6, topEmotes: [{ name: 'OMEGALUL', count: 3_327 }] } : {}))
    const { container, findByRole } = render(<HubActivityChart points={points} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    const stamp = await findByRole('img', { name: 'OMEGALUL: 3,327 uses in 6 min' })
    expect(stamp.hasAttribute('data-hub-stamp')).toBe(true)
    expect(stamp.textContent).toBe('×3,327')
    // the chat chip hides the stamp with the chat bars
    fireEvent.click(container.querySelector('[data-hub-series-chip][data-s="chat"]')!)
    expect(container.querySelector('[data-hub-stamp]')).toBeNull()
  })

  it('draws two provider lanes under the navigator, aligned to the plot', () => {
    const { container } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    const lanes = container.querySelector('[data-hub-provider-lanes]')!
    expect([...lanes.querySelectorAll('.nm')].map((node) => node.textContent)).toEqual(['7TV', 'other'])
    expect(lanes.querySelector('svg')!.getAttribute('width')).toBe(String(BOX_WIDTH - 68))
    const navigator = container.querySelector('[data-hub-chart-navigator]')!
    expect(navigator.compareDocumentPosition(lanes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hosts the d3 navigator with an overview and the bucket readout', () => {
    const { container } = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} />)
    const navigator = container.querySelector('[data-hub-chart-navigator]')!
    expect(navigator.className).toContain('spc-nav')
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:239')
    expect(navigator.querySelector('.hx-chart-navigator__overview')).toBeTruthy()
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')!.textContent).toBe('240 of 240 6-min buckets · bars 6-min')
    expect(navigator.querySelector('.hx-chart-navigator__readout strong')!.textContent).toBe('Full 24 h')
    // the box-only plot hook (wheel anchor, bridge bounds) has the exact plot box
    const plotBox = container.querySelector('[data-hub-plot-box]') as HTMLElement
    expect(plotBox.style.width).toBe(`${BOX_WIDTH - 68}px`)
    expect(plotBox.style.height).toBe('420px')
    // the wheel-surface hook is the plot rows themselves, so it contains the plot's hit targets
    const surfaces = container.querySelectorAll('[data-hub-chart-wheel-surface]')
    expect(surfaces).toHaveLength(1)
    expect(surfaces[0]!.classList.contains('spc-plot')).toBe(true)
    expect(surfaces[0]!.contains(container.querySelector('svg[data-bench-plot] rect[data-chart-touch-action]'))).toBe(true)
    expect(container.querySelector('.hx-plot-stack')!.getAttribute('data-hub-chart-viewport-end')).toBe('239')
  })

  it('opens "How this is measured" from the (i)', async () => {
    let opened = 0
    const { container, findByText } = render(
      <HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} onOpenMeasured={() => { opened += 1 }} />,
    )
    act(() => { fireEvent.click(container.querySelector('button.hub-tip')!) })
    const link = await findByText('How this is measured')
    expect(document.body.textContent).toContain('Tracked channels only. Each interval is 6 minutes; one bar each.')
    act(() => { fireEvent.click(link) })
    expect(opened).toBe(1)
  })
})

describe('HubActivityChart states (backend is the truth)', () => {
  it('shows the loading state with skeleton bars', () => {
    const { container } = render(<HubActivityChart points={[]} windowMinutes={1440} channelCount={0} loading />)
    expect(container.querySelector('[data-hub-chart-state="loading"]')!.textContent).toContain('Loading measured activity…')
    expect(container.querySelector('svg[data-bench-plot]')).toBeNull()
  })

  it('withholds a malformed fallback payload instead of plotting misleading geometry', () => {
    const start = Math.floor((Date.now() - 40 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: start, chat: 10, seventv: 2, viewers: 100, bucketComplete: true },
          { t: start + 31 * 60_000, chat: 10, seventv: 2, viewers: 100, bucketComplete: true },
        ]}
        windowMinutes={30}
        channelCount={1}
        dataIssue="payload spans 31 minutes but advertises 30 served minutes"
      />,
    )
    expect(container.querySelector('[data-hub-chart-state="unavailable"]')).toBeTruthy()
    expect(container.querySelector('svg[data-bench-plot]')).toBeNull()
    expect(container.textContent).toContain('payload spans 31 minutes')
  })

  it('shows an explicit unmeasured state instead of an empty chart', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 0, gapKind: 'unmeasured' },
          { t: end, chat: 0, seventv: 0, viewers: 0, gapKind: 'unmeasured' },
        ]}
        windowMinutes={2}
        channelCount={1}
        emptyTitle="Recent live activity only"
      />,
    )
    expect(container.querySelector('[data-hub-chart-state="unmeasured"]')!.textContent).toContain('Recent live activity only')
    expect(container.querySelector('svg[data-bench-plot]')).toBeNull()
  })

  it('shows a quiet state when measured buckets contain no signals', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 0, hasChatRollup: true, hasViewerRollup: true, bucketComplete: true },
          { t: end, chat: 0, seventv: 0, viewers: 0, hasChatRollup: true, hasViewerRollup: true, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )
    expect(container.querySelector('[data-hub-chart-state="quiet"]')).toBeTruthy()
    expect(container.querySelector('svg[data-bench-plot]')).toBeNull()
  })

  it('waits for live activity with fewer than two points', () => {
    const { container } = render(<HubActivityChart points={[]} windowMinutes={1440} channelCount={0} />)
    expect(container.querySelector('[data-hub-chart-state="unmeasured"]')!.textContent).toContain('Waiting for live activity')
  })
})

describe('kept exports', () => {
  it('preserves qualified viewer peaks when another bucket makes the series partial', () => {
    const points = [400000, 3000000, 450000, 0].map((viewers, index) => ({
      t: 1789245000000 + index * 360000,
      viewers, chat: 100, seventv: 20, bucketComplete: true,
      hasViewerRollup: index < 3,
      viewerCoverage: index < 3 ? 'complete' : 'unknown',
      viewerExpectedContributors: index < 3 ? 500 : undefined,
      viewerContributors: index < 3 ? 80 : undefined,
    }))
    expect(viewerTrendDisplayValues(points, 1440)).toEqual([400000, 3000000, 450000, 0])
  })

  it('calms a legacy one-bucket spike without smoothing across a missing bucket', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const values = viewerTrendDisplayValues([
      { t: end - 4 * 60_000, chat: 10, seventv: 2, viewers: 100, hasViewerRollup: true, viewerCoverage: 'unknown', bucketComplete: true },
      { t: end - 3 * 60_000, chat: 10, seventv: 2, viewers: 10_000, hasViewerRollup: true, viewerCoverage: 'partial', bucketComplete: true },
      { t: end - 2 * 60_000, chat: 10, seventv: 2, viewers: 120, hasViewerRollup: true, viewerCoverage: 'unknown', bucketComplete: true },
      { t: end - 60_000, chat: 10, seventv: 2, viewers: 0, hasViewerRollup: false, gapKind: 'unmeasured', bucketComplete: true },
      { t: end, chat: 10, seventv: 2, viewers: 8_000, hasViewerRollup: true, viewerCoverage: 'unknown', bucketComplete: true },
    ], 5)
    expect(values).toEqual([100, 120, 120, 0, 8_000])
  })

  it('keeps the navigator presets for each window', () => {
    expect(hubNavigatorPresets(1440, 240).map((preset) => `${preset.label}:${preset.pointCount}`)).toEqual(['1h:10', '6h:60', '12h:120'])
    expect(hubNavigatorPresets(30, 30).map((preset) => preset.label)).toEqual(['5m', '15m'])
  })
})
