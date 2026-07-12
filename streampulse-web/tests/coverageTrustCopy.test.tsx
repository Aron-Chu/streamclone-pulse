import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HubCoverageTrustStrip } from '../src/ui/components/analytics/HubCoverageTrustStrip'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'

describe('HubCoverageTrustStrip', () => {
  it('uses the standardized healthy source label', () => {
    render(
      <HubCoverageTrustStrip
        pipeline={hubCorpusPipelineFixture({
          state: 'healthy',
          topN: 500,
          collectorActive: 80,
          collectorMax: 100,
        })}
      />,
    )
    expect(screen.getByText(/Live chat tracking is active across the top live streams by viewer rank\./)).toBeTruthy()
    expect(screen.getByText(/IRC collectors:/)).toBeTruthy()
    expect(screen.getByText(/80 \/ 100/)).toBeTruthy()
  })

  it('scopes IRC and configured-roster metrics instead of a bare collecting count', () => {
    render(
      <HubCoverageTrustStrip
        pipeline={hubCorpusPipelineFixture({
          state: 'healthy',
          collectorActive: 300,
          collectorMax: 300,
          roster: {
            live: 109,
            collecting: 103,
            configuredRosterConfirmed: 103,
            configuredRosterUnresolved: 6,
            warming: 4,
            connectedQuiet: 2,
          },
        })}
        ingest={{
          tieringEnabled: true,
          coreEnabled: true,
          dualReadMode: false,
          shadowMode: false,
          desiredCollectors: 300,
          activeCollectors: 300,
          boundCollectors: 300,
          joinAcknowledged: 300,
          awaitingJoin: 0,
          connectedQuiet: 11,
          chatActive5m: 289,
          chatActive15m: 294,
          reconnecting: 0,
          unexpectedParts: 0,
          admitLagSeconds: 0,
          joinRate1m: 0,
          partRate1m: 0,
          state: 'operational',
        }}
      />,
    )
    expect(screen.getByText(/300 \/ 300/)).toBeTruthy()
    expect(screen.getByText(/Bound to streams:/)).toBeTruthy()
    expect(screen.getByText(/Chat seen last 5m:/)).toBeTruthy()
    expect(screen.getByText(/103 confirmed · 6 unresolved/)).toBeTruthy()
    // Must not double-count warming + connectedQuiet into unresolved (6+4+2=12).
    expect(screen.queryByText(/12 unresolved/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View data coverage' }))
    expect(screen.getByText('Configured roster confirmed')).toBeTruthy()
    expect(screen.getByText('Connected quiet')).toBeTruthy()
    expect(screen.getByText('Unresolved')).toBeTruthy()
  })

  it('displays exactly live - confirmed unresolved and never sums subcategories', () => {
    render(
      <HubCoverageTrustStrip
        pipeline={hubCorpusPipelineFixture({
          state: 'healthy',
          roster: {
            live: 92,
            collecting: 87,
            configuredRosterConfirmed: 87,
            configuredRosterUnresolved: 5,
            warming: 3,
            connectedQuiet: 2,
          },
        })}
      />,
    )
    expect(screen.getByText(/87 confirmed · 5 unresolved/)).toBeTruthy()
    expect(screen.queryByText(/10 unresolved/)).toBeNull()
    expect(screen.queryByText(/warming\/unresolved/)).toBeNull()
    const root = document.querySelector('[data-roster-consistent="true"]')
    expect(root).toBeTruthy()
  })

  it('visibly degrades inconsistent roster payloads', () => {
    render(
      <HubCoverageTrustStrip
        pipeline={hubCorpusPipelineFixture({
          state: 'healthy',
          roster: {
            live: 92,
            collecting: 87,
            configuredRosterConfirmed: 87,
            configuredRosterUnresolved: 10,
            warming: 0,
            connectedQuiet: 0,
          },
        })}
      />,
    )
    expect(screen.getByText(/coverage data inconsistent/i)).toBeTruthy()
    expect(screen.getByText(/87 confirmed · 10 unresolved/)).toBeTruthy()
    expect(document.querySelector('[data-roster-consistent="false"]')).toBeTruthy()
  })

  it('shows warming-aware critical copy and metadata age', () => {
    render(
      <HubCoverageTrustStrip
        pipeline={hubCorpusPipelineFixture({
          state: 'critical',
          metadataSampledAgoSeconds: 7200,
          roster: {
            live: 45,
            collectorTracking: 21,
            expectedCollectorRows: 45,
            liveCollectorDeficitRows: 24,
            metadataOnly: 0,
            metadataStale: 41,
            admissionFeatureDisabled: 0,
            admissionDisabled: 0,
            capacityBlocked: 0,
            warming: 21,
            collecting: 0,
            viewerOnly: 0,
            zeroChatAfterAge: 0,
          },
        })}
      />,
    )
    expect(
      screen.getByText(/IRC collectors are active on some channels, but metadata freshness or coverage checks are failing\./),
    ).toBeTruthy()
    expect(screen.getByText(/Metadata sampled:/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View data coverage' }))
    expect(screen.getByText('Warming')).toBeTruthy()
  })
})
