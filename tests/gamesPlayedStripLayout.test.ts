import { describe, expect, it } from 'vitest'
import {
  GAMES_PLAYED_CHIP_WIDTH_PX,
  GAMES_PLAYED_ART_WIDTH_PX,
  GAMES_PLAYED_HIT_TARGET_PX,
  GAMES_PLAYED_HIT_TARGET_HEIGHT_PX,
  GAMES_PLAYED_ICON_SIZE_PX,
  initialsForGame,
  resolveGameArtUrl,
  resolveGamesPlayedScrollState,
  safeGameArtUrl,
} from '../src/ui/GamesPlayedStrip.tsx'

describe('GamesPlayedStrip compact icons', () => {
  it('uses a compact fixed icon size so many games fit before scrolling', () => {
    expect(GAMES_PLAYED_CHIP_WIDTH_PX).toBe(GAMES_PLAYED_HIT_TARGET_PX)
    expect(GAMES_PLAYED_ICON_SIZE_PX).toBeGreaterThanOrEqual(48)
    expect(GAMES_PLAYED_ICON_SIZE_PX).toBeLessThanOrEqual(72)
    expect(GAMES_PLAYED_HIT_TARGET_PX).toBeGreaterThanOrEqual(44)
    expect(GAMES_PLAYED_HIT_TARGET_HEIGHT_PX).toBeGreaterThan(GAMES_PLAYED_HIT_TARGET_PX)
    expect(GAMES_PLAYED_ART_WIDTH_PX).toBeLessThan(GAMES_PLAYED_ICON_SIZE_PX)
    expect(GAMES_PLAYED_ART_WIDTH_PX / GAMES_PLAYED_ICON_SIZE_PX).toBeCloseTo(52 / 72, 1)
  })

  it('keeps fallback artwork deterministic and accepts only Twitch HTTPS assets', () => {
    expect(initialsForGame('Just Chatting')).toBe('JC')
    expect(initialsForGame('Minecraft')).toBe('MI')
    expect(initialsForGame('  ')).toBe('?')
    expect(initialsForGame('Just Chatting')).toBe(initialsForGame('Just Chatting'))
    expect(safeGameArtUrl('https://static-cdn.jtvnw.net/ttv-boxart/1-285x380.jpg')).toContain('static-cdn')
    expect(safeGameArtUrl('https://images.example.test/box.jpg')).toBeNull()
    expect(safeGameArtUrl('http://static-cdn.jtvnw.net/box.jpg')).toBeNull()
    expect(resolveGameArtUrl(undefined, '509658')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg')
    expect(resolveGameArtUrl(undefined, 'not-a-category')).toBeNull()
  })

  it('keeps fractional scroll boundaries stable without rounding away real movement', () => {
    const start = resolveGamesPlayedScrollState(0, 200.5, 100.25, 6)
    expect(start.maxScroll).toBeCloseTo(100.25)
    expect(start.canScrollLeft).toBe(false)
    expect(start.canScrollRight).toBe(true)
    expect(start.hiddenAhead).toBeGreaterThan(0)
    expect(start.visibleStart).toBe(0)
    expect(start.visibleEnd).toBe(1)

    const fractional = resolveGamesPlayedScrollState(0.75, 200.5, 100.25, 6)
    expect(fractional.canScrollLeft).toBe(true)
    expect(fractional.canScrollRight).toBe(true)

    const end = resolveGamesPlayedScrollState(100.25, 200.5, 100.25, 6)
    expect(end.canScrollLeft).toBe(true)
    expect(end.canScrollRight).toBe(false)
    expect(end.hiddenAhead).toBe(0)
    expect(end.visibleEnd).toBe(6)
  })
})
