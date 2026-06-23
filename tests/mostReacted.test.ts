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
  selectedMomentKey,
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
    expect(peakReasonLabel(peak)).toBe('7TV emote spike')
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
