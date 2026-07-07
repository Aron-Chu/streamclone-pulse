import { describe, expect, it } from 'vitest'
import { mergePulsePayload } from '../src/background/pulsePayloadMerge.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

function basePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'xqc',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 3600,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

describe('mergePulsePayload', () => {
  it('returns incoming when there is no previous payload', () => {
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
    })
    expect(mergePulsePayload(null, incoming)).toEqual(incoming)
  })

  it('keeps fullRollups when a recent poll returns fewer points', () => {
    const previous = basePayload({
      rollups: [
        { offsetSeconds: 3480, chatCount: 20, sevenTvEmoteCount: 2 },
        { offsetSeconds: 3540, chatCount: 40, sevenTvEmoteCount: 5 },
      ],
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1, sevenTvEmoteCount: 0 },
        { offsetSeconds: 3540, chatCount: 40, sevenTvEmoteCount: 5 },
      ],
      coverage: {
        state: 'live',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 3540,
        hasFullStreamCoverage: true,
        hasGaps: false,
        canBackfill: false,
        message: 'ok',
      },
    })
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 3540, chatCount: 55, sevenTvEmoteCount: 8 }],
      peaks: [{ offsetSeconds: 3540, score: 12, reasons: ['chat_spike'], dominantSignal: 'chat' }],
    })

    const merged = mergePulsePayload(previous, incoming)
    expect(merged.fullRollups).toHaveLength(2)
    expect(merged.rollups).toHaveLength(2)
    expect(merged.rollups[1]?.chatCount).toBe(55)
    expect(merged.coverage?.hasFullStreamCoverage).toBe(true)
  })

  it('keeps games when a recent poll omits them', () => {
    const previous = basePayload({
      games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }],
    })
    const incoming = basePayload({
      rollups: [{ offsetSeconds: 60, chatCount: 10, sevenTvEmoteCount: 2 }],
    })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged.games).toHaveLength(1)
    expect(merged.games?.[0]?.gameName).toBe('Just Chatting')
  })

  it('merges partial games by segment key and keeps richer lists', () => {
    const previous = basePayload({
      games: [
        { gameName: 'A', offsetSeconds: 0, durationSeconds: 600 },
        { gameName: 'B', offsetSeconds: 600, durationSeconds: 600 },
        { gameName: 'C', offsetSeconds: 1200, durationSeconds: 600 },
      ],
    })
    const incoming = basePayload({
      games: [
        { gameName: 'A', offsetSeconds: 0, durationSeconds: 900 },
        { gameName: 'B', offsetSeconds: 600, durationSeconds: 300 },
      ],
    })
    const merged = mergePulsePayload(previous, incoming)
    expect(merged.games).toHaveLength(3)
    expect(merged.games?.find(game => game.gameName === 'A')?.durationSeconds).toBe(900)
    expect(merged.games?.find(game => game.gameName === 'C')?.offsetSeconds).toBe(1200)
  })
})
