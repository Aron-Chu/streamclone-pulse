import { describe, expect, it } from 'vitest'
import { lerpScalar } from '../../../twitch-7tv-clone/packages/analytics-console/src/motion/useSmoothedScalar.ts'
import { lerpActivityLayout } from '../../../twitch-7tv-clone/packages/analytics-console/src/utils/emotePlotSelection.ts'

describe('lerpScalar', () => {
  it('steps toward target with alpha', () => {
    expect(lerpScalar(0, 100, 0.5)).toBe(50)
    expect(lerpScalar(50, 100, 0.5)).toBe(75)
  })

  it('converges near target after repeated steps', () => {
    let current = 0
    const target = 240
    for (let i = 0; i < 24; i += 1) {
      current = lerpScalar(current, target, 0.35)
    }
    expect(Math.abs(current - target)).toBeLessThan(0.05)
  })
})

describe('lerpActivityLayout', () => {
  it('returns collapsed layout at progress 0', () => {
    const collapsed = lerpActivityLayout(0)
    const expanded = lerpActivityLayout(1)
    expect(collapsed.zoneFraction).toBeLessThan(expanded.zoneFraction)
    expect(collapsed.chat).toBeGreaterThan(expanded.chat)
  })

  it('interpolates midpoints at progress 0.5', () => {
    const half = lerpActivityLayout(0.5)
    const collapsed = lerpActivityLayout(0)
    const expanded = lerpActivityLayout(1)
    expect(half.zoneFraction).toBeCloseTo(
      (collapsed.zoneFraction + expanded.zoneFraction) / 2,
      5,
    )
    expect(half.chat).toBeCloseTo((collapsed.chat + expanded.chat) / 2, 5)
  })

  it('widens trace rail when emotes are plotted', () => {
    const plotted = lerpActivityLayout(0, true)
    const base = lerpActivityLayout(0, false)
    expect(plotted.trace).toBeGreaterThan(base.trace)
  })

  it('clamps progress outside 0..1', () => {
    const clampedLow = lerpActivityLayout(-1)
    const atZero = lerpActivityLayout(0)
    const clampedHigh = lerpActivityLayout(2)
    const atOne = lerpActivityLayout(1)
    expect(clampedLow).toEqual(atZero)
    expect(clampedHigh).toEqual(atOne)
  })
})
