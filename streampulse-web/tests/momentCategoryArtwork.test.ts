import { afterEach, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request, getBackendUrl: () => 'https://api.example.test' }))
import {
  categorySegmentAt, categorySegments, exactCategoryArtwork, loadCategoryArtwork, loadCategorySegments, momentGameArtAt,
  momentGameArtUrl, resetCategoryArtwork,
} from '../src/lib/momentCategoryArtwork'

afterEach(() => { request.mockReset(); resetCategoryArtwork() })

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
it('sizes Twitch box art for the moment’s own category only', () => {
  expect(momentGameArtUrl({ categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg' }, 76, 100))
    .toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-76x100.jpg')
  expect(momentGameArtUrl({ categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-52x72.png' }, 285, 380))
    .toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-285x380.png')
  expect(momentGameArtUrl({ categoryId: '1', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg' }, 76, 100)).toBeNull()
  expect(momentGameArtUrl({ categoryId: '509658', boxArtUrl: 'https://example.com/ttv-boxart/509658-52x72.jpg' }, 76, 100)).toBeNull()
  expect(momentGameArtUrl({ categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg', categoryMetadataRejected: true }, 76, 100)).toBeNull()
  expect(momentGameArtUrl({ categoryId: '509658' }, 76, 100)).toBeNull()
  expect(momentGameArtUrl({ boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg' }, 76, 100)).toBeNull()
})

// A stream that changed games: Just Chatting, then a game whose cover is under Twitch's _IGDB name.
const games = [
  { id: 2, streamId: '9000001', gameName: 'Fake Game', categoryId: '1234567', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1234567_IGDB-210x280.jpg', offsetSeconds: 1800, durationSeconds: 5400, createdAt: '' },
  { id: 1, streamId: '9000001', gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', offsetSeconds: 0, durationSeconds: 1800, createdAt: '' },
]

it('reads a stream’s game segments in stream order, keeping a cover only when it is Twitch’s own for the segment', () => {
  expect(categorySegments([...games, { gameName: 'No id', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1-210x280.jpg', offsetSeconds: 7200, durationSeconds: 60 },
    { gameName: 'Wrong cover', categoryId: '42', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/43-210x280.jpg', offsetSeconds: 7260, durationSeconds: 60 },
    { gameName: '', categoryId: '1', offsetSeconds: 10 }, { gameName: 'No offset', categoryId: '1' }, null, 'text'])).toEqual([
    { gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', offsetSeconds: 0, durationSeconds: 1800 },
    { gameName: 'Fake Game', categoryId: '1234567', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1234567_IGDB-210x280.jpg', offsetSeconds: 1800, durationSeconds: 5400 },
    { gameName: 'No id', categoryId: null, boxArtUrl: null, offsetSeconds: 7200, durationSeconds: 60 },
    { gameName: 'Wrong cover', categoryId: '42', boxArtUrl: null, offsetSeconds: 7260, durationSeconds: 60 },
  ])
  expect(categorySegments({ items: games })).toEqual([])
})

it('finds the game at a point in the stream: the segment it falls in, else the last one it is past, else none', () => {
  const segments = categorySegments([
    { gameName: 'A', categoryId: '1', offsetSeconds: 100, durationSeconds: 100 },
    { gameName: 'B', categoryId: '2', offsetSeconds: 300, durationSeconds: 100 },
  ])
  expect(categorySegmentAt(segments, 50)).toBeNull()
  expect(categorySegmentAt(segments, 100)?.gameName).toBe('A')
  expect(categorySegmentAt(segments, 199)?.gameName).toBe('A')
  expect(categorySegmentAt(segments, 250)).toBeNull()
  expect(categorySegmentAt(segments, 300)?.gameName).toBe('B')
  // Past the last segment's end: the game the stream is still on.
  expect(categorySegmentAt(segments, 9000)?.gameName).toBe('B')
  expect(categorySegmentAt(segments, Number.NaN)).toBeNull()
  expect(categorySegmentAt([], 100)).toBeNull()
})

it('gives each Moment the cover of the game it was in, _IGDB covers too, sized; none without an exact cover', () => {
  const segments = categorySegments(games)
  expect(momentGameArtAt(segments, 600, 285, 380)).toEqual({ url: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg', gameName: 'Just Chatting' })
  expect(momentGameArtAt(segments, 2430, 285, 380)).toEqual({ url: 'https://static-cdn.jtvnw.net/ttv-boxart/1234567_IGDB-285x380.jpg', gameName: 'Fake Game' })
  const unknownCover = categorySegments([{ gameName: 'Fake Game', categoryId: '1234567', boxArtUrl: 'https://example.com/1234567.jpg', offsetSeconds: 0, durationSeconds: 60 }])
  expect(momentGameArtAt(unknownCover, 30, 285, 380)).toBeNull()
  expect(momentGameArtAt([], 30, 285, 380)).toBeNull()
})

it('reads a stream’s games once for its covers and its segments, and a failed read is no art', async () => {
  request.mockResolvedValueOnce({ data: games })
  const [segments, art] = await Promise.all([loadCategorySegments('9000001'), loadCategoryArtwork('9000001')])
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('/v1/portal/analytics/streams/9000001/games', { timeoutMs: 3500, maxResponseBytes: 262144, credentials: 'omit' })
  expect(segments.map(segment => segment.gameName)).toEqual(['Just Chatting', 'Fake Game'])
  expect(art.get('Fake Game')?.boxArtUrl).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1234567_IGDB-210x280.jpg')
  request.mockRejectedValueOnce(new Error('offline'))
  await expect(loadCategorySegments('9000002')).resolves.toEqual([])
  await expect(loadCategoryArtwork('9000002')).resolves.toEqual(new Map())
  expect(request).toHaveBeenCalledTimes(2)
})
