import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText(/Live chat tracking is active across the top-N roster\./)).toBeTruthy()
  })
})