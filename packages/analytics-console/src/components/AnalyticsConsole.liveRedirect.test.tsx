import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { AnalyticsConsole } from './AnalyticsConsole.tsx'

const streamId = 'stream-a'
const startedAt = '2026-07-11T18:00:00.000Z'

const api = vi.hoisted(() => ({
  getAnalyticsStream: vi.fn(),
  getAnalyticsStreams: vi.fn(),
  getChannelStreamHistory: vi.fn(),
  getPulseStreamRecap: vi.fn(),
  getAnalyticsLive: vi.fn(),
  getStreamGameSegments: vi.fn(),
  getSyncStatus: vi.fn(),
  getStreamSummary: vi.fn(),
  getReplayHeatmap: vi.fn(),
  startHistoricalSync: vi.fn(),
  watchAnalyticsChannel: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('../hooks/useAnalyticsLive.ts', () => ({
  useAnalyticsLive: () => ({
    data: { channel: 'denims', state: 'live', stream: { streamId, login: 'denims', startedAt, lifecycleState: 'confirmed_live' }, rollups: [], topEmotes: [], sources: [], updatedAt: Date.now() },
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('./analytics/AnalyticsChart.tsx', () => ({ default: () => null }))
vi.mock('./analytics/StreamSidebar.tsx', () => ({ StreamSidebar: () => null }))

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.hash}</output>
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalyticsStreams.mockResolvedValue({ channel: 'denims', items: [{ streamId, login: 'denims', startedAt }], sources: [], updatedAt: Date.now() })
  api.getChannelStreamHistory.mockResolvedValue({ items: [] })
  api.getAnalyticsStream.mockResolvedValue(null)
  api.getPulseStreamRecap.mockResolvedValue(null)
  api.getStreamGameSegments.mockResolvedValue([])
  api.getSyncStatus.mockResolvedValue(null)
  api.getStreamSummary.mockResolvedValue(null)
  api.getReplayHeatmap.mockResolvedValue(null)
  api.watchAnalyticsChannel.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

it('keeps a shared time (#t=) when the channel route moves to its latest stream', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/denims#t=120']}>
        <Routes>
          <Route path="/analytics/:login/:streamId?" element={<><AnalyticsConsole /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('where').textContent).not.toBe('/analytics/denims#t=120'))
  expect(screen.getByTestId('where').textContent).toMatch(/^\/analytics\/denims\/[^#/]+#t=120$/)
})
