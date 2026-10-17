import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole, type AnalyticsConsoleProps } from './AnalyticsConsole.tsx'

// d3-v2 session-original page shell (U15): the header, meta line, stat labels,
// stream column and session tabs. ConsoleBits, PastBroadcastBanner and
// StreamSidebar are real; the chart and the tab contents are stubs.

const api = vi.hoisted(() => ({
  getAnalyticsLive: vi.fn(),
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getStreamGameSegments: vi.fn(),
  getStreamMinutesTail: vi.fn(),
  getStreamStatus: vi.fn(),
  getSyncStatus: vi.fn(),
  getStreamSummary: vi.fn(),
  getReplayHeatmap: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('../hooks/useAnalyticsLive.ts', () => ({
  useAnalyticsLive: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
}))
vi.mock('./analytics/AnalyticsChart.tsx', () => ({
  default: () => <div className="sc-chart-root" data-testid="analytics-chart">Chart</div>,
}))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => <div>Emote list</div> }))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => <div>Moment details</div> }))
vi.mock('./analytics/SessionRecapMomentsStrip.tsx', () => ({ SessionRecapMomentsStrip: () => null }))
vi.mock('./analytics/StreamRecapPanel.tsx', () => ({ StreamRecapPanel: () => null }))
vi.mock('./analytics/SyncStatusPanel.tsx', () => ({ SyncStatusPanel: () => <div>Status details</div> }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./signals/SessionSignalTape.tsx', () => ({ SessionSignalTape: () => null }))

const streamId = 'shell-stream'
const startedAt = '2026-07-16T18:00:00.000Z'

function detail() {
  return {
    channel: 'xqc',
    state: 'historical',
    stream: {
      streamId,
      login: 'xqc',
      displayName: 'xQc',
      title: 'Shell fixture',
      category: 'Grand Theft Auto V',
      startedAt,
      endedAt: '2026-07-16T19:00:00.000Z',
      vodId: '2899924626',
      lifecycleState: 'confirmed_ended',
      lifecycleDetectedAt: '2026-07-16T19:05:00.000Z',
    },
    coverageStartOffsetSeconds: 54,
    availability: { missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 54 }] },
    rollups: [
      { minuteTs: '2026-07-16T18:01:00.000Z', viewerAvg: 100, viewerSamples: 1, chatCount: 10, totalEmoteCount: 2 },
      { minuteTs: '2026-07-16T18:02:00.000Z', viewerAvg: 120, viewerSamples: 1, chatCount: 12, totalEmoteCount: 3 },
    ],
    topEmotes: [],
    sources: [],
    updatedAt: Date.now(),
  }
}

function renderConsole(props: AnalyticsConsoleProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/analytics/xqc/${streamId}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<AnalyticsConsole {...props} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockResolvedValue({
    items: [
      { streamId, login: 'xqc', title: 'Shell fixture', startedAt, endedAt: '2026-07-16T19:00:00.000Z', viewerSamples: 1, chatMessages: 10, peakViewers: 120 },
      { streamId: 'older', login: 'xqc', title: 'Older broadcast', startedAt: '2026-07-15T18:00:00.000Z', endedAt: '2026-07-15T19:00:00.000Z', peakViewers: 90 },
    ],
  })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(detail())
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => cleanup())

function header() {
  return document.querySelector<HTMLElement>('[data-session-header]')!
}

describe('AnalyticsConsole session page shell (d3-v2 session-original)', () => {
  it('drops the badge row and the separate Refresh button; the facts sit on one meta line', async () => {
    renderConsole({ enableLayoutControls: true })
    await screen.findByTestId('analytics-chart')
    await waitFor(() => expect(within(header()).getByRole('link', { name: 'Watch VOD' })).toBeTruthy())

    expect(header().querySelector('[data-session-header-badges]')).toBeNull()
    expect(within(header()).queryByRole('link', { name: 'Analytics hub' })).toBeNull()
    expect(within(header()).queryByText(/^live$|^historical$/i)).toBeNull()

    const h1 = within(header()).getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Shell fixture')
    expect(h1.className.split(' ')).toContain('line-clamp-2')
    expect(h1.className.split(' ')).not.toContain('truncate')

    const items = [...header().querySelectorAll<HTMLElement>('.ssp-meta > .mi')]
    const text = items.map(item => item.textContent ?? '')
    expect(text[0]).toBe('xQc')
    expect(text[1]).toBe('Grand Theft Auto V')
    expect(text[2]).toMatch(/^Started /)
    expect(text[3]).toMatch(/^Updated /)
    expect(text[4]).toBe('First 54s not tracked')
    expect(text[5]).toBe('Watch VOD')
    expect(text[6]).toMatch(/^Data: /)
    expect(items[4]!.hasAttribute('data-coverage-start')).toBe(true)
    // The lifecycle facts ride on the Started item (prod's row hooks kept).
    expect(items[2]!.hasAttribute('data-session-lifecycle-row')).toBe(true)
    expect(items[2]!.hasAttribute('data-has-action')).toBe(true)

    const refresh = within(items[3]!).getByRole('button', { name: 'Refresh data' })
    expect(refresh.title).toBe('Reload chart and stats from server (does not start a sync job)')
    expect(screen.queryByText('Refresh data')).toBeNull()

    const vod = within(items[5]!).getByRole('link', { name: 'Watch VOD' })
    expect(vod.getAttribute('href')).toBe('https://www.twitch.tv/videos/2899924626')
    expect(vod.getAttribute('target')).toBe('_blank')
    expect(vod.getAttribute('rel')).toContain('noopener')

    // The coverage banner, the lifecycle row and the VOD note are gone from the centre column.
    expect(document.querySelector('[data-session-status-row]')).toBeNull()
    expect(screen.queryByText(/open the full VOD/)).toBeNull()
  })

  it('keeps Hide streams and Focus chart at the top right, from 1280 px only', async () => {
    renderConsole({ enableLayoutControls: true })
    await screen.findByTestId('analytics-chart')
    const actions = header().querySelector<HTMLElement>('[data-session-header-actions]')!
    expect(actions.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'xl:flex']))
    expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Hide streams', 'Focus chart'])
  })

  it('prints the stat labels in plain case', async () => {
    renderConsole()
    await screen.findByTestId('analytics-chart')
    const labels = [...document.querySelectorAll('[data-session-stat-row] .sc-stat-card__label')].map(el => el.textContent)
    expect(labels).toEqual(['Latest viewers', 'Average viewers', 'Peak viewers', 'Chat messages', 'Emote uses', 'Time tracked'])
  })

  it('"Data" opens the Status tab, whose panel is always in the page, and moves focus to it', async () => {
    renderConsole()
    // The tab resets to Moments when the stream resolves, so wait for it first.
    await screen.findByRole('heading', { name: 'Shell fixture' })
    const data = screen.getByRole('button', { name: /^Data: / })
    expect(data.getAttribute('aria-controls')).toBe('session-panel-status')
    const statusPanel = document.getElementById('session-panel-status')!
    expect(statusPanel.hidden).toBe(true)
    fireEvent.click(data)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Status' }).getAttribute('aria-selected')).toBe('true'))
    await waitFor(() => expect(document.activeElement?.id).toBe('session-tab-status'))
    expect(statusPanel.hidden).toBe(false)
    expect(within(statusPanel).getByText('Status details')).toBeTruthy()
    expect(document.getElementById('session-panel-moments')!.hidden).toBe(true)
    // Each tab still names its own panel.
    for (const tab of screen.getAllByRole('tab')) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).not.toBeNull()
    }
  })

  it('puts the Moments explainer behind an (i) beside the tabs, only while Moments is open', async () => {
    renderConsole()
    await screen.findByRole('heading', { name: 'Shell fixture' })
    const info = screen.getByRole('button', { name: 'About Pulse Moments' })
    expect(info.closest('[role="tablist"]')).toBeNull()
    const cell = info.closest('.ssp-tl-i')!
    expect(cell.hasAttribute('data-off')).toBe(false)

    fireEvent.click(info)
    expect(info.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Ranked by how strongly chat reacted, not by clip quality.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Ranked by how strongly chat reacted, not by clip quality.')).toBeNull()
    expect(document.activeElement).toBe(info)

    fireEvent.click(screen.getByRole('tab', { name: 'Emotes' }))
    expect(cell.hasAttribute('data-off')).toBe(true)
  })

  it('shows the stream list without the caption, the Synced only filter or the live row', async () => {
    renderConsole({ enableLayoutControls: true })
    await screen.findByText('Older broadcast')
    expect(screen.queryByText('Up to 100 recent stored streams')).toBeNull()
    expect(screen.queryByText(/Synced only/)).toBeNull()
    expect(document.querySelector('[data-live-current-row]')).toBeNull()
    expect(screen.getByRole('link', { current: 'page' }).textContent).toContain('Shell fixture')
  })
})
