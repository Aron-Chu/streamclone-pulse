import { describe, expect, it } from 'vitest'
import { resolveActivityLaneFractions } from '../src/ui/activityLaneFractions.ts'

describe('resolveActivityLaneFractions', () => {
  it('uses a 2-lane chat/emote split when collapsed without overlays', () => {
    expect(
      resolveActivityLaneFractions({ expanded: false, hasOverlays: false }),
    ).toEqual({ chat: 0.55, emote: 0.45, trace: 0 })
  })

  it('gives emotes a slight bias when expanded without overlays', () => {
    expect(
      resolveActivityLaneFractions({ expanded: true, hasOverlays: false }),
    ).toEqual({ chat: 0.48, emote: 0.52, trace: 0 })
  })

  it('reserves an overlay sub-band when collapsed with overlays', () => {
    expect(
      resolveActivityLaneFractions({ expanded: false, hasOverlays: true }),
    ).toEqual({ chat: 0.48, emote: 0.34, trace: 0.18 })
  })

  it('grows the overlay sub-band when expanded with overlays', () => {
    expect(
      resolveActivityLaneFractions({ expanded: true, hasOverlays: true }),
    ).toEqual({ chat: 0.36, emote: 0.3, trace: 0.34 })
  })

  it('boosts the focused lane only while expanded', () => {
    const focused = resolveActivityLaneFractions({
      expanded: true,
      hasOverlays: false,
      focusedKey: 'chat',
    })
    expect(focused.chat).toBe(0.78)
    expect(focused.emote).toBeCloseTo(0.22)
    expect(focused.trace).toBe(0)

    const collapsed = resolveActivityLaneFractions({
      expanded: false,
      hasOverlays: false,
      focusedKey: 'chat',
    })
    expect(collapsed).toEqual({ chat: 0.55, emote: 0.45, trace: 0 })
  })

  it('sums to 1 for every table cell', () => {
    for (const expanded of [false, true]) {
      for (const hasOverlays of [false, true]) {
        const fractions = resolveActivityLaneFractions({ expanded, hasOverlays })
        expect(fractions.chat + fractions.emote + fractions.trace).toBeCloseTo(1)
      }
    }
  })
})
