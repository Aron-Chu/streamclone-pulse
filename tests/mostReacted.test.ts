import { describe, expect, it } from 'vitest'
import type { ExtensionPeak } from '../src/shared/messages.ts'
import {
  formatCount,
  peakChatCount,
  peakEmoteCount,
  peakEmoteKey,
  peakReasonLabel,
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
