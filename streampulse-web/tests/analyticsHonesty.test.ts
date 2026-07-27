import { describe, expect, it } from 'vitest'
import { mapViewerSourceBadge } from '@streampulse/analytics-console/utils/sourceBadge'
import {
  deriveAnalyticsQualityLabel,
  type AnalyticsQualityLabel,
} from '@streampulse/analytics-console/utils/streamQuality'

describe('mapViewerSourceBadge', () => {
  it.each([
    ['live', 'Live samples'],
    ['tt', 'TwitchTracker filled'],
    ['merged', 'Merged coverage'],
    ['restored', 'Restored from archive'],
    ['mystery', 'Viewer data unavailable'],
  ] as const)('maps %s to %s', (source, label) => {
    expect(mapViewerSourceBadge(source)?.label).toBe(label)
  })

  it('returns null for unknown/empty viewerSource (hide badge)', () => {
    expect(mapViewerSourceBadge('unknown')).toBeNull()
    expect(mapViewerSourceBadge('')).toBeNull()
    expect(mapViewerSourceBadge(undefined)).toBeNull()
  })
})

describe('deriveAnalyticsQualityLabel', () => {
  it('returns No data when rollups and chat are absent', () => {
    expect(deriveAnalyticsQualityLabel({ rollupCount: 0, chatMessages: 0 })).toBe('No data')
  })

  it('returns Good for full_pulse without inventing coverage thresholds', () => {
    expect(
      deriveAnalyticsQualityLabel({
        analyticsQuality: 'full_pulse',
        summaryMetrics: { data_coverage_pct: 85, sync_health_state: 'ready' },
        rollupCount: 120,
      }),
    ).toBe('Good')
  })

  it('returns Partial for partial_pulse without inventing coverage thresholds', () => {
    expect(
      deriveAnalyticsQualityLabel({
        analyticsQuality: 'partial_pulse',
        summaryMetrics: { data_coverage_pct: 55 },
        rollupCount: 40,
      }),
    ).toBe('Partial')
  })

  it('prefers backend chartState when analyticsQuality is absent', () => {
    expect(deriveAnalyticsQualityLabel({ chartState: 'limited', rollupCount: 40 })).toBe('Limited')
    expect(deriveAnalyticsQualityLabel({ chartState: 'unavailable' })).toBe('No data')
  })

  it('returns Limited for warming/limited backend quality', () => {
    const cases: AnalyticsQualityLabel[] = ['Limited', 'Limited']
    expect(deriveAnalyticsQualityLabel({ analyticsQuality: 'warming', rollupCount: 5 })).toBe(cases[0])
    expect(deriveAnalyticsQualityLabel({ analyticsQuality: 'limited', rollupCount: 5 })).toBe(cases[1])
  })
})
