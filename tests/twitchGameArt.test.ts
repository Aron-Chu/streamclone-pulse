import { describe, expect, it, vi } from 'vitest'
import {
  extractTwitchDirectoryBoxArt,
  fetchTwitchDirectoryBoxArt,
  normalizeTwitchDirectoryBoxArt,
  twitchCategorySlug,
} from '../src/ui/twitchGameArt.ts'

describe('Twitch category artwork', () => {
  it('builds Twitch directory slugs from game names', () => {
    expect(twitchCategorySlug('YRG Cobbleverse')).toBe('yrg-cobbleverse')
    expect(twitchCategorySlug('Games & Demos')).toBe('games-and-demos')
    expect(twitchCategorySlug('  ')).toBeNull()
  })

  it('extracts only numeric Twitch box-art assets and normalizes their size', () => {
    const html = '<meta property="og:image" content="https://static-cdn.jtvnw.net/ttv-boxart/676802825_IGDB-272x380.jpg">'
    expect(extractTwitchDirectoryBoxArt(html)).toBe(
      'https://static-cdn.jtvnw.net/ttv-boxart/676802825_IGDB-144x192.jpg',
    )
    expect(normalizeTwitchDirectoryBoxArt('https://images.example.test/game.jpg')).toBeNull()
    expect(normalizeTwitchDirectoryBoxArt('https://static-cdn.jtvnw.net/ttv-boxart/Big%20Walk-144x192.jpg')).toBeNull()
  })

  it('resolves the directory page once and returns the real cover', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      '<meta property="og:image" content="https://static-cdn.jtvnw.net/ttv-boxart/1239092847-272x380.jpg">',
      { status: 200 },
    ))
    await expect(fetchTwitchDirectoryBoxArt('YRG Cobbleverse', {
      fetchImpl: fetchImpl as typeof fetch,
      origin: 'https://www.twitch.tv',
    })).resolves.toBe('https://static-cdn.jtvnw.net/ttv-boxart/1239092847-144x192.jpg')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.twitch.tv/directory/category/yrg-cobbleverse',
      expect.objectContaining({ cache: 'force-cache', credentials: 'same-origin' }),
    )
  })
})

