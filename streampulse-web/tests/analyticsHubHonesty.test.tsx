/**
 * Ported unique asserts from excluded full-landing tests
 * (analyticsLandingPage / analyticsHubEmpty) that hung under Vitest.
 * Exercises current hub components — not a full AnalyticsLandingPage mount.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRODUCTION_BACKEND_URL } from '../src/lib/auth'
import type { ActivitySummary } from '../src/lib/hubActivitySummary'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'
import DashboardHome from '../src/routes/dashboard/Home'
import { AnalyticsHubSidebar } from '../src/ui/components/analytics/AnalyticsHubSidebar'
import { FigmaCorpusPipelineBlock } from '../src/ui/components/analytics/FigmaEmoteSignalBlock'
import { FigmaLiveChannelRail } from '../src/ui/components/analytics/FigmaLiveChannelRail'
import { HubDataHealthBanner } from '../src/ui/components/hub/HubDataHealthBanner'
import { COMMAND_CENTER_LABELS } from '../src/ui/themes/commandCenterLabels'

const quietActivity: ActivitySummary = {
  pointCount: 12,
  expectedBuckets: 12,
  missingBuckets: 0,
  coveragePct: 100,
  nonZeroCount: 8,
  gapCount: 0,
  bucketMinutes: 1,
  windowLabel: '30 minutes',
  footnote: '',
}

describe('hub empty / honesty (ported from excluded landing tests)', () => {
  it('keeps command-center section labels and Global activity before Pulse Moments', () => {
    expect(COMMAND_CENTER_LABELS.hubTitle).toBe('Command center')
    expect(COMMAND_CENTER_LABELS.hubEyebrow).toBe('Stream intelligence')
    expect(COMMAND_CENTER_LABELS.liveActivity).toBe('Global activity')
    expect(COMMAND_CENTER_LABELS.pulseMoments).toBe('Pulse Moments')
    expect(COMMAND_CENTER_LABELS.pulseMoments).not.toMatch(/Moments feed/i)

    render(<AnalyticsHubSidebar />)
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map((el) => el.textContent ?? '')
    const liveIdx = labels.findIndex((t) => /Global activity/i.test(t))
    const pulseIdx = labels.findIndex((t) => /Pulse Moments/i.test(t))
    expect(liveIdx).toBeGreaterThanOrEqual(0)
    expect(pulseIdx).toBeGreaterThan(liveIdx)
    expect(screen.queryByRole('button', { name: /Moments feed/i })).toBeNull()
    expect(screen.queryByText(/Featured session analytics/i)).toBeNull()
  })

  it('shows honest empty live rail copy without watchlist CTA', () => {
    render(
      <MemoryRouter>
        <FigmaLiveChannelRail channels={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/No channels live right now/i)).toBeTruthy()
    expect(
      screen.queryByText(/add channels to your watchlist to see live analytics/i),
    ).toBeNull()
  })

  it('renders Live collector readiness heading', () => {
    render(
      <FigmaCorpusPipelineBlock
        pipeline={hubCorpusPipelineFixture({
          generatedAt: new Date().toISOString(),
          state: 'healthy',
          topN: 500,
          collectorActive: 0,
          collectorMax: 100,
        })}
      />,
    )
    expect(
      screen.getByRole('heading', { name: /Live collector readiness/i }),
    ).toBeTruthy()
  })

  it('shows stats-fallback health banner without exposing hosted API hostname', () => {
    render(
      <HubDataHealthBanner
        loadSource="stats-fallback"
        hubEndpointOk={false}
        activitySummary={quietActivity}
        liveRosterCount={0}
        backendUrl={DEFAULT_PRODUCTION_BACKEND_URL}
      />,
    )
    expect(screen.getByText(/Hub temporarily unavailable/i)).toBeTruthy()
    expect(screen.queryByText(/Reading Hosted API/i)).toBeNull()
    expect(screen.queryByText(/api\.streampulse\.stream/i)).toBeNull()
  })
})

describe('/dashboard quarantine (ported)', () => {
  it('renders private workspace landing, not the public analytics hub', () => {
    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: /StreamPulse workspace/i }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /\/analytics/i })).toBeTruthy()
    expect(
      screen.queryByRole('main', { name: /StreamPulse analytics hub/i }),
    ).toBeNull()
    expect(
      screen.queryByText(/Imported VOD sessions never fill this global graph/i),
    ).toBeNull()
  })
})
