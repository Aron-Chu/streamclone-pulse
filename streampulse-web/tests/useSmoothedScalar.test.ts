import { describe, expect, it } from 'vitest'
import { lerpScalar } from '../src/ui/motion/useSmoothedScalar'

describe('lerpScalar', () => {
  it('moves toward the target by alpha fraction', () => {
    expect(lerpScalar(0, 100, 0.35)).toBeCloseTo(35, 5)
    expect(lerpScalar(35, 100, 0.35)).toBeCloseTo(57.75, 5)
  })

  it('returns target when already at target', () => {
    expect(lerpScalar(50, 50, 0.35)).toBe(50)
  })

  it('converges within repeated steps', () => {
    let value = 0
    const target = 80
    for (let i = 0; i < 24; i += 1) {
      value = lerpScalar(value, target, 0.35)
    }
    expect(Math.abs(value - target)).toBeLessThan(0.05)
  })
})
