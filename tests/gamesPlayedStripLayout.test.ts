import { describe, expect, it } from 'vitest'
import {
  GAMES_PLAYED_ART_WIDTH_PX,
  GAMES_PLAYED_CHIP_MIN_WIDTH_PX,
  GAMES_PLAYED_HIT_TARGET_HEIGHT_PX,
  resolveGameArtCandidates,
  resolveGamesPlayedActivationKey,
  safeGameArtUrl,
} from '../src/ui/GamesPlayedStrip.tsx'

describe('GamesPlayedStrip equal chips', () => {
  it('keeps a stable portrait hit target for short late games', () => {
    expect(GAMES_PLAYED_CHIP_MIN_WIDTH_PX).toBe(52)
    expect(GAMES_PLAYED_ART_WIDTH_PX).toBe(46)
    expect(GAMES_PLAYED_HIT_TARGET_HEIGHT_PX).toBe(70)
  })

  it('accepts only official Twitch box art and keeps ordered candidates', () => {
    const official = 'https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-210x280.jpg'
    expect(safeGameArtUrl(official)).toBe(official)
    expect(safeGameArtUrl('https://evil.example/ttv-boxart/509658-144x192.jpg')).toBeNull()
    expect(safeGameArtUrl('https://static-cdn.jtvnw.net:8443/ttv-boxart/509658-144x192.jpg')).toBeNull()
    expect(resolveGameArtCandidates(undefined, '509658')).toEqual([
      'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg',
      'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.png',
      'https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-144x192.jpg',
    ])
  })

  it('resets game selection identity when stream activation changes', () => {
    expect(resolveGamesPlayedActivationKey('xqc|stream:one', 'old')).toBe('xqc|stream:one')
    expect(resolveGamesPlayedActivationKey(undefined, 'stream-two')).toBe('stream-two')
    expect(resolveGamesPlayedActivationKey(null, null)).toBeNull()
  })
})
