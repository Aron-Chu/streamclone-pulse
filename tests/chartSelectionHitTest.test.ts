import { describe, expect, it } from 'vitest'
import {
  columnBandForOffset,
  hoverIndexForPointerSelection,
  resolveHoverBucketBand,
  resolveOverviewPointerSelection,
  resolveOverviewClickCommit,
  resolvePlotClickAction,
  type IntervalLaneBar,
} from '../src/ui/chartSelectionHitTest.ts'
import type { ExtensionPeak, ExtensionRollup } from '../src/shared/messages.ts'
import type { ReactionLaneGeometry } from '@streampulse/pulse-charts'

function bar(partial: Partial<IntervalLaneBar> & Pick<IntervalLaneBar, 'x' | 'width'>): IntervalLaneBar {
  return {
    y: 10,
    height: 20,
    hasValue: true,
    startIndex: 0,
    endExclusive: 4,
    average: 40,
    peak: { index: 2, value: 90, offsetSeconds: 120 },
    observedCount: 3,
    rangeLength: 4,
    observedRatio: 0.75,
    fullyObserved: false,
    value: 40,
    startOffsetSeconds: 0,
    endOffsetSeconds: 240,
    offsetSeconds: 120,
    sourceIndex: 2,
    ...partial,
  }
}

describe('ChartSelection hit testing', () => {
  const rollups: ExtensionRollup[] = [
    { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
    { offsetSeconds: 60, chatCount: 2, sevenTvEmoteCount: 0 },
    { offsetSeconds: 120, chatCount: 3, sevenTvEmoteCount: 5 },
    { offsetSeconds: 180, chatCount: 4, sevenTvEmoteCount: 0 },
  ]
  const reactionMoment: ExtensionPeak = {
    offsetSeconds: 120,
    score: 90,
    reasons: ['chat_spike'],
    reactionOnsetOffsetSeconds: 128,
    seekOffsetSeconds: 125,
    precisionSeconds: 1,
  }
  const reactionBars: ReactionLaneGeometry[] = [
    {
      key: 'r-120',
      moment: reactionMoment,
      centerX: 100,
      x: 96,
      width: 8,
      hitX: 94,
      hitWidth: 12,
      y: 90,
      height: 6,
      score: 90,
      confidence: 1,
      seekOffsetSeconds: 125,
      reason: 'chat_spike',
      color: '#f59e0b',
      offsetSeconds: 120,
      startSeconds: 120,
      endSeconds: 180,
      durationSeconds: 60,
      refined: true,
    },
  ]

  it('chat bar click emits chat_interval payload with average and coverage', () => {
    const selection = resolveOverviewPointerSelection({
      plotX: 50,
      plotY: 40,
      chatBars: [bar({ x: 40, width: 20, average: 42, observedCount: 3, rangeLength: 4 })],
      emoteBars: [],
      reactionBars: [],
      reactionPoints: [],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.25,
    })
    expect(selection.kind).toBe('chat_interval')
    if (selection.kind === 'chat_interval') {
      expect(selection.average).toBe(42)
      expect(selection.observedCount).toBe(3)
      expect(selection.rangeLength).toBe(4)
      expect(selection.peak).toEqual({ index: 2, value: 90, offsetSeconds: 120 })
      expect(selection.startOffsetSeconds).toBe(0)
      expect(selection.endOffsetSeconds).toBe(240)
      expect(selection.anchorOffsetSeconds).toBe(120)
    }
  })

  it('PulseOverviewChart.chatClickPreservesIntervalIdentity', () => {
    const selection = resolveOverviewPointerSelection({
      plotX: 50,
      plotY: 40,
      chatBars: [bar({
        x: 40,
        width: 20,
        startIndex: 20,
        endExclusive: 30,
        startOffsetSeconds: 1200,
        endOffsetSeconds: 1800,
        offsetSeconds: 1500,
        average: 22,
        peak: { index: 25, value: 90, offsetSeconds: 1500 },
        observedCount: 10,
        rangeLength: 10,
      })],
      emoteBars: [],
      reactionBars: [],
      reactionPoints: [],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.25,
    })
    expect(selection.kind).toBe('chat_interval')
    if (selection.kind === 'chat_interval') {
      expect(selection.startOffsetSeconds).toBe(1200)
      expect(selection.endOffsetSeconds).toBe(1800)
      expect(selection.anchorOffsetSeconds).toBe(1500)
      expect(selection.startOffsetSeconds).not.toBe(1500)
    }
  })

  it('emote magnitude selects peak; gutter selects reaction; magnitude misses reaction', () => {
    const emote = resolveOverviewPointerSelection({
      plotX: 100,
      plotY: 70,
      chatBars: [],
      emoteBars: [bar({ x: 90, width: 20, peak: { index: 2, value: 55 }, value: 55, offsetSeconds: 120 })],
      reactionBars,
      reactionPoints: [reactionMoment],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.5,
    })
    expect(emote.kind).toBe('emote_peak')

    const reaction = resolveOverviewPointerSelection({
      plotX: 100,
      plotY: 94,
      chatBars: [],
      emoteBars: [bar({ x: 90, width: 20, peak: { index: 2, value: 55 }, value: 55, offsetSeconds: 120 })],
      reactionBars,
      reactionPoints: [reactionMoment],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.5,
    })
    expect(reaction.kind).toBe('reaction')
    if (reaction.kind === 'reaction') {
      expect(reaction.analyticalOffsetSeconds).toBe(128)
    }

    const miss = resolveOverviewPointerSelection({
      plotX: 100,
      plotY: 70,
      chatBars: [],
      emoteBars: [],
      reactionBars,
      reactionPoints: [reactionMoment],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.5,
    })
    expect(miss.kind).not.toBe('reaction')
  })

  it('uses a covered chart minute when inspecting outside the activity bars', () => {
    const selection = resolveOverviewPointerSelection({
      plotX: 10,
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
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.51,
    })
    expect(selection.kind).toBe('chart_minute')
    if (selection.kind === 'chart_minute') expect(selection.offsetSeconds).toBe(120)
  })

  it('maps an irregular zoomed timeline to the nearest real covered bucket', () => {
    const irregular: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
      { offsetSeconds: 47, chatCount: 2, sevenTvEmoteCount: 1 },
      { offsetSeconds: 110, chatCount: 0, sevenTvEmoteCount: 0, missing: true },
      { offsetSeconds: 215, chatCount: 5, sevenTvEmoteCount: 3 },
    ]
    const selection = resolveOverviewPointerSelection({
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
      displayRollups: irregular,
      viewportStartSeconds: 100,
      viewportDuration: 130,
      fraction: 0.82,
    })
    expect(selection).toEqual({
      kind: 'chart_minute',
      canonicalIndex: 3,
      offsetSeconds: 215,
    })
  })

  it('never exposes a missing bucket as the cursor preview', () => {
    const withGap: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
      { offsetSeconds: 60, chatCount: 0, sevenTvEmoteCount: 0, missing: true },
      { offsetSeconds: 120, chatCount: 4, sevenTvEmoteCount: 2 },
    ]
    const selection = resolveOverviewPointerSelection({
      plotX: 100,
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
      displayRollups: withGap,
      viewportStartSeconds: 0,
      viewportDuration: 120,
      fraction: 0.5,
    })
    expect(selection.kind).toBe('chart_minute')
    if (selection.kind === 'chart_minute') {
      expect(selection.offsetSeconds).not.toBe(60)
      expect(withGap[selection.canonicalIndex]?.missing).not.toBe(true)
    }
  })

  it('does not claim a nearby activity bar but still resolves the chart minute', () => {
    const nearby = bar({ x: 40, width: 20 })
    const miss = resolveOverviewPointerSelection({
      plotX: 62,
      plotY: 40,
      chatBars: [nearby],
      emoteBars: [],
      reactionBars: [],
      reactionPoints: [],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.51,
      snapToNearestBar: false,
    })
    expect(miss.kind).toBe('chart_minute')
  })

  it('hover may still snap to a nearby bar', () => {
    const nearby = bar({ x: 40, width: 20 })
    const hover = resolveOverviewPointerSelection({
      plotX: 62,
      plotY: 40,
      chatBars: [nearby],
      emoteBars: [],
      reactionBars: [],
      reactionPoints: [],
      reactionGutterTop: 90,
      reactionGutterBottom: 98,
      emoteMagnitudeTop: 60,
      emoteMagnitudeBottom: 88,
      chatLaneTop: 20,
      chatLaneBottom: 55,
      displayRollups: rollups,
      viewportStartSeconds: 0,
      viewportDuration: 240,
      fraction: 0.51,
      snapToNearestBar: true,
    })
    expect(hover.kind).toBe('chat_interval')
  })
})

describe('resolveOverviewClickCommit', () => {
  it('clears a pin when the click misses the plot (viewer lane / empty graph)', () => {
    expect(resolveOverviewClickCommit({ kind: 'none' }, 120)).toBe('clear')
  })

  it('ignores empty-plot misses when nothing is pinned', () => {
    expect(resolveOverviewClickCommit({ kind: 'none' }, null)).toBe('ignore')
  })

  it('clears when the same spike offset is clicked again', () => {
    expect(
      resolveOverviewClickCommit(
        { kind: 'reaction', moment: { offsetSeconds: 128 }, analyticalOffsetSeconds: 128 },
        128,
      ),
    ).toBe('clear')
  })

  it('selects a different spike instead of clearing', () => {
    expect(
      resolveOverviewClickCommit(
        { kind: 'reaction', moment: { offsetSeconds: 240 }, analyticalOffsetSeconds: 240 },
        128,
      ),
    ).toBe('select')
  })

  it('selects when nothing is pinned yet', () => {
    expect(
      resolveOverviewClickCommit(
        { kind: 'emote_peak', sourceIndex: 2, offsetSeconds: 120, value: 9 },
        null,
      ),
    ).toBe('select')
  })

  it('clears when the pin sits inside the LOD column window, even if anchors differ by more than 1s', () => {
    expect(
      resolveOverviewClickCommit(
        {
          kind: 'chat_interval',
          startIndex: 0,
          endExclusive: 4,
          startOffsetSeconds: 0,
          endOffsetSeconds: 240,
          average: 40,
          peak: { index: 2, value: 90, offsetSeconds: 120 },
          observedCount: 3,
          rangeLength: 4,
          anchorOffsetSeconds: 120,
        },
        90,
      ),
    ).toBe('clear')
  })

  it('clears an emote column when the pin is inside the bar window, not the 1s anchor', () => {
    expect(
      resolveOverviewClickCommit(
        { kind: 'emote_peak', sourceIndex: 2, offsetSeconds: 1500, value: 9 },
        1200,
        { startOffsetSeconds: 1200, endOffsetSeconds: 1800 },
      ),
    ).toBe('clear')
  })

  it('selects a different LOD column instead of clearing', () => {
    expect(
      resolveOverviewClickCommit(
        {
          kind: 'chat_interval',
          startIndex: 4,
          endExclusive: 8,
          startOffsetSeconds: 240,
          endOffsetSeconds: 480,
          average: 10,
          peak: null,
          observedCount: 4,
          rangeLength: 4,
          anchorOffsetSeconds: 240,
        },
        90,
      ),
    ).toBe('select')
  })

  it('treats a double-click as a second commit, not series focus', () => {
    expect(
      resolvePlotClickAction({
        clickDetail: 2,
        selection: {
          kind: 'chat_interval',
          startIndex: 0,
          endExclusive: 4,
          startOffsetSeconds: 0,
          endOffsetSeconds: 240,
          average: 40,
          peak: { index: 2, value: 90, offsetSeconds: 120 },
          observedCount: 3,
          rangeLength: 4,
          anchorOffsetSeconds: 120,
        },
        selectedOffsetSeconds: 90,
      }),
    ).toBe('clear')
  })

  it('keeps a rapid second press locked when it lands at a different visual position', () => {
    const selection = {
      kind: 'chat_interval' as const,
      startIndex: 0,
      endExclusive: 4,
      startOffsetSeconds: 0,
      endOffsetSeconds: 240,
      average: 40,
      peak: { index: 2, value: 90, offsetSeconds: 120 },
      observedCount: 4,
      rangeLength: 4,
      anchorOffsetSeconds: 120,
    }
    expect(resolvePlotClickAction({
      clickDetail: 2,
      selection,
      selectedOffsetSeconds: 120,
      columnWindow: { startOffsetSeconds: 0, endOffsetSeconds: 240 },
      plotX: 58,
      eventTimeMs: 1_300,
      previousCommit: { plotX: 42, eventTimeMs: 1_000 },
    })).toBe('select')
  })

  it('still clears a rapid re-click at the same visual position', () => {
    expect(resolvePlotClickAction({
      clickDetail: 2,
      selection: { kind: 'chart_minute', canonicalIndex: 2, offsetSeconds: 120 },
      selectedOffsetSeconds: 120,
      plotX: 42,
      eventTimeMs: 1_120,
      previousCommit: { plotX: 42, eventTimeMs: 1_000 },
    })).toBe('clear')
  })
})

describe('hover bucket band', () => {
  const left = bar({
    x: 10,
    width: 20,
    startOffsetSeconds: 0,
    endOffsetSeconds: 60,
    offsetSeconds: 30,
  })
  const right = bar({
    x: 32,
    width: 18,
    startOffsetSeconds: 60,
    endOffsetSeconds: 120,
    offsetSeconds: 90,
  })

  it('returns the containing column x/width for a hover offset', () => {
    expect(columnBandForOffset([left, right], 90)).toEqual({ x: 32, width: 18 })
  })

  it('prefers chat bars, then emote bars, then the fallback index', () => {
    expect(
      resolveHoverBucketBand({
        chatBars: [left, right],
        emoteBars: [],
        offsetSeconds: 75,
        fallbackIndex: 0,
      }),
    ).toEqual({ x: 32, width: 18 })
    expect(
      resolveHoverBucketBand({
        chatBars: [],
        emoteBars: [left, null],
        offsetSeconds: null,
        fallbackIndex: 0,
      }),
    ).toEqual({ x: 10, width: 20 })
  })

  it('does not map a miss onto a hover bucket — click would ignore that point', () => {
    expect(
      hoverIndexForPointerSelection({ kind: 'none' }, 3),
    ).toBeNull()
    expect(
      hoverIndexForPointerSelection(
        { kind: 'emote_peak', sourceIndex: 2, offsetSeconds: 120, value: 9 },
        2,
      ),
    ).toBe(2)
  })
})
