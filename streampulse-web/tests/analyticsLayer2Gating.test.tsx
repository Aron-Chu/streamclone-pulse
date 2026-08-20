import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnalyticsConsole,
  configureAnalyticsApi,
  SessionIdentityMismatchError,
  type AnalyticsApi,
} from '@streampulse/analytics-console'

const STREAM_ID = '317839735654'
const LOGIN = 'xqc'

const minuteRollup = {
  minuteTs: '2026-07-05T20:00:00.000Z',
  chatCount: 12,
  viewerAvg: 1200,
  viewerSamples: 1,
  totalEmoteCount: 4,
}

const liveDetail = {
  channel: LOGIN,
  state: 'live' as const,
  stream: {
    streamId: STREAM_ID,
    login: LOGIN,
    displayName: 'xQc',
    category: 'Just Chatting',
    startedAt: '2026-07-05T19:00:00.000Z',
    currentViewers: 1200,
  },
  rollups: [minuteRollup],
  topEmotes: [],
  sources: [],
  updatedAt: Date.now(),
}

const channelDoorDetail = {
  channel: LOGIN,
  state: 'offline' as const,
  rollups: [],
  topEmotes: [],
  sources: [],
  updatedAt: Date.now(),
}

function createChannelDoorApi(overrides: Partial<AnalyticsApi> = {}): AnalyticsApi {
  return createMockApi({
    getAnalyticsLive: vi.fn().mockResolvedValue(channelDoorDetail),
    getAnalyticsStreams: vi.fn().mockResolvedValue({ items: [] }),
    getChannelStreamHistory: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  })
}

function PortalConsoleShell() {
  return (
    <AnalyticsConsole
      mode="public"
      showGameSegments
    />
  )
}

function createMockApi(overrides: Partial<AnalyticsApi> = {}): AnalyticsApi {
  return {
    ensureChannelEmotes: vi.fn().mockResolvedValue({}),
    getAnalyticsStream: vi.fn().mockResolvedValue(liveDetail),
    getStreamSummary: vi.fn().mockResolvedValue({ metrics: {}, analyticsQuality: 'good' }),
    getAnalyticsStreams: vi.fn().mockResolvedValue({
      items: [
        {
          streamId: STREAM_ID,
          login: LOGIN,
          displayName: 'xQc',
          category: 'Just Chatting',
          startedAt: liveDetail.stream.startedAt,
          endedAt: '',
          currentViewers: 1200,
        },
      ],
    }),
    getPulseBookmarks: vi.fn().mockResolvedValue({ items: [] }),
    getPulseStreamRecap: vi.fn().mockResolvedValue({
      streamId: STREAM_ID,
      vodId: '',
      moments: [],
    }),
    getTimeseriesStatus: vi.fn().mockResolvedValue({}),
    createPulseBookmark: vi.fn().mockResolvedValue({}),
    deletePulseBookmark: vi.fn().mockResolvedValue(undefined),
    prefetchAnalyticsTracker: vi.fn().mockResolvedValue({ status: 'ok' }),
    getChannel: vi.fn().mockResolvedValue({ login: LOGIN }),
    getChannelStreamHistory: vi.fn().mockResolvedValue({ items: [] }),
    watchAnalyticsChannel: vi.fn().mockResolvedValue({}),
    getAnalyticsLive: vi.fn().mockResolvedValue(liveDetail),
    getSyncStatus: vi.fn().mockResolvedValue(null),
    startHistoricalSync: vi.fn().mockResolvedValue({ accepted: false }),
    getStreamGameSegments: vi.fn().mockResolvedValue([]),
    getReplayHeatmap: vi.fn().mockResolvedValue({ points: [] }),
    getReplayHeatmapDetail: vi.fn().mockResolvedValue(null),
    getVodStoryboardThumb: vi.fn().mockResolvedValue(null),
    getTwitchDayClips: vi.fn().mockResolvedValue({ items: [] }),
    getSetupWelcome: vi.fn().mockResolvedValue({
      profile: 'core',
      services: {},
      incomplete: false,
      showWelcome: false,
    }),
    ...overrides,
  }
}

function renderConsole(path: string, api: AnalyticsApi) {
  configureAnalyticsApi(api)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/analytics/:login" element={<PortalConsoleShell />} />
          <Route path="/analytics/:login/:streamId" element={<PortalConsoleShell />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('analytics console Layer 2 gating', () => {
  let api: AnalyticsApi

  beforeEach(() => {
    api = createMockApi()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not fetch Layer 2 endpoints on the channel door route', async () => {
    const doorApi = createChannelDoorApi()
    renderConsole(`/analytics/${LOGIN}`, doorApi)

    await waitFor(() => {
      expect(doorApi.getAnalyticsLive).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(doorApi.getAnalyticsStreams).toHaveBeenCalled()
    })

    expect(doorApi.getStreamGameSegments).not.toHaveBeenCalled()
    expect(doorApi.getPulseStreamRecap).not.toHaveBeenCalled()
    expect(doorApi.getReplayHeatmap).not.toHaveBeenCalled()
    expect(doorApi.getStreamSummary).not.toHaveBeenCalled()
    expect(doorApi.getSyncStatus).not.toHaveBeenCalled()
  })

  it('does not fetch Layer 2 endpoints when Refresh is clicked on the channel door', async () => {
    const doorApi = createChannelDoorApi()
    renderConsole(`/analytics/${LOGIN}`, doorApi)

    await waitFor(() => {
      expect(doorApi.getAnalyticsLive).toHaveBeenCalled()
    })

    vi.clearAllMocks()

    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }))

    await waitFor(() => {
      expect(doorApi.getAnalyticsLive).toHaveBeenCalled()
    })

    expect(doorApi.getStreamGameSegments).not.toHaveBeenCalled()
    expect(doorApi.getPulseStreamRecap).not.toHaveBeenCalled()
    expect(doorApi.getReplayHeatmap).not.toHaveBeenCalled()
    expect(doorApi.getStreamSummary).not.toHaveBeenCalled()
    expect(doorApi.getSyncStatus).not.toHaveBeenCalled()
  })

  it('fetches Layer 2 endpoints on the explicit session route', async () => {
    renderConsole(`/analytics/${LOGIN}/${STREAM_ID}`, api)

    await waitFor(() => {
      expect(api.getAnalyticsStream).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalledWith(
        STREAM_ID,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(api.getReplayHeatmap).not.toHaveBeenCalled()
      expect(api.getStreamSummary).toHaveBeenCalled()
      expect(api.getSyncStatus).not.toHaveBeenCalled()
      expect(api.getStreamGameSegments).toHaveBeenCalledWith(
        STREAM_ID,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Spikes' })[0]!)
    await waitFor(() => expect(api.getReplayHeatmap).toHaveBeenCalled())
  })

  it('fails closed when the backend returns another broadcast', async () => {
    const requestedStreamId = '319987163228'
    const api = createMockApi({
      getAnalyticsStreams: vi.fn().mockResolvedValue({
        items: [{
          streamId: requestedStreamId,
          login: LOGIN,
          title: 'Aug 20 broadcast',
          category: 'Just Chatting',
          startedAt: '2026-08-20T18:05:35.000Z',
        }],
      }),
      getAnalyticsStream: vi.fn().mockRejectedValue(new SessionIdentityMismatchError({
        requestedStreamId,
        returnedStreamId: '319974084316',
        returnedStartedAt: '2026-08-19T17:58:07.000Z',
      })),
    })

    renderConsole(`/analytics/${LOGIN}/2026-08-20`, api)

    await waitFor(() => {
      expect(screen.getAllByTestId('session_identity_mismatch').length).toBeGreaterThan(0)
    })
    expect(api.getStreamGameSegments).not.toHaveBeenCalled()
    expect(api.getPulseStreamRecap).not.toHaveBeenCalled()
    expect(api.getReplayHeatmap).not.toHaveBeenCalled()
  })

  it('refetches Layer 2 endpoints when Refresh is clicked on the session route', async () => {
    renderConsole(`/analytics/${LOGIN}/${STREAM_ID}`, api)

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalled()
    })

    vi.clearAllMocks()

    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }))

    await waitFor(() => {
      expect(api.getPulseStreamRecap).toHaveBeenCalled()
      expect(api.getReplayHeatmap).toHaveBeenCalled()
      expect(api.getStreamSummary).toHaveBeenCalled()
      expect(api.getSyncStatus).toHaveBeenCalled()
    })
  })
})
