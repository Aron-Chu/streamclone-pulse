import { describe, expect, it } from 'vitest'
import { resolvePinnedMomentPoint } from '../src/ui/chartSelectedMoment.ts'

describe('resolvePinnedMomentPoint', () => {
  const heatPoints = [
    {
      minuteTs: '2026-01-01T00:02:00.000Z',
      offsetSeconds: 120,
      score: 80,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 200,
      emoteCount: 55,
      topEmotes: [],
      collecting: false,
    },
  ]

  it('returns matching heat point when pin aligns with a peak', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 125,
      heatPoints,
    })
    expect(point?.offsetSeconds).toBe(120)
    expect(point?.reasonLabel).toBe('Chat spike')
  })

  it('does not synthesize a locally scored moment when pin is off-peak', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 60,
      heatPoints: [],
    })
    expect(point).toBeNull()
  })

  it('returns null when unpinned', () => {
    expect(
      resolvePinnedMomentPoint({
        pinOffsetSeconds: null,
        heatPoints,
      }),
    ).toBeNull()
  })
})
