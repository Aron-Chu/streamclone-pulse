import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

// OP1-RES-001 / OP1-RES-002: failed, timed-out and pending reads on the channel
// and session routes must not be presented as an empty channel (or a missing date).

const api = vi.hoisted(() => ({
  getAnalyticsLive: vi.fn(),
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getReplayHeatmap: vi.fn(),
  getStreamGameSegments: vi.fn(),
  getStreamMinutesTail: vi.fn(),
  getStreamStatus: vi.fn(),
  getStreamSummary: vi.fn(),
  getSyncStatus: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('./analytics/AnalyticsChart.tsx', () => ({
  default: () => <div data-testid="analytics-chart">No recent data</div>,
}))
vi.mock('./analytics/ConsoleBits.tsx', () => ({
  DataQualityDisclosure: ({ pending }: { pending?: boolean }) => (
    <span data-testid="data-quality">{pending ? 'Data quality: —' : 'Data quality: verdict'}</span>
  ),
  StatCard: ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div data-testid="stat-card" data-tone={tone}>{label}: {value}</div>
  ),
  CoverageStartBanner: () => null,
}))
vi.mock('./analytics/MomentReviewPanel.tsx', () => ({ MomentReviewPanel: () => null }))
vi.mock('./analytics/PastBroadcastBanner.tsx', () => ({ PastBroadcastBanner: () => null }))
vi.mock('./analytics/StreamQualityBanner.tsx', () => ({ StreamQualityBanner: () => null }))
vi.mock('./analytics/TopEmoteTable.tsx', () => ({ TopEmoteTable: () => null }))

const timeout = { kind: 'timeout', message: 'Request deadline exceeded', status: 0 }
const serverError = { kind: 'server', message: 'internal_error', status: 500 }
const startedAt = '2026-07-11T18:00:00.000Z'

let navigateTo: (to: string) => void = () => undefined
function NavigateGrab() {
  navigateTo = useNavigate()
  return null
}

function renderConsole(route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <NavigateGrab />
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<AnalyticsConsole />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsLive.mockResolvedValue({ channel: 'xqc', state: 'not_collected', rollups: [], topEmotes: [], sources: [], updatedAt: 0 })
  api.getAnalyticsStreams.mockResolvedValue({ channel: 'xqc', items: [], sources: [], updatedAt: 0 })
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getStreamMinutesTail.mockResolvedValue(null)
  api.getStreamStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getSyncStatus.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('AnalyticsConsole channel route load failures', () => {
  it('shows a failed stream list with a working retry, not "No past streams indexed yet"', async () => {
    api.getAnalyticsStreams.mockRejectedValueOnce({ kind: 'server', message: 'internal_error', status: 500 })
    renderConsole('/analytics/xqc')

    await screen.findByText("Couldn't load streams.")
    expect(screen.queryByText('No past streams indexed yet.')).toBeNull()

    api.getAnalyticsStreams.mockResolvedValueOnce({
      channel: 'xqc',
      items: [{ streamId: '101', login: 'xqc', startedAt, endedAt: '2026-07-11T20:00:00.000Z', title: 'Recovered broadcast' }],
      sources: [],
      updatedAt: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load streams.")).toBeNull())
    const column = document.querySelector('[data-analytics-stream-column]') as HTMLElement
    expect(within(column).getByText('Recovered broadcast')).toBeTruthy()
    expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2)
  })

  it('keeps the failed list panel in place while the list is requested again', async () => {
    api.getAnalyticsStreams
      .mockRejectedValueOnce(serverError)
      .mockImplementationOnce(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc')

    await screen.findByText("Couldn't load streams.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.getAnalyticsStreams).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText("Couldn't load streams.")).toBeTruthy()
    expect(screen.queryByText('Loading streams…')).toBeNull()
  })

  it('says the stream list is loading while the request is pending', async () => {
    api.getAnalyticsStreams.mockImplementation(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc')

    expect(await screen.findByText('Loading streams…')).toBeTruthy()
    expect(screen.queryByText('No past streams indexed yet.')).toBeNull()
  })

  it('keeps the empty copy for a channel whose list loads empty', async () => {
    renderConsole('/analytics/xqc')
    expect(await screen.findByText('No past streams indexed yet.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(screen.getAllByText(/Needs sync/)).toHaveLength(5))
  })

  it('shows "-" stat cards instead of "Needs sync" while the first live read is pending', async () => {
    api.getAnalyticsLive.mockImplementation(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc')

    await waitFor(() => expect(screen.getAllByTestId('stat-card')).toHaveLength(6))
    expect(screen.queryByText(/Needs sync/)).toBeNull()
    for (const card of screen.getAllByTestId('stat-card')) expect(card.textContent).toMatch(/: -$/)
  })

  it('mutes every placeholder dash the same way, Measured span included', async () => {
    api.getAnalyticsLive.mockImplementation(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc')

    await waitFor(() => expect(screen.getAllByTestId('stat-card')).toHaveLength(6))
    const tones = screen.getAllByTestId('stat-card').map(card => card.getAttribute('data-tone'))
    expect(new Set(tones)).toEqual(new Set(['text-zinc-600 font-semibold']))
    expect(screen.getAllByTestId('stat-card').at(-1)?.textContent).toBe('Measured span: -')
  })

  it('reports a failed live read as unavailable instead of an empty chart', async () => {
    api.getAnalyticsLive.mockRejectedValue({ kind: 'server', message: 'internal_error', status: 500 })
    renderConsole('/analytics/xqc')

    const alert = await screen.findByText(/Unable to load the latest session for/)
    expect(alert.textContent).toContain('xqc')
    expect(alert.textContent).toContain('Refresh to try again')
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh data' })).toBeTruthy()
  })

  it('recovers a failed live read from Refresh data', async () => {
    api.getAnalyticsLive.mockRejectedValueOnce(serverError)
    renderConsole('/analytics/xqc')

    await screen.findByText(/Unable to load the latest session for/)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
    await waitFor(() => expect(screen.queryByText(/Unable to load the latest session for/)).toBeNull())
    expect(screen.getByTestId('analytics-chart')).toBeTruthy()
    expect(api.getAnalyticsLive).toHaveBeenCalledTimes(2)
  })

  it('keeps a timed-out live read on screen while it is requested again', async () => {
    api.getAnalyticsLive
      .mockRejectedValueOnce(timeout)
      .mockImplementationOnce(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc')

    await screen.findByText(/took too long to load\. Refresh to try again\./)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
    await waitFor(() => expect(api.getAnalyticsLive).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/took too long to load\. Refresh to try again\./)).toBeTruthy()
    expect(document.querySelector('[data-console-skeleton]')).toBeNull()
  })

  it('names a timed-out live read as slow', async () => {
    api.getAnalyticsLive.mockRejectedValue(timeout)
    renderConsole('/analytics/xqc')

    expect(await screen.findByText(/took too long to load\. Refresh to try again\./)).toBeTruthy()
    expect(screen.queryByTestId('analytics-chart')).toBeNull()
  })
})

describe('AnalyticsConsole data quality chip without data', () => {
  const items = [{ streamId: '320567744986', login: 'xqc', startedAt, endedAt: '2026-07-11T20:00:00.000Z' }]

  it('shows a neutral chip, not a verdict, while the session is loading', async () => {
    api.getAnalyticsStreams.mockResolvedValue({ channel: 'xqc', items, sources: [], updatedAt: 0 })
    api.getAnalyticsStream.mockImplementation(() => new Promise(() => undefined))
    renderConsole('/analytics/xqc/320567744986')

    await waitFor(() => expect(api.getAnalyticsStream).toHaveBeenCalled())
    expect(screen.getByTestId('data-quality').textContent).toBe('Data quality: —')
  })

  it('shows a neutral chip, not a verdict, after the session request failed', async () => {
    api.getAnalyticsStreams.mockResolvedValue({ channel: 'xqc', items, sources: [], updatedAt: 0 })
    api.getAnalyticsStream.mockRejectedValue(serverError)
    renderConsole('/analytics/xqc/320567744986')

    await screen.findByText(/Unable to load session data for/)
    expect(screen.getByTestId('data-quality').textContent).toBe('Data quality: —')
  })

  it('gives the verdict once the session has loaded', async () => {
    api.getAnalyticsStreams.mockResolvedValue({ channel: 'xqc', items, sources: [], updatedAt: 0 })
    api.getAnalyticsStream.mockResolvedValue({
      channel: 'xqc', state: 'historical', stream: items[0], rollups: [], topEmotes: [], sources: [], updatedAt: 0,
    })
    renderConsole('/analytics/xqc/320567744986')

    await waitFor(() => expect(screen.getByTestId('data-quality').textContent).toBe('Data quality: verdict'))
  })
})

describe('AnalyticsConsole session route timeout', () => {
  it('tells the visitor a timed-out session read was slow, with refresh', async () => {
    api.getAnalyticsStreams.mockResolvedValue({
      channel: 'xqc',
      items: [{ streamId: '320567744986', login: 'xqc', startedAt, endedAt: '2026-07-11T20:00:00.000Z' }],
      sources: [],
      updatedAt: 0,
    })
    api.getAnalyticsStream.mockRejectedValue(timeout)
    renderConsole('/analytics/xqc/320567744986')

    await waitFor(() => {
      const alert = screen.getAllByRole('alert').find(node => node.textContent?.includes('320567744986'))
      expect(alert?.textContent).toContain('Session data for 320567744986 took too long to load. Refresh to try again.')
    })
    expect(screen.getByRole('button', { name: 'Refresh data' })).toBeTruthy()
  })
})

describe('AnalyticsConsole date route with a failed list', () => {
  function dateAlert() {
    return screen.getAllByRole('alert').find(node => node.textContent?.includes('2026-07-11'))
  }

  it('reports the failed list instead of claiming the date has no stream', async () => {
    api.getAnalyticsStreams.mockRejectedValue(serverError)
    renderConsole('/analytics/xqc/2026-07-11')

    await waitFor(() => expect(dateAlert()?.textContent).toContain('Unable to load session data for 2026-07-11. Refresh to try again.'))
    expect(screen.queryByText(/was not found in up to 100 recent stored streams/)).toBeNull()
    expect(api.getAnalyticsStream).not.toHaveBeenCalled()
  })
})

describe('AnalyticsConsole revisiting a failed session', () => {
  // The console stays mounted across session links: a session that is requested
  // again must never borrow another session's failure while its own read is pending.
  it.each([
    ['not found', { kind: 'not_found', message: 'not found', status: 404 }, /Session not found for/],
    ['timed out', timeout, /took too long to load/],
  ])("does not show another session's %s failure while session 200 is requested again", async (_label, otherError, otherCopy) => {
    let calls200 = 0
    api.getAnalyticsStream.mockImplementation((id: string) => {
      if (id !== '200') return Promise.reject(otherError)
      calls200 += 1
      return calls200 === 1 ? Promise.reject(serverError) : new Promise(() => undefined)
    })
    renderConsole('/analytics/xqc/200')

    await screen.findByText(/Unable to load session data for/)
    act(() => navigateTo('/analytics/xqc/100'))
    await screen.findByText(otherCopy)
    act(() => navigateTo('/analytics/xqc/200'))
    await waitFor(() => expect(calls200).toBe(2))

    expect(screen.queryByText(otherCopy)).toBeNull()
    expect(document.querySelector('h1')?.textContent).not.toMatch(/not found|Unable to load/)
    expect(document.querySelector('[data-console-skeleton]')).not.toBeNull()
  })
})
