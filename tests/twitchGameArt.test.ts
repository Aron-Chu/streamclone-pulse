import { describe, expect, it } from 'vitest'
import {
  categoryBoxArtCandidates,
  extractTwitchDirectoryBoxArt,
  normalizeTwitchBoxArt,
  twitchCategorySlug,
} from '../src/ui/twitchGameArt.ts'

describe('Twitch game art', () => {
  it('normalizes trusted Twitch art to the compact portrait size', () => {
    expect(normalizeTwitchBoxArt('https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg'))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg')
    expect(normalizeTwitchBoxArt('https://evil.example/ttv-boxart/509658-285x380.jpg')).toBeNull()
    expect(normalizeTwitchBoxArt('https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg')).toBeNull()
  })

  it('builds deterministic category candidates and Twitch directory slugs', () => {
    expect(categoryBoxArtCandidates('509658')).toEqual([
      'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg',
      'https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-144x192.jpg',
    ])
    expect(twitchCategorySlug('Just Chatting & Friends')).toBe('just-chatting-and-friends')
  })

  it('extracts strict CDN artwork from Twitch directory metadata', () => {
    const html = '<meta property="og:image" content="https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg">'
    expect(extractTwitchDirectoryBoxArt(html))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg')
  })
})
