import { describe, expect, it } from 'vitest'
import type { ExtensionPeak } from '../src/shared/messages.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import {
  formatCount,
  peakChatCount,
  peakEmoteCount,
  peakEmoteKey,
  peakReasonLabel,
  resolveMostReactedHeat,
  resolveSelectedMomentKey,
  reactionRankValue,
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

  it('sorts reaction mode by dominant signal', () => {
    const sorted = sortLiveHeatPoints([chatSpike, emoteSpike], 'reaction')
    expect(sorted[0]?.reason).toBe('seventv_spike')
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
