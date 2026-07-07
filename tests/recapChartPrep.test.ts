import { describe, expect, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import {
  buildRecapChartSeries,
  downsampleTimeline,
  normalizeChartValue,
  prepareRecapChartRollups,
  rollupChartActivityScore,
} from '../src/ui/recapChartPrep.ts'

function minuteRollup(offsetSeconds: number, chatCount: number, emotes = 0): ExtensionRollup {
  return {
    offsetSeconds,
    chatCount,
    sevenTvEmoteCount: emotes,
    totalEmoteCount: emotes,
  }
}

describe('downsampleTimeline', () => {
  it('keeps the highest-activity minute in each bucket', () => {
    const minutes = Array.from({ length: 480 }, (_, index) =>
      minuteRollup(index * 60, index === 240 ? 900 : 5),
    )
    const downsampled = downsampleTimeline(minutes, 240, rollupChartActivityScore)
    const peak = downsampled.find(rollup => rollup.chatCount === 900)
    expect(peak).toBeDefined()
    expect(peak?.offsetSeconds).toBe(240 * 60)
  })
})

describe('buildRecapChartSeries', () => {
  it('normalizes stream max chat to 100', () => {
    const series = buildRecapChartSeries([
      minuteRollup(0, 10),
      minuteRollup(60, 500),
      minuteRollup(120, 100),
    ])
    expect(series.map(point => point.chatNorm)).toEqual([2, 100, 20])
  })

  it('computes heat from normalized chat and emotes', () => {
    const series = buildRecapChartSeries([minuteRollup(0, 100, 50)])
    expect(series[0]?.heat).toBe(85)
  })
})

describe('prepareRecapChartRollups', () => {
  it('zero-fills and downsamples long streams', () => {
    const sparse: ExtensionRollup[] = [
      minuteRollup(0, 1),
      minuteRollup(12_000, 800),
      minuteRollup(24_000, 2),
    ]
    const prepared = prepareRecapChartRollups(sparse, 24_000, 120)
    expect(prepared.length).toBeLessThanOrEqual(122)
    expect(prepared.some(rollup => rollup.chatCount === 800)).toBe(true)
  })
})

describe('normalizeChartValue', () => {
  it('clamps to 0-100', () => {
    expect(normalizeChartValue(50, 100)).toBe(50)
    expect(normalizeChartValue(150, 100)).toBe(100)
    expect(normalizeChartValue(0, 0)).toBe(0)
  })
})
