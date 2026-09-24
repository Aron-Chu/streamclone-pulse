import { describe, expect, it } from 'vitest'
import { buildRenderBuckets } from '../src/renderBuckets.ts'
import {
  chartViewerValue,
  viewerObservedValue,
  viewerReadoutValue,
} from '../src/chartRollupUtils.ts'

describe('ChatAverageBarReportsIntervalAverage', () => {
  it('chat bucket average is the bar primary value; peak is separate', () => {
    const result = buildRenderBuckets({ chat: [10, 30, 20] }, 1)
    const chat = result.signals.chat?.[0]
    expect(chat?.average).toBeCloseTo(20, 5)
    expect(chat?.peak).toEqual({ index: 1, value: 30 })
  })
})

describe('EmotePeakBarUsesExactSourceMinute', () => {
  it('emote peak value and index agree', () => {
    const result = buildRenderBuckets({ emotes: [1, 9, 2] }, 1)
    expect(result.signals.emotes?.[0]?.peak).toEqual({ index: 1, value: 9 })
  })
})

describe('RenderViewDoesNotMutateCanonicalRollups', () => {
  it('buildRenderBuckets leaves source signal arrays untouched', () => {
    const chat = [4, 8, 2]
    const frozen = [...chat]
    buildRenderBuckets({ chat }, 1)
    expect(chat).toEqual(frozen)
  })
})

describe('ViewerPlotAndReadoutShareObservedValue', () => {
  it('plot and readout agree when samples exist', () => {
    const point = {
      minuteTs: '',
      chatCount: 1,
      sevenTvEmoteCount: 0,
      totalEmoteCount: 0,
      viewerCount: 100,
      viewerAvg: 90,
      viewerSamples: 3,
    }
    expect(chartViewerValue(point)).toBe(90)
    expect(viewerObservedValue(point)).toBe(90)
  })
})

describe('LegacyViewerZeroWithoutSamplesIsUnknown', () => {
  it('absent samples plus zero is unknown, not observed zero', () => {
    const point = {
      minuteTs: '',
      chatCount: 0,
      sevenTvEmoteCount: 0,
      totalEmoteCount: 0,
      viewerCount: 0,
    }
    expect(viewerObservedValue(point)).toBeNull()
    expect(viewerReadoutValue(point)).toBeNull()
  })
})
