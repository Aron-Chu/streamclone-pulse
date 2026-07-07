import { describe, expect, it } from 'vitest'
import { lerpScalar } from '../src/ui/motion/useSmoothedScalar.ts'

describe('lerpScalar', () => {
  it('moves toward the target by alpha', () => {
    expect(lerpScalar(0, 100, 0.35)).toBe(35)
    expect(lerpScalar(10, 20, 0.5)).toBe(15)
  })

  it('returns target when already equal', () => {
    expect(lerpScalar(42, 42, 0.35)).toBe(42)
  })
})
