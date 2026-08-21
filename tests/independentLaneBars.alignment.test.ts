import { describe, expect, it } from 'vitest'
import {
  buildIndependentLaneBars,
  rollupColumnOffsetSeconds,
  xForViewportOffset,
} from '../src/ui/PulseOverviewChart.tsx'
import { collectBandLinePoints } from '../src/ui/chartRollupUtils.ts'
import { columnCenterXForOffset } from '../src/ui/chartSelectionHitTest.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'

const PAD_LEFT = 4

describe('buildIndependentLaneBars shared window geometry', () => {
  it('places chat average and emote peak bars on the same x/width for a bucket', () => {
    const source: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2, totalEmoteCount: 2 },
      { offsetSeconds: 60, chatCount: 40, sevenTvEmoteCount: 8, totalEmoteCount: 8 },
      { offsetSeconds: 120, chatCount: 20, sevenTvEmoteCount: 30, totalEmoteCount: 30 },
      { offsetSeconds: 180, chatCount: 15, sevenTvEmoteCount: 5, totalEmoteCount: 5 },
    ]
    const buckets = [
      {
        startIndex: 0,
        endExclusive: 4,
        count: 4,
        average: 21.25,
        observedRatio: 1,
        fullyObserved: true,
        rangeLength: 4,
        peak: { index: 2, value: 30 },
      },
    ]
    const viewport = { startSeconds: 0, endSeconds: 240 }
    const common = [
      buckets,
      source,
      source,
      40,
      300,
      10,
      60,
      viewport,
    ] as const

    const chatBars = buildIndependentLaneBars(...common, 'average')
    const emoteBars = buildIndependentLaneBars(...common, 'peak')

    expect(chatBars[0]).not.toBeNull()
    expect(emoteBars[0]).not.toBeNull()
    expect(chatBars[0]!.x).toBe(emoteBars[0]!.x)
    expect(chatBars[0]!.width).toBe(emoteBars[0]!.width)
    expect(chatBars[0]!.offsetSeconds).toBe(emoteBars[0]!.offsetSeconds)
    expect(chatBars[0]!.offsetSeconds).toBe(120)
    // Heights still encode different metrics.
    expect(emoteBars[0]!.height).not.toBe(chatBars[0]!.height)
    expect(emoteBars[0]!.peak?.offsetSeconds).toBe(120)
  })

  it('places a 1-minute trend vertex on the same x as the chat/emote bar column', () => {
    const source: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2, totalEmoteCount: 2 },
      { offsetSeconds: 60, chatCount: 40, sevenTvEmoteCount: 8, totalEmoteCount: 8 },
      { offsetSeconds: 120, chatCount: 20, sevenTvEmoteCount: 30, totalEmoteCount: 30 },
    ]
    const buckets = source.map((_, index) => ({
      startIndex: index,
      endExclusive: index + 1,
      count: 1,
      average: source[index]!.chatCount ?? 0,
      observedRatio: 1,
      fullyObserved: true,
      rangeLength: 1,
      peak: { index, value: source[index]!.totalEmoteCount ?? 0 },
    }))
    const viewport = { startSeconds: 0, endSeconds: 180 }
    const plotWidth = 300
    const chatBars = buildIndependentLaneBars(
      buckets,
      source,
      source,
      40,
      plotWidth,
      10,
      60,
      viewport,
      'average',
    )
    const emoteBars = buildIndependentLaneBars(
      buckets,
      source,
      source,
      40,
      plotWidth,
      70,
      120,
      viewport,
      'peak',
    )
    const sampleXs = source.map(point =>
      xForViewportOffset(rollupColumnOffsetSeconds(point.offsetSeconds), viewport, plotWidth),
    )
    const points = collectBandLinePoints(
      source.map(point => point.chatCount ?? 0),
      40,
      plotWidth + PAD_LEFT + 12,
      160,
      PAD_LEFT,
      12,
      10,
      60,
      0,
      sampleXs,
    )
    expect(chatBars[1]!.x).toBe(emoteBars[1]!.x)
    expect(points[1]!.x).toBe(chatBars[1]!.x + chatBars[1]!.width / 2)
    expect(columnCenterXForOffset(emoteBars, 90)).toBe(points[1]!.x)
  })

  it('snaps a 1s-onset pin to the containing LOD column, not onset x', () => {
    const source: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2, totalEmoteCount: 2 },
      { offsetSeconds: 60, chatCount: 40, sevenTvEmoteCount: 8, totalEmoteCount: 8 },
      { offsetSeconds: 120, chatCount: 20, sevenTvEmoteCount: 30, totalEmoteCount: 30 },
      { offsetSeconds: 180, chatCount: 15, sevenTvEmoteCount: 5, totalEmoteCount: 5 },
    ]
    const buckets = [
      {
        startIndex: 0,
        endExclusive: 4,
        count: 4,
        average: 21.25,
        observedRatio: 1,
        fullyObserved: true,
        rangeLength: 4,
        peak: { index: 2, value: 30 },
      },
    ]
    const viewport = { startSeconds: 0, endSeconds: 240 }
    const plotWidth = 300
    const emoteBars = buildIndependentLaneBars(
      buckets,
      source,
      source,
      40,
      plotWidth,
      10,
      60,
      viewport,
      'peak',
    )
    const onsetSeconds = 90
    const columnX = columnCenterXForOffset(emoteBars, onsetSeconds)
    const onsetX = xForViewportOffset(onsetSeconds, viewport, plotWidth)
    expect(columnX).toBe(emoteBars[0]!.x + emoteBars[0]!.width / 2)
    expect(onsetX).not.toBe(columnX)
  })
})
