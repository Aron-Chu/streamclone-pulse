import { describe, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { viewportBuckets, targetBucketCount } from '../src/ui/chartViewport.ts'
import { chatWhisperVisualLayer, emoteDenseVisualLayer } from '../src/ui/chartRollupUtils.ts'
import { resolveOverviewPointerSelection } from '../src/ui/chartSelectionHitTest.ts'

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
  console.log(`${label.padEnd(46)} ${(total / iterations).toFixed(4)} ms/op  (${iterations} ops)`)
}

describe('chart hot-path benchmark', () => {
  it('measures viewport bucketing and lane opacity cost', () => {
    const long = makeRollups(1440) // 24h stream, minute rollups
    const typical = makeRollups(240) // 4h stream
    const target = targetBucketCount(300, 240)

    time('viewportBuckets 1440 rollups (zoomed in)', 2000, () => {
      viewportBuckets(long, { startSeconds: 30_000, endSeconds: 33_600 }, target)
    })
    time('viewportBuckets 1440 rollups (full out)', 2000, () => {
      viewportBuckets(long, { startSeconds: 0, endSeconds: 86_400 }, target)
    })
    time('viewportBuckets 240 rollups', 5000, () => {
      viewportBuckets(typical, { startSeconds: 0, endSeconds: 14_400 }, target)
    })

    const bars = 260
    time('chat lane opacity x260 (hover frame)', 5000, () => {
      for (let i = 0; i < bars; i += 1) {
        chatWhisperVisualLayer({ index: i, activeIndex: 130, pinIndex: null, hasValue: true, scheme: 'dark', visualBoost: 1.2 })
      }
    })
    time('emote lane opacity x260 (hover frame)', 5000, () => {
      for (let i = 0; i < bars; i += 1) {
        emoteDenseVisualLayer({ index: i, activeIndex: 130, pinIndex: null, hasValue: true, isSpike: false, scheme: 'dark', visualBoost: 1.2 })
      }
    })
    time('pointer canonical hit-test (1440 rollups)', 5000, () => {
      resolveOverviewPointerSelection({
        plotX: 180,
        plotY: 5,
        chatBars: [],
        emoteBars: [],
        reactionBars: [],
        reactionPoints: [],
        reactionGutterTop: 90,
        reactionGutterBottom: 98,
        emoteMagnitudeTop: 60,
        emoteMagnitudeBottom: 88,
        chatLaneTop: 20,
        chatLaneBottom: 55,
        displayRollups: long,
        viewportStartSeconds: 0,
        viewportDuration: 86_400,
        fraction: 0.61,
      })
    })
  })
})
