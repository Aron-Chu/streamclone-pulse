import { describe, expect, it } from 'vitest'
import {
  selectionAllowsMinuteJump,
  selectionAllowsReactionSeek,
  snapToCoveredCanonicalMinute,
} from '@streampulse/pulse-core'
import { formatIncompleteCoveragePercent } from '../streampulse-web/src/ui/components/hub/HubActivityChart.tsx'
import { densifyRollupsForTimeline } from '../src/ui/chatActivityEmotes.ts'
import { resolvePinnedChartSelection } from '../src/ui/chartSelectedMoment.ts'
import type { LiveHeatPoint } from '@streampulse/pulse-core'

describe('ChatIntervalHoverUsesAverageAndCannotSeek', () => {
  it('chat_interval never enables Jump', () => {
    expect(selectionAllowsReactionSeek('chat_interval')).toBe(false)
    expect(selectionAllowsMinuteJump('chat_interval')).toBe(false)
  })

  it('chat_interval ChartSelection payloads also gate Jump', async () => {
    const { selectionAllowsReactionSeek: allowsSeek } = await import('@streampulse/pulse-core')
    expect(
      allowsSeek({
        kind: 'chat_interval',
        startIndex: 0,
        endExclusive: 4,
        average: 10,
        peak: { index: 1, value: 20, offsetSeconds: 60 },
        observedCount: 3,
        rangeLength: 4,
        startOffsetSeconds: 0,
        endOffsetSeconds: 240,
        anchorOffsetSeconds: 60,
      }),
    ).toBe(false)
  })
})

describe('EmoteBarSelectsPeakSourceIndex', () => {
  it('emote_peak allows minute jump only', () => {
    expect(selectionAllowsReactionSeek('emote_peak')).toBe(false)
    expect(selectionAllowsMinuteJump('emote_peak')).toBe(true)
  })
})

describe('BackgroundClickSnapsToCoveredMinute', () => {
  it('snaps continuous fraction to a covered canonical minute', () => {
    expect(snapToCoveredCanonicalMinute(0.51, 0, 240, [0, 60, 120, 180])).toBe(120)
  })
})

describe('IncompleteCoverageNeverFormatsAs100', () => {
  it('floors incomplete coverage below 100%', () => {
    expect(formatIncompleteCoveragePercent(239, 240)).toBe('99.5%')
    expect(formatIncompleteCoveragePercent(239, 240)).not.toContain('100')
    expect(formatIncompleteCoveragePercent(240, 240)).toBe('100%')
  })
})

describe('ReactionClickPinsWithoutPlaybackExactMoment', () => {
  it('prefers the typed reaction moment over nearest-peak reconstruction', () => {
    const exact: LiveHeatPoint = {
      minuteTs: '',
      offsetSeconds: 600,
      reactionOnsetOffsetSeconds: 608,
      seekOffsetSeconds: 605,
      precisionSeconds: 1,
      score: 90,
      estimated: false,
      reason: 'chat_spike',
      reasonLabel: 'Chat',
      chatCount: 10,
      emoteCount: 2,
      topEmotes: [],
      collecting: false,
    }
    const neighbor: LiveHeatPoint = {
      ...exact,
      offsetSeconds: 660,
      score: 99,
    }
    const selection = resolvePinnedChartSelection({
      pinOffsetSeconds: 608,
      heatPoints: [neighbor, exact],
      rollups: [{ offsetSeconds: 600, chatCount: 1, sevenTvEmoteCount: 0 }],
      selectedReactionMoment: exact,
    })
    expect(selection?.kind).toBe('peak')
    expect(selection?.point).toBe(exact)
    expect(selection?.point.seekOffsetSeconds).toBe(605)
  })
})

describe('LongStreamDensifyPreservesOneMinutePeaks', () => {
  it('does not average a 21h span into 480 synthetic rows', () => {
    const rollups = Array.from({ length: 1260 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: i === 900 ? 999 : 1,
      sevenTvEmoteCount: i === 500 ? 50 : 0,
      viewerCount: 10,
      viewerAvg: 10,
      viewerSamples: 1,
    }))
    const densified = densifyRollupsForTimeline(rollups, {
      fromOffset: 0,
      toOffset: 1259 * 60,
      maxPoints: 480,
    })
    expect(densified.length).toBeGreaterThan(480)
    expect(densified.some((row) => (row.chatCount ?? 0) === 999)).toBe(true)
    expect(densified.some((row) => (row.sevenTvEmoteCount ?? 0) === 50)).toBe(true)
  })
})
