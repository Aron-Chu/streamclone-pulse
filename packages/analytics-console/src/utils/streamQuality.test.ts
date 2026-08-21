import { describe, expect, it } from 'vitest'
import {
  deriveAnalyticsQualityLabel,
  diagnoseLiveViewerWarmup,
  diagnoseStreamQuality,
} from './streamQuality.ts'

describe('deriveAnalyticsQualityLabel', () => {
  it('uses healthy summary coverage when analyticsQuality is stale limited', () => {
    expect(deriveAnalyticsQualityLabel({
      analyticsQuality: 'limited',
      summaryMetrics: { sync_health_state: 'synced', data_coverage_pct: 99 },
      rollupCount: 120,
      chatMessages: 500,
    })).toBe('Good')
  })

  it('keeps genuinely partial summary coverage partial', () => {
    expect(deriveAnalyticsQualityLabel({
      analyticsQuality: 'full_pulse',
      summaryMetrics: { sync_health_state: 'partial', data_coverage_pct: 79 },
      rollupCount: 90,
      chatMessages: 400,
    })).toBe('Partial')
  })

  it('does not call a late missing prefix complete despite high aggregate coverage', () => {
    expect(deriveAnalyticsQualityLabel({
      analyticsQuality: 'limited',
      summaryMetrics: { sync_health_state: 'synced', data_coverage_pct: 99 },
      coverageStartOffsetSeconds: 240,
      rollupCount: 120,
      chatMessages: 500,
    })).toBe('Partial')
  })

  it('does not raise a stats-only warning for healthy summary coverage', () => {
    const diagnosis = diagnoseStreamQuality({
      detail: {
        channel: 'caedrel',
        state: 'historical',
        rollups: [
          { minuteTs: '2026-07-13T18:00:00Z', chatCount: 10, viewerSamples: 1, viewerLatest: 100 },
          { minuteTs: '2026-07-13T18:01:00Z', chatCount: 12, viewerSamples: 1, viewerLatest: 110 },
        ],
        topEmotes: [],
        sources: [],
        updatedAt: 1,
        stream: { streamId: '315825082577', login: 'caedrel', startedAt: '2026-07-13T18:00:00Z', avgViewers: 105 },
      },
      summaryMetrics: { sync_health_state: 'synced', data_coverage_pct: 99 },
      analyticsQuality: 'limited',
    })

    expect(diagnosis?.issues).not.toContain('stats_only')
  })

  it('explains that a late viewer start is a separate sample stream, not a loading bar', () => {
    const diagnosis = diagnoseLiveViewerWarmup([
      { minuteTs: '2026-08-17T23:42:30Z', chatCount: 40 },
      { minuteTs: '2026-08-17T23:48:30Z', chatCount: 50 },
      { minuteTs: '2026-08-17T23:49:00Z', chatCount: 60, viewerSamples: 1, viewerLatest: 24_523 },
      { minuteTs: '2026-08-17T23:50:00Z', chatCount: 70, viewerSamples: 1, viewerLatest: 24_523 },
    ], true, '2026-08-17T23:42:30Z')

    expect(diagnosis?.message).toBe(
      'Viewer data begins at 00:06:30. Twitch viewer counts are sampled separately from chat and emotes, so the unsampled opening is left blank.',
    )
  })
})
