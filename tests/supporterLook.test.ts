import { describe, expect, it } from 'vitest'
import { lookExtrasOf, lookName, lookStorage, normalizeSupporterLooks, STARTER_LOOKS } from '../src/shared/supporterLook.ts'

describe('what equipping a look stores', () => {
  const banner = { mode: 'off', intensity: 35, title: 'My panel' } as const

  it('keeps an older wave and sheen when only the backdrop changes, so the chat wave is not rewritten', () => {
    const paint = { wave: 'ripple', sheen: 'glint' } as const
    expect(lookStorage({ motion: 'shimmer', backdrop: true, intensity: 40 }, paint, banner)).toEqual({
      paint, banner: { mode: 'rain', intensity: 40, title: 'My panel' },
    })
  })

  it('keeps how a backdrop already moves while the motion is unchanged', () => {
    const paint = { wave: 'ripple', sheen: 'none' } as const
    expect(lookStorage({ motion: 'still', backdrop: true, intensity: 50 }, paint, { ...banner, mode: 'rain' })).toEqual({
      paint, banner: { mode: 'rain', intensity: 50, title: 'My panel' },
    })
  })

  it('writes the chosen motion and moves the backdrop with it once the motion changes', () => {
    expect(lookStorage({ motion: 'still', backdrop: true, intensity: 30 }, { wave: 'ripple', sheen: 'glint' }, { ...banner, mode: 'rain' })).toEqual({
      paint: { wave: 'smooth', sheen: 'none' }, banner: { mode: 'still', intensity: 30, title: 'My panel' },
    })
    expect(lookStorage({ motion: 'drift', backdrop: false, intensity: 30 }, { wave: 'smooth', sheen: 'none' }, { ...banner, mode: 'still' })).toEqual({
      paint: { wave: 'aurora', sheen: 'glint' }, banner: { mode: 'off', intensity: 30, title: 'My panel' },
    })
  })
})

describe('a look carried in a message or a saved choice', () => {
  it('accepts exactly a motion, a backdrop switch and a whole intensity in range', () => {
    expect(lookExtrasOf({ motion: 'still', backdrop: true, intensity: 30 })).toEqual({ motion: 'still', backdrop: true, intensity: 30 })
    expect(lookExtrasOf({ motion: 'drift', backdrop: false, intensity: 70 })).toEqual({ motion: 'drift', backdrop: false, intensity: 70 })
    for (const invalid of [
      null, [], 'still', { motion: 'still', backdrop: true }, { motion: 'still', backdrop: true, intensity: 30, title: 'x' },
      { motion: 'sparkle', backdrop: true, intensity: 30 }, { motion: 'still', backdrop: 'yes', intensity: 30 },
      { motion: 'still', backdrop: true, intensity: 9 }, { motion: 'still', backdrop: true, intensity: 71 },
      { motion: 'still', backdrop: true, intensity: 32.5 }, { motion: 'still', backdrop: true, intensity: '30' },
    ]) expect(lookExtrasOf(invalid), JSON.stringify(invalid)).toBeNull()
  })
})

describe('saved look names', () => {
  it('names every look differently, so the shelf and its Remove buttons can tell them apart', () => {
    const at = (intensity: number) => ({ finish: 'glass' as const, motion: 'shimmer' as const, backdrop: true, intensity })
    expect(lookName(at(40))).toBe('Glass · Shimmer · backdrop 40%')
    expect(lookName(at(45))).toBe('Glass · Shimmer · backdrop 45%')
    expect(lookName({ finish: null, motion: 'drift', backdrop: false, intensity: 35 })).toBe('Default · Drift · no backdrop')
    expect(lookName(STARTER_LOOKS[2].look)).toBe('Bloom')
  })

  it('keeps starters off the saved shelf, since they are always shown', () => {
    const custom = { finish: 'glass', motion: 'still', backdrop: true, intensity: 45 }
    expect(normalizeSupporterLooks([STARTER_LOOKS[0].look, custom, custom])).toEqual([custom])
  })
})
