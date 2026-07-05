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
    expect(screen.getByText(/Warming \(IRC connected\)/)).toBeTruthy()
  })
})