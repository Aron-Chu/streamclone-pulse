import { describe, expect, it } from 'vitest'
import { nextEmoteRevealCount } from '../src/ui/sevenTvEmoteReveal.ts'

describe('nextEmoteRevealCount', () => {
  it('says Show 3 more when 21 remain of a 24-emote catalog', () => {
    expect(nextEmoteRevealCount(24, 3)).toBe(3)
  })

  it('says Show 3 more again after the first page expands', () => {
    expect(nextEmoteRevealCount(24, 6)).toBe(3)
  })

  it('says the true remainder when fewer than a page are left', () => {
    expect(nextEmoteRevealCount(7, 6)).toBe(1)
  })

  it('returns 0 when everything is already visible', () => {
    expect(nextEmoteRevealCount(6, 6)).toBe(0)
  })
})
