import { describe, expect, it } from 'vitest'
import { buildPulseMomentsBucketDiagnostics } from '../src/lib/pulseMomentsBucketDiagnostics'
import type { HubActivityPoint } from '../src/lib/publicHub'
import type { FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'

const bucketMs = 6 * 60_000
const bucketT = Math.floor(Date.now() / bucketMs) * bucketMs - 8 * 60 * 60 * 1000

describe('buildPulseMomentsBucketDiagnostics', () => {
  it('reports corpus loading and empty historical peaks', () => {
    const activityPoints: HubActivityPoint[] = [
      { t: bucketT, chat: 36, seventv: 4, viewers: 800_000 },
    ]
    const diagnostics = buildPulseMomentsBucketDiagnostics({
      selectedBucketT: bucketT,
      activityWindowMinutes: 24 * 60,
      activityPoints,
      liveMoments: [] as FigmaMomentRow[],
      liveChannels: [],
      historicalStatus: 'empty',
      historicalReason: 'no_corpus_peaks_in_bucket',
      historicalCount: 0,
      historicalLoading: false,
    })
    expect(diagnostics.chartHasActivity).toBe(true)
    expect(diagnostics.withinLiveHorizon).toBe(false)
    expect(diagnostics.historicalReason).toBe('no_corpus_peaks_in_bucket')
    expect(diagnostics.summary).toMatch(/no stored corpus peaks/i)
  })

  it('shows loading summary while historical fetch is in flight', () => {
    const diagnostics = buildPulseMomentsBucketDiagnostics({
      selectedBucketT: bucketT,
      activityWindowMinutes: 24 * 60,
      activityPoints: [{ t: bucketT, chat: 12, seventv: 1, viewers: 100_000 }],
      liveMoments: [] as FigmaMomentRow[],
      liveChannels: [],
      historicalStatus: 'idle',
      historicalCount: 0,
      historicalLoading: true,
    })
    expect(diagnostics.summary).toMatch(/loading corpus peaks/i)
  })
})
