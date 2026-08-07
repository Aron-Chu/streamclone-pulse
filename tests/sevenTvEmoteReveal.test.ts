import { describe, expect, it } from 'vitest'
import {
  EMOTE_PICKER_PAGE_SIZE,
  nextEmoteRevealCount,
} from '../src/ui/sevenTvEmoteReveal.ts'

describe('nextEmoteRevealCount', () => {
  it('starts with six visible emotes', () => {
    expect(EMOTE_PICKER_PAGE_SIZE).toBe(6)
  })

  it('reveals six more when a full page remains', () => {
    expect(nextEmoteRevealCount(24, 6)).toBe(6)
  })

  it('says the true remainder when fewer than a page are left', () => {
    expect(nextEmoteRevealCount(10, 6)).toBe(4)
  })

  it('returns 0 when everything is already visible', () => {
    expect(nextEmoteRevealCount(6, 6)).toBe(0)
  })
})
