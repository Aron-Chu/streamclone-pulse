import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LiveChannelsMatrix } from '../src/ui/components/analytics/LiveChannelsMatrix'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import type { HubLiveChannel } from '../src/lib/publicHub'

const channels: HubLiveChannel[] = [
  {
    login: 'xqc',
    displayName: 'xQc',
    category: 'Just Chatting',
    viewers: 1000,
    chatPerMin: 200,
    emotesPerMin: 50,
    seventvPerMin: 40,
    coverageState: 'synced',
    trendPct: 4,
    screener: {
      version: 1,
      streamId: 'stream-xqc',
      measuredAt: 1_800_000,
      baselineKind: 'current_stream_measured_average',
      state: 'ready',
      currentWindow: { start: 1_500_000, end: 1_800_000, expectedMinutes: 5, measuredMinutes: 5 },
      baselineWindow: { start: 300_000, end: 1_500_000, expectedMinutes: 20, measuredMinutes: 20, coveragePct: 100 },
      evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true, metadataAgeSeconds: 15 },
      chat: {
        state: 'ready', currentPerMin: 240, baselinePerMin: 120, absoluteDeltaPerMin: 120, changePct: 100,
        currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 20, baselineExpectedMinutes: 20, baselineCoveragePct: 100,
      },
      emotes: {
        state: 'ready', currentPerMin: 50, baselinePerMin: 20, absoluteDeltaPerMin: 30, multiplier: 2.5,
        currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 20, baselineExpectedMinutes: 20, baselineCoveragePct: 100,
      },
    },
  },
  {
    login: 'caseoh_',
    displayName: 'caseoh_',
    category: 'Just Chatting',
    viewers: 800,
    chatPerMin: 120,
    emotesPerMin: 30,
    seventvPerMin: 20,
    coverageState: 'partial',
    trendPct: -1,
  },
]

describe('LiveChannelsMatrix Channel Screener', () => {
  it('exposes screener views and anomaly filter', () => {
    render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <LiveChannelsMatrix channels={channels} />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Channel Screener' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Anomalies · unavailable' }))
    expect(screen.getByText(/No backend-authored anomaly reasons/)).toBeTruthy()
  })

  it('shows backend-owned activity comparisons and exact evidence', () => {
    render(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <LiveChannelsMatrix channels={channels} />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Activity change' }))
    expect(screen.getByText('Latest 5 min vs stream average')).toBeTruthy()
    expect(screen.getAllByText('+100%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2.5×').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Coverage evidence' }))
    expect(screen.getByText('5/5 min')).toBeTruthy()
    expect(screen.queryByLabelText(/62% coverage/)).toBeNull()
  })
})
