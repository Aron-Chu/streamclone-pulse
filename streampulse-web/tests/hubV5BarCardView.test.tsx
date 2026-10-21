import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubActivityPoint, HubLivePulseMoment } from '../src/lib/publicHub'
import {
  getHubBucketSelectionSnapshot,
  resetHubBucketSelectionForTests,
  selectHubBucket,
  setHubChartBridge,
  type HubChartBridge,
} from '../src/lib/hubBucketSelection'
import { HubV5BarCard } from '../src/ui/components/hub/v5/HubV5BarCard'

const MIN = 60_000
const BUCKET = 6 * MIN
const T0 = Date.UTC(2026, 9, 19, 12, 0)

const points: HubActivityPoint[] = Array.from({ length: 4 }, (_, i) => ({
  t: T0 + i * BUCKET,
  chat: 600 * (i + 1),
  emotes: 120,
  seventv: 60,
  viewers: 40_000,
  viewerCoverage: 'complete',
  hasChatRollup: true,
  hasViewerRollup: true,
  topEmotes: [{ name: 'KEKW', provider: 'twitch', count: 30 }],
}))

const moments: HubLivePulseMoment[] = [
  { offsetSeconds: 120, score: 1, label: 'Emote spike', login: 'xqc', displayName: 'xQc', streamId: 's1', at: T0 + 2 * MIN },
]

function bridge(over: Partial<HubChartBridge> = {}): HubChartBridge {
  return {
    subscribeFrame: () => () => {},
    xOfMs: () => 0,
    plotElement: () => null,
    panToMs: vi.fn(),
    stepBar: vi.fn((ms: number, dir: -1 | 1) => ({ t: ms + dir * BUCKET, endT: ms + (dir + 1) * BUCKET, barMinutes: 6 })),
    zoomToMs: vi.fn(),
    focusPlot: vi.fn(),
    ...over,
  }
}

function renderCard() {
  return render(
    <MemoryRouter>
      <div className="hub-v5">
        <input aria-label="Search a streamer" />
        <HubV5BarCard points={points} bucketMinutes={6} moments={moments} />
      </div>
    </MemoryRouter>,
  )
}

const select = (i: number) => act(() => selectHubBucket({ t: T0 + i * BUCKET, endT: T0 + (i + 1) * BUCKET, barMinutes: 6, source: 'bar' }))
const card = () => document.querySelector('[data-hub-bar-card]')

afterEach(() => {
  resetHubBucketSelectionForTests()
  vi.useRealTimers()
})

describe('HubV5BarCard (R5-8 option A)', () => {
  it('shows nothing until a bar is selected, then the bar as a region under the chart', () => {
    setHubChartBridge(bridge())
    renderCard()
    expect(card()).toBeNull()
    select(0)
    const region = screen.getByRole('region', { name: /^Bucket selected: / })
    expect(region.getAttribute('data-hub-bar-card')).not.toBe('leave')
    expect(region.textContent).toContain('Bucket selected · 6 min')
    expect(region.textContent).toContain('chat/min')
    expect(region.textContent).toContain('viewers (sample)')
    expect(region.textContent).toContain('6-min bar')
    const link = screen.getByRole('link', { name: /^xQc at .+, Emote spike\. Opens in Moments$/ })
    expect(link.getAttribute('href')).toBe('/analytics/moments?login=xqc&stream=s1&offset=120')
  })

  it('steps with ‹ › through the chart bridge and zooms to the bar', () => {
    const b = bridge()
    setHubChartBridge(b)
    renderCard()
    select(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next bar' }))
    expect(b.stepBar).toHaveBeenCalledWith(T0 + BUCKET, 1)
    expect(getHubBucketSelectionSnapshot().selection).toMatchObject({ t: T0 + 2 * BUCKET, source: 'bar' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous bar' }))
    expect(getHubBucketSelectionSnapshot().selection!.t).toBe(T0 + BUCKET)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to bar' }))
    expect(b.zoomToMs).toHaveBeenCalledWith(T0 + BUCKET, T0 + 2 * BUCKET)
  })

  it('closes on × and gives focus back to the plot', () => {
    const b = bridge()
    setHubChartBridge(b)
    renderCard()
    select(0)
    const close = screen.getByRole('button', { name: 'Close (Esc)' })
    close.focus()
    fireEvent.click(close)
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
    expect(b.focusPlot).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, but not while typing in a field', () => {
    vi.useFakeTimers()
    const b = bridge()
    setHubChartBridge(b)
    renderCard()
    select(0)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search a streamer' }), { key: 'Escape' })
    expect(getHubBucketSelectionSnapshot().selection).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
    expect(b.focusPlot).not.toHaveBeenCalled()
    expect(card()?.getAttribute('data-hub-bar-card')).toBe('leave')
    act(() => { vi.advanceTimersByTime(200) })
    expect(card()).toBeNull()
  })

  it('announces the bar after the swap', () => {
    vi.useFakeTimers()
    setHubChartBridge(bridge())
    renderCard()
    select(2)
    act(() => { vi.advanceTimersByTime(50) })
    expect(document.querySelector('[data-hub-bar-card-live]')!.textContent).toMatch(/^Bucket selected, .+\. Chat 300 per minute\. Emotes 20 per minute\. Viewers 40,000\.$/)
  })

  it('drops a selection the points no longer hold', () => {
    setHubChartBridge(bridge())
    renderCard()
    act(() => selectHubBucket({ t: T0 + 40 * BUCKET, endT: T0 + 41 * BUCKET, barMinutes: 6, source: 'bar' }))
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
  })

  it('makes no request', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    setHubChartBridge(bridge())
    renderCard()
    select(0)
    fireEvent.click(screen.getByRole('button', { name: 'Next bar' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
