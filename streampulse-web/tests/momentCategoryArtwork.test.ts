import { expect, it } from 'vitest'
import { exactCategoryArtwork } from '../src/lib/momentCategoryArtwork'

it('accepts exact category identity and rejects unrelated or unsafe imagery', () => {
  const valid = { gameName: 'New category', categoryId: '123', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/123_IGDB-210x280.jpg' }
  const rows = exactCategoryArtwork([valid, { ...valid, gameName: 'Wrong ID', categoryId: '456' }, { ...valid, gameName: 'Wrong host', boxArtUrl: 'https://example.com/123.jpg' }, null])
  expect([...rows.keys()]).toEqual(['New category'])
  expect(rows.get('New category')?.boxArtUrl).toBe(valid.boxArtUrl)
})
it('does not choose between conflicting exact IDs for one category name', () => {
  expect(exactCategoryArtwork([
    { gameName: 'Shared', categoryId: '1', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1-144x192.jpg' },
    { gameName: 'Shared', categoryId: '2', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/2-144x192.jpg' },
  ]).size).toBe(0)
})
