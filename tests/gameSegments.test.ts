import { describe, expect, it } from 'vitest'
import {
  gameSegmentKey,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
} from '@streampulse/pulse-charts'

describe('gameSegmentKey tolerates undefined gameName', () => {
  it('builds a key from the empty name without throwing', () => {
    expect(() =>
      gameSegmentKey({ gameName: undefined as unknown as string, offsetSeconds: 5 }),
    ).not.toThrow()
    expect(gameSegmentKey({ gameName: undefined as unknown as string, offsetSeconds: 5 })).toBe(':5')
  })

  it('normalizes a real name to lowercase with offset', () => {
    expect(gameSegmentKey({ gameName: 'Just Chatting', offsetSeconds: 5 })).toBe(
      'just chatting:5',
    )
  })
})

describe('hasMeaningfulGameSegments tolerates undefined gameName', () => {
  it('returns false for a single unnamed segment without throwing', () => {
    expect(() =>
      hasMeaningfulGameSegments(
        [{ gameName: undefined as unknown as string, offsetSeconds: 0, durationSeconds: 10 }],
        600,
      ),
    ).not.toThrow()
    expect(
      hasMeaningfulGameSegments(
        [{ gameName: undefined as unknown as string, offsetSeconds: 0, durationSeconds: 10 }],
        600,
      ),
    ).toBe(false)
  })

  it('keeps multi-segment rows true even when the first is unnamed', () => {
    expect(
      hasMeaningfulGameSegments(
        [
          { gameName: undefined as unknown as string, offsetSeconds: 0, durationSeconds: 300 },
          { gameName: 'GTA', offsetSeconds: 300, durationSeconds: 300 },
        ],
        600,
      ),
    ).toBe(true)
  })
})

describe('normalizeGameSegments passes through an undefined name', () => {
  it('does not throw and keeps the segment', () => {
    const normalized = normalizeGameSegments(
      [{ gameName: undefined as unknown as string, offsetSeconds: 0, durationSeconds: 600 }],
      600,
    )
    expect(normalized).toHaveLength(1)
    expect(normalized[0]?.gameName).toBeUndefined()
  })
})