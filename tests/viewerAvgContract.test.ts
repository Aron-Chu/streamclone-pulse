import { describe, expect, it } from 'vitest'
import { chartViewerValue } from '../src/ui/chartRollupUtils.ts'

describe('ViewerLineUsesSampledMinuteAverageAndPreservesObservedZero', () => {
  it('uses viewerAvg for sampled chart minutes, including observed zero', () => {
    expect(
      chartViewerValue({
        offsetSeconds: 0,
        chatCount: 0,
        sevenTvEmoteCount: 0,
        viewerCount: 500,
        viewerAvg: 120,
        viewerSamples: 3,
      }),
    ).toBe(120)
    expect(
      chartViewerValue({
        offsetSeconds: 60,
        chatCount: 0,
        sevenTvEmoteCount: 0,
        viewerCount: 500,
        viewerAvg: 0,
        viewerSamples: 2,
      }),
    ).toBe(0)
  })

  it('plots hosted offline rollups that only send viewerCount (no samples/avg)', () => {
    // Hosted v0.2.11 extension pulse omits viewerSamples + viewerAvg and only
    // emits viewerCount — Overview must still draw the viewers line.
    expect(
      chartViewerValue({
        offsetSeconds: 27548,
        chatCount: 550,
        sevenTvEmoteCount: 391,
        totalEmoteCount: 457,
        viewerCount: 22410,
      }),
    ).toBe(22410)
    expect(
      chartViewerValue({
        offsetSeconds: 60,
        chatCount: 10,
        viewerCount: 9000,
        viewerSamples: 0,
      }),
    ).toBeNull()
  })
})
