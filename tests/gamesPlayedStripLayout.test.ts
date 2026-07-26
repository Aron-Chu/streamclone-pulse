import { describe, expect, it } from 'vitest'
import { GAMES_PLAYED_CHIP_MIN_WIDTH_PX } from '../src/ui/GamesPlayedStrip.tsx'

describe('GamesPlayedStrip equal chips', () => {
  it('keeps a readable minimum chip width for short late games', () => {
    expect(GAMES_PLAYED_CHIP_MIN_WIDTH_PX).toBeGreaterThanOrEqual(96)
  })
})
