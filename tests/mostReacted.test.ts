import { describe, expect, it } from 'vitest'
import type { ExtensionPeak } from '../src/shared/messages.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import {
  formatCount,
  findExactHeatPointAtOffset,
  heatPointMatchesExactOffset,
  peakChatCount,
  peakEmoteCount,
  peakEmoteKey,
  peakReasonLabel,
  resolveMostReactedHeat,
  resolveSelectedMomentKey,
  reactionRankValue,
  authoritativeReactionScore,
  selectedMomentKey,
  sortLiveHeatPoints,
} from '../src/ui/mostReacted.ts'

describe('peakReasonLabel', () => {
  it('prefers BFF reasonLabel when present', () => {
    const peak: ExtensionPeak = {
      offsetSeconds: 120,
      score: 88,
      reasons: ['chat_spike'],
      reasonLabel: 'Chat spike',
      dominantSignal: 'chat',
      chatCount: 42,
      emoteCount: 7,
    }
    expect(peakReasonLabel(peak)).toBe('Chat spike')
  })

  it('falls back to pulse-core mapping from reason code', () => {
    const peak: ExtensionPeak = {
      offsetSeconds: 120,
      score: 88,
      reasons: ['seventv_spike'],
      dominantSignal: 'seventv',
    }
    expect(peakReasonLabel(peak)).toBe('Emote spike')
  })
})

describe('peak counts', () => {
  it('returns zero when counts are missing', () => {
    const peak: ExtensionPeak = {
      offsetSeconds: 0,
      score: 1,
      reasons: [],
      dominantSignal: '',
    }
    expect(peakChatCount(peak)).toBe(0)
    expect(peakEmoteCount(peak)).toBe(0)
  })
})

describe('peakEmoteKey', () => {
  it('uses id when available', () => {
    expect(peakEmoteKey({ id: 'abc', name: 'KEKW', count: 1 }, 0)).toBe('abc')
  })
})

describe('formatCount', () => {
  it('formats compact numbers for large values', () => {
    expect(formatCount(1500)).toMatch(/1\.5K|1,500/)
  })
})

function makePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: Array.from({ length: 7 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: 10 + i,
      sevenTvEmoteCount: 2,
      totalEmoteCount: 4 + i,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

describe('resolveMostReactedHeat', () => {
  const backendPeaks: ExtensionPeak[] = [
    {
      offsetSeconds: 120,
      score: 92,
      reasons: ['chat_spike'],
      reasonLabel: 'Chat spike',
      dominantSignal: 'chat',
      chatCount: 40,
      emoteCount: 3,
    },
  ]

  it('uses backend peaks when present', () => {
    const heat = resolveMostReactedHeat(makePayload({ peaks: backendPeaks }))
    expect(heat.visible).toBe(true)
    expect(heat.points[0]?.score).toBe(92)
    expect(heat.points[0]?.estimated).toBe(false)
  })

  it('returns warming when peaks field is an empty array', () => {
    const heat = resolveMostReactedHeat(makePayload({ peaks: [] }))
    expect(heat.visible).toBe(false)
    expect(heat.points).toEqual([])
  })

  it('falls back to deriveLiveHeat when peaks field is absent', () => {
    const heat = resolveMostReactedHeat(makePayload({ peaks: undefined }))
    expect(heat.visible).toBe(true)
    expect(heat.points.some(point => point.estimated)).toBe(true)
  })

  it('drops viewer-only peaks with zero chat and emotes', () => {
    const heat = resolveMostReactedHeat(
      makePayload({
        peaks: [
          {
            offsetSeconds: 2760,
            score: 57,
            reasons: ['viewer_spike'],
            reasonLabel: 'Viewer spike',
            dominantSignal: 'viewers',
            chatCount: 0,
            emoteCount: 0,
          },
          {
            offsetSeconds: 120,
            score: 38,
            reasons: ['seventv_spike'],
            reasonLabel: 'Emote spike',
            dominantSignal: 'seventv',
            chatCount: 680,
            emoteCount: 692,
          },
        ],
      }),
    )
    expect(heat.points).toHaveLength(1)
    expect(heat.points[0]?.reasonLabel).toBe('Emote spike')
  })

  it('enriches peak counts from rollups when backend sends zeros', () => {
    const heat = resolveMostReactedHeat(
      makePayload({
        rollups: [
          {
            offsetSeconds: 2760,
            chatCount: 410,
            sevenTvEmoteCount: 120,
            totalEmoteCount: 155,
            topEmotes: [{ name: 'KEKW', count: 40 }],
          },
        ],
        peaks: [
          {
            offsetSeconds: 2760,
            score: 57,
            reasons: ['chat_spike'],
            reasonLabel: 'Chat spike',
            dominantSignal: 'chat',
            chatCount: 0,
            emoteCount: 0,
          },
        ],
      }),
    )
    expect(heat.points[0]?.chatCount).toBe(410)
    expect(heat.points[0]?.emoteCount).toBe(155)
  })

  it('drops viewer spikes even when rollups enrich chat and emote counts', () => {
    const heat = resolveMostReactedHeat(
      makePayload({
        rollups: [
          {
            offsetSeconds: 2760,
            chatCount: 410,
            sevenTvEmoteCount: 120,
            totalEmoteCount: 155,
            topEmotes: [{ name: 'KEKW', count: 40 }],
          },
        ],
        peaks: [
          {
            offsetSeconds: 2760,
            score: 57,
            reasons: ['viewer_spike'],
            reasonLabel: 'Viewer spike',
            dominantSignal: 'viewers',
            chatCount: 0,
            emoteCount: 0,
          },
          {
            offsetSeconds: 120,
            score: 38,
            reasons: ['seventv_spike'],
            reasonLabel: 'Emote spike',
            dominantSignal: 'seventv',
            chatCount: 680,
            emoteCount: 692,
          },
        ],
      }),
    )
    expect(heat.points).toHaveLength(1)
    expect(heat.points[0]?.reasonLabel).toBe('Emote spike')
  })

  it('keeps only the strongest coarse candidate inside an adjacent live cooldown window', () => {
    const heat = resolveMostReactedHeat(
      makePayload({
        peaks: [
          { offsetSeconds: 0, score: 20, reactionScore: 20, reasons: ['chat_spike'], dominantSignal: 'chat', chatCount: 100, emoteCount: 4 },
          { offsetSeconds: 60, score: 48, reactionScore: 48, reasons: ['chat_spike'], dominantSignal: 'chat', chatCount: 300, emoteCount: 8 },
          { offsetSeconds: 120, score: 30, reactionScore: 30, reasons: ['emote_spike'], dominantSignal: 'emote', chatCount: 140, emoteCount: 50 },
        ],
      }),
    )
    expect(heat.points).toHaveLength(1)
    expect(heat.points[0]?.offsetSeconds).toBe(60)
  })

  it('preserves one exceptional candidate while a live stream is still warming', () => {
    const heat = resolveMostReactedHeat(
      makePayload({
        rollups: Array.from({ length: 3 }, (_, index) => ({
          offsetSeconds: index * 60,
          chatCount: 10,
          sevenTvEmoteCount: 2,
          totalEmoteCount: 4,
        })),
        peaks: [
          { offsetSeconds: 0, score: 9, reasons: ['chat_spike'], dominantSignal: 'chat', chatCount: 20, emoteCount: 2 },
          { offsetSeconds: 60, score: 31, reasons: ['chat_spike'], dominantSignal: 'chat', chatCount: 90, emoteCount: 8 },
        ],
      }),
    )
    expect(heat.points).toHaveLength(1)
    expect(heat.points[0]?.offsetSeconds).toBe(60)
  })
})

describe('reactionRankValue', () => {
  it('ranks chat spikes by chat count', () => {
    const point = {
      minuteTs: '',
      offsetSeconds: 120,
      score: 20,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 400,
      emoteCount: 50,
      topEmotes: [],
      collecting: false,
    }
    expect(reactionRankValue(point)).toBe(400)
  })

  it('ranks emote spikes by emote count', () => {
    const point = {
      minuteTs: '',
      offsetSeconds: 120,
      score: 20,
      estimated: false,
      reason: 'seventv_spike' as const,
      reasonLabel: 'Emote spike',
      chatCount: 400,
      emoteCount: 900,
      topEmotes: [],
      collecting: false,
    }
    expect(reactionRankValue(point)).toBe(900)
  })
})

describe('sortLiveHeatPoints', () => {
  const chatSpike = {
    minuteTs: '',
    offsetSeconds: 120,
    score: 20,
    estimated: false,
    reason: 'chat_spike' as const,
    reasonLabel: 'Chat spike',
    chatCount: 500,
    emoteCount: 10,
    topEmotes: [],
    collecting: false,
  }
  const emoteSpike = {
    minuteTs: '',
    offsetSeconds: 240,
    score: 19,
    estimated: false,
    reason: 'seventv_spike' as const,
    reasonLabel: 'Emote spike',
    chatCount: 100,
    emoteCount: 800,
    topEmotes: [],
    collecting: false,
  }

  it('sorts reaction mode by authoritative reaction score', () => {
    const sorted = sortLiveHeatPoints([chatSpike, emoteSpike], 'reaction')
    expect(sorted[0]?.reason).toBe('chat_spike')
  })

  it('prefers reactionScore over raw signal volume', () => {
    expect(authoritativeReactionScore({ ...chatSpike, reactionScore: 14 })).toBe(14)
    expect(authoritativeReactionScore({ ...emoteSpike, compositeScore: 27 })).toBe(27)
  })
})

describe('tied reaction scores', () => {
  // zackrawrr, 2026-10-18: the backend re-scores past minutes as the stream
  // grows, so the 02:02:55 moment drifted between 56 and 55 while the
  // 05:06:55 one, with twice the emotes, sat at 55.
  const leader: ExtensionPeak = {
    offsetSeconds: 7375,
    score: 56,
    reactionScore: 56,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 462,
    emoteCount: 214,
  }
  const tiedLeader: ExtensionPeak = { ...leader, score: 55, reactionScore: 55 }
  const runnerUp: ExtensionPeak = {
    offsetSeconds: 18415,
    score: 55,
    reactionScore: 55,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 703,
    emoteCount: 445,
  }

  function topMomentOffset(peaks: ExtensionPeak[]): number | undefined {
    const heat = resolveMostReactedHeat(makePayload({ peaks, currentOffsetSeconds: 19_000 }))
    return sortLiveHeatPoints(heat.points, 'reaction')[0]?.offsetSeconds
  }

  it('keeps the #1 moment when its score drifts into a tie', () => {
    expect(topMomentOffset([leader, runnerUp])).toBe(7375)
    expect(topMomentOffset([tiedLeader, runnerUp])).toBe(7375)
  })

  it('picks the same #1 whatever order tied moments arrive in', () => {
    expect(topMomentOffset([runnerUp, tiedLeader])).toBe(7375)
    expect(topMomentOffset([tiedLeader, runnerUp])).toBe(7375)
  })
})

describe('stream edges in Top moments', () => {
  // An hour-long stream: hello spam at 00:01, goodbye spam at 00:59, and a
  // smaller real moment at 00:30.
  const spike = (offsetSeconds: number, score: number): ExtensionPeak => ({
    offsetSeconds,
    score,
    reactionScore: score,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 400,
    emoteCount: 300,
  })
  const peaks = [spike(60, 99), spike(1800, 50), spike(3540, 98)]
  const rollups = Array.from({ length: 61 }, (_, i) => ({ offsetSeconds: i * 60, chatCount: 30, sevenTvEmoteCount: 2 }))

  function topMomentOffsets(payload: PulsePayload): number[] {
    const heat = resolveMostReactedHeat(payload)
    return sortLiveHeatPoints(heat.points, 'reaction').map(point => point.offsetSeconds)
  }

  it('ranks hello and goodbye spikes after the real moment once the stream ended', () => {
    const ended = makePayload({ isLive: false, endedAt: '2026-06-11T13:00:00.000Z', currentOffsetSeconds: 3600, rollups, peaks })
    expect(topMomentOffsets(ended)).toEqual([1800, 60, 3540])
  })

  it('ranks only the hello spike last while the stream is live', () => {
    const live = makePayload({ currentOffsetSeconds: 3600, rollups, peaks })
    expect(topMomentOffsets(live)).toEqual([3540, 1800, 60])
  })

  it('follows the backend flag over the offset', () => {
    const flagged = makePayload({ currentOffsetSeconds: 3600, rollups, peaks: [spike(1800, 50), { ...spike(2400, 90), streamEdge: 'closing' }] })
    expect(topMomentOffsets(flagged)).toEqual([1800, 2400])
  })

  it('keeps the chat and emote sorts by volume', () => {
    const ended = makePayload({ isLive: false, endedAt: '2026-06-11T13:00:00.000Z', currentOffsetSeconds: 3600, rollups, peaks })
    const heat = resolveMostReactedHeat(ended)
    expect(sortLiveHeatPoints(heat.points, 'chat')[0]?.streamEdge).toBe('opening')
  })
})

describe('exact moment identity', () => {
  const points = [
    {
      minuteTs: 'a',
      offsetSeconds: 120,
      score: 20,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 100,
      emoteCount: 10,
      topEmotes: [],
      collecting: false,
    },
    {
      minuteTs: 'b',
      offsetSeconds: 180,
      score: 30,
      estimated: false,
      reason: 'emote_spike' as const,
      reasonLabel: 'Emote spike',
      chatCount: 80,
      emoteCount: 40,
      topEmotes: [],
      collecting: false,
    },
  ]

  it('does not mark a nearby moment as selected through the old 90-second tolerance', () => {
    expect(heatPointMatchesExactOffset(points[0]!, 180)).toBe(false)
    expect(findExactHeatPointAtOffset(points, 180)).toBe(points[1])
  })

  it('prefers refined analytical onset over a coarse neighboring offset', () => {
    const refined = {
      ...points[0]!,
      reactionOnsetOffsetSeconds: 125,
      reactionApexOffsetSeconds: 128,
      precisionSeconds: 2,
      refinementStatus: 'refined',
    }
    const coarse = { ...points[1]!, offsetSeconds: 125 }
    expect(findExactHeatPointAtOffset([coarse, refined], 125)).toBe(refined)
  })
})

describe('selectedMomentKey', () => {
  it('preserves selection across refresh when peak still exists', () => {
    const point = {
      minuteTs: '',
      offsetSeconds: 120,
      score: 92,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 40,
      emoteCount: 3,
      topEmotes: [],
      collecting: false,
    }
    const key = selectedMomentKey('stream-1', point)
    expect(resolveSelectedMomentKey('stream-1', [point], key)).toBe(key)
    expect(resolveSelectedMomentKey('stream-1', [point], 'missing')).toBeNull()
    expect(resolveSelectedMomentKey('stream-1', [point], null)).toBeNull()
  })
})
