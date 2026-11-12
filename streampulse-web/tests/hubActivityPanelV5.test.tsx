import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'
import { summarizeActivity } from '../src/lib/hubActivitySummary'
import { normalizePublicHub, type HubActivityPoint } from '../src/lib/publicHub'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'

afterEach(() => {
  cleanup()
  resetHubBucketSelectionForTests()
})

/** The page's hub before any reply: the empty payload, named with the range picked (24h). */
const empty = normalizePublicHub(null)
const notLanded = { ...empty, activity: { ...empty.activity, windowMinutes: 24 * 60 } }

const panel = (awaitingData: boolean) => render(<MemoryRouter>
  <HubActivityPanelV5
    hub={notLanded}
    activitySummary={summarizeActivity([], 30, 0)}
    suggestions={[]}
    loading
    awaitingData={awaitingData}
  />
</MemoryRouter>)

describe('HubActivityPanelV5 while the first hub reply is loading', () => {
  it('heads the chart with the range picked, not the empty payload\'s 30 min', () => {
    const { container } = panel(true)
    expect(container.querySelector('h2')!.textContent).toBe('Activity · last 24 h')
    expect(container.querySelector('[data-hub-activity-state]')!.getAttribute('data-hub-activity-state')).toBe('loading')
  })

  it('keeps the chart\'s 220 px space while it waits', () => {
    const { container } = panel(true)
    expect(container.querySelector<HTMLElement>('.hub-act-skeleton')!.style.height).toBe('220px')
  })

  it('keeps the served window once data has landed (a range refresh)', () => {
    const { container } = panel(false)
    expect(container.querySelector('h2')!.textContent).toBe('Activity · last 30 min')
  })
})

describe('HubActivityPanelV5 data age', () => {
  const renderAge = (props: { updatedAgo?: string; lastAppliedAgo?: string; lastAppliedFromCache?: boolean; awaitingData?: boolean; unavailable?: boolean; activityRefreshing?: boolean }) => render(<MemoryRouter>
    <HubActivityPanelV5
      hub={notLanded}
      activitySummary={summarizeActivity([], 30, 0)}
      suggestions={[]}
      loading={props.awaitingData ?? false}
      {...props}
    />
  </MemoryRouter>)

  it('shows trusted data age rather than the more recent load time', () => {
    const { getByTestId } = renderAge({ updatedAgo: '15m ago', lastAppliedAgo: '5s ago' })
    expect(getByTestId('hub-data-age').textContent).toBe('Data from about 15m ago')
  })

  it('labels load time separately when the underlying data age is unknown', () => {
    const { getByTestId } = renderAge({ lastAppliedAgo: '5s ago' })
    expect(getByTestId('hub-data-age').textContent).toBe('Data age unavailable · Loaded 5s ago')
  })

  it('labels the save time when an age-unknown snapshot was hydrated from cache', () => {
    const { getByTestId } = renderAge({ lastAppliedAgo: '2h ago', lastAppliedFromCache: true })
    expect(getByTestId('hub-data-age').textContent).toBe('Data age unavailable · Saved 2h ago')
  })

  it('does not invent a load or save time when none is available', () => {
    const { getByTestId } = renderAge({})
    expect(getByTestId('hub-data-age').textContent).toBe('Data age unavailable')
  })

  it('does not attribute an earlier load time to a replacement shell while activity is repairing', () => {
    const { getByTestId } = renderAge({ lastAppliedAgo: '2h ago', activityRefreshing: true })
    expect(getByTestId('hub-data-age').textContent).toBe('Data age unavailable')
  })

  it('does not show an age label before data arrives or when unavailable', () => {
    const loading = renderAge({ awaitingData: true, lastAppliedAgo: '5s ago' })
    expect(loading.queryByTestId('hub-data-age')).toBeNull()
    loading.unmount()
    const unavailable = renderAge({ unavailable: true, lastAppliedAgo: '5s ago' })
    expect(unavailable.queryByTestId('hub-data-age')).toBeNull()
  })
})

const BUCKET = 6 * 60_000
const START = Date.UTC(2026, 9, 13, 18, 0, 0) - 239 * BUCKET
const BOX_WIDTH = 1600

/** A measured day: 240 six-minute buckets. */
function day(): HubActivityPoint[] {
  return Array.from({ length: 240 }, (_, index) => ({
    t: START + index * BUCKET,
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
  }))
}

describe('HubActivityPanelV5 wheel zone', () => {
  let clientWidth: PropertyDescriptor | undefined
  beforeAll(() => {
    clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => BOX_WIDTH })
  })
  afterAll(() => {
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
  })

  // Aron 2026-10-15: the wheel works on the graph only, not on the headers or the lanes below it.
  it('zooms over the graph; over the header, window seg, readout and provider lanes the page keeps the wheel', () => {
    const hub = { ...empty, activity: { ...empty.activity, windowMinutes: 24 * 60, availableWindowMinutes: 24 * 60, bucketMinutes: 6, points: day() } }
    const { container } = render(<MemoryRouter>
      <HubActivityPanelV5
        hub={hub}
        activitySummary={summarizeActivity(hub.activity.points, 24 * 60, 0)}
        suggestions={[]}
        loading={false}
        rangeControl={{ active: '24h', options: [{ key: '30m', label: '30m' }, { key: '24h', label: '24h' }, { key: '7d', label: '7d' }], onSelect: () => {} }}
      />
    </MemoryRouter>)
    expect(container.querySelector('[data-hub-activity-state]')!.getAttribute('data-hub-activity-state')).toBe('ready')
    const box = { left: 0, right: BOX_WIDTH, top: 0, bottom: 600, width: BOX_WIDTH, height: 600, x: 0, y: 0, toJSON: () => ({}) }
    for (const selector of ['.hub-act', '.hx-plot-stack', '[data-hub-plot-box]']) {
      Object.defineProperty(container.querySelector(selector)!, 'getBoundingClientRect', { configurable: true, value: () => box })
    }
    const navigatorWindow = () => container.querySelector('[data-hub-chart-navigator]')!.getAttribute('data-hub-chart-navigator-window')
    const wheel = (selector: string) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: BOX_WIDTH / 2, clientY: 200 })
      act(() => { container.querySelector(selector)!.dispatchEvent(event) })
      return event
    }
    // The plot first: a wheel the page took would start the scroll-through window.
    expect(wheel('[data-hub-chart-wheel-surface]').defaultPrevented).toBe(true)
    expect(navigatorWindow()).not.toBe('0:239')
    act(() => { fireEvent.click(container.querySelector('button[aria-label="Reset zoom"]')!) })
    expect(navigatorWindow()).toBe('0:239')
    for (const selector of ['[data-hub-activity-header] h2', '[data-hub-window-seg] button', '[data-hub-series-chip]', '[data-hub-readout]', '[data-hub-provider-lanes]', '.hub-act']) {
      expect(wheel(selector).defaultPrevented, selector).toBe(false)
      expect(navigatorWindow(), selector).toBe('0:239')
    }
  })
})
