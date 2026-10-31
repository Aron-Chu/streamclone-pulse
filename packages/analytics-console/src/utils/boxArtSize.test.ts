import { describe, expect, it } from 'vitest'
import { boxArtAtSize } from './boxArtSize.ts'

describe('boxArtAtSize (candidate, 10-30, PIC-2)', () => {
  it("rewrites the size in Twitch's box-art URLs (live-games 2026-10-30)", () => {
    expect(boxArtAtSize('https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', 216, 288))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-216x288.jpg')
    expect(boxArtAtSize('https://static-cdn.jtvnw.net/ttv-boxart/33214_IGDB-285x380.jpg', 72, 96))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/33214_IGDB-72x96.jpg')
    expect(boxArtAtSize('https://static-cdn.jtvnw.net/ttv-boxart/Just%20Chatting-144x192.jpg', 30, 40))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/Just%20Chatting-30x40.jpg')
  })

  it('keeps a query string', () => {
    expect(boxArtAtSize('https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg?v=1', 144, 192))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg?v=1')
  })

  it('leaves every other URL alone', () => {
    for (const url of [
      'https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg',
      'https://static-cdn.jtvnw.net/ttv-boxart/509658.jpg',
      'https://static-cdn.jtvnw.net/previews-ttv/live_user_x-640x360.jpg',
      'http://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg',
      'https://example.com/ttv-boxart/509658-210x280.jpg',
      '',
    ]) {
      expect(boxArtAtSize(url, 72, 96)).toBe(url)
    }
  })

  it('leaves the URL alone for a size it cannot ask for', () => {
    const url = 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg'
    expect(boxArtAtSize(url, 0, 96)).toBe(url)
    expect(boxArtAtSize(url, Number.NaN, 96)).toBe(url)
  })
})
