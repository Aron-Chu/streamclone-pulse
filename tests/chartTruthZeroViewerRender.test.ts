import { describe, expect, it } from 'vitest'
import { contiguousPathRunsAcrossBuckets, composeRenderView } from '@streampulse/pulse-charts'
import { chartViewerValue } from '../src/ui/chartRollupUtils.ts'
import { signalRenderBucketsForChart } from '../src/ui/extensionChartPoints.ts'

describe('ObservedZeroViewerBaselineRenders', () => {
  it('keeps an entirely observed zero viewer series as plottable samples', () => {
    const rollups = Array.from({ length: 8 }, (_, index) => ({
      offsetSeconds: index * 60,
      chatCount: 1,
      sevenTvEmoteCount: 0,
      viewerAvg: 0,
      viewerSamples: 2,
      viewerCount: 0,
    }))
    expect(rollups.every((row) => chartViewerValue(row) === 0)).toBe(true)
    const buckets = signalRenderBucketsForChart(rollups, 8)
    expect(buckets.viewers.some((bucket) => bucket.count > 0)).toBe(true)
    const runs = contiguousPathRunsAcrossBuckets(buckets.viewers)
    expect(runs.length).toBeGreaterThan(0)
    expect(runs[0]?.every((point) => point.value === 0)).toBe(true)
  })
})

describe('ContiguousRunsHelperIsShared', () => {
  it('merges adjacent composeRenderView buckets', () => {
    const view = composeRenderView({ viewers: [1, 2, 3, 4] }, 2)
    expect(contiguousPathRunsAcrossBuckets(view.signals.viewers ?? [])).toHaveLength(1)
  })
})
