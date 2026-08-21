import { describe, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { viewportBuckets, targetBucketCount } from '../src/ui/chartViewport.ts'
import {
  rollupsToChartMinuteRollups,
  smoothNullableSeriesValues,
  trendSmoothingWindow,
  barDisplayAxisMax,
  softFitSeriesToAxis,
} from '../src/ui/chartRollupUtils.ts'

function makeRollups(count: number): ExtensionRollup[] {
  const out: ExtensionRollup[] = []
  for (let i = 0; i < count; i += 1) {
    out.push({
      offsetSeconds: i * 60,
      chatCount: Math.round(200 + Math.sin(i / 7) * 180),
      sevenTvEmoteCount: Math.round(60 + Math.cos(i / 5) * 55),
      totalEmoteCount: Math.round(90 + Math.cos(i / 5) * 80),
      viewerCount: Math.round(40000 + Math.sin(i / 21) * 15000),
    })
  }
  return out
}

function time(label: string, iterations: number, fn: () => void): void {
  fn()
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) fn()
  const total = performance.now() - start
  // eslint-disable-next-line no-console
  console.log(`${label.padEnd(48)} ${(total / iterations).toFixed(4)} ms/op`)
}

describe('pipeline benchmark', () => {
  it('measures per-frame chart pipeline cost', () => {
    const long = makeRollups(1440)
    const target = targetBucketCount(300, 240)
    const display = viewportBuckets(long, { startSeconds: 0, endSeconds: 86_400 }, target)
    const series = display.map(r => r.chatCount || null)
    const win = trendSmoothingWindow(display.length)

    time('rollupsToChartMinuteRollups (1440, all rollups)', 500, () => {
      rollupsToChartMinuteRollups(long, '2026-08-01T00:00:00Z')
    })
    time('smoothNullableSeriesValues (260)', 5000, () => {
      smoothNullableSeriesValues(series, win)
    })
    time('softFitSeriesToAxis (260)', 5000, () => {
      softFitSeriesToAxis(series, barDisplayAxisMax(series))
    })
    time('full wheel-zoom frame: bucket+smooth+fit x3', 2000, () => {
      const d = viewportBuckets(long, { startSeconds: 1000, endSeconds: 40_000 }, target)
      for (const key of ['chatCount', 'sevenTvEmoteCount', 'viewerCount'] as const) {
        const s = d.map(r => (r[key] ?? 0) || null)
        softFitSeriesToAxis(smoothNullableSeriesValues(s, win), barDisplayAxisMax(s))
      }
    })
  })
})
