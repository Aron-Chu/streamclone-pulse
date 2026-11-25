import { apiClient, getBackendUrl } from './apiClient'

export type CategoryArtworkItem = { category?: string; categoryId?: string; boxArtUrl?: string; categoryMetadataRejected?: true; streamId?: string }
type CategoryArt = { categoryId: string; boxArtUrl: string }
/**
 * One game segment of a stream, from its /games answer: the game, where it starts and how long it ran
 * (seconds into the stream), and its cover when that is Twitch's own for the segment's category id.
 */
export type CategorySegment = { gameName: string; offsetSeconds: number; durationSeconds: number; categoryId: string | null; boxArtUrl: string | null }
type StreamGames = { art: Map<string, CategoryArt>; segments: CategorySegment[] }
const cache = new Map<string, { expires: number; work: Promise<StreamGames> }>()

export function isExactCategoryBoxArt(value: string, id: string): boolean {
  if (!/^\d{1,20}$/.test(id)) return false
  try {
    const url = new URL(value)
    return url.origin === 'https://static-cdn.jtvnw.net' && !url.username && !url.password && !url.search && !url.hash
      && new RegExp(`^/ttv-boxart/${id}(?:_IGDB)?-\\d+x\\d+\\.(?:jpe?g|png|webp)$`, 'i').test(url.pathname)
  } catch { return false }
}

/** The moment's game cover at a size: only Twitch's own box art for the moment's category id, else null. */
export function momentGameArtUrl(moment: { boxArtUrl?: string; categoryId?: string; categoryMetadataRejected?: true }, width: number, height: number): string | null {
  if (!moment.boxArtUrl || !moment.categoryId || moment.categoryMetadataRejected) return null
  const sized = moment.boxArtUrl.replace(/-(?:\d+|\{width\})x(?:\d+|\{height\})\.(jpe?g|png|webp)$/i, `-${width}x${height}.$1`)
  return isExactCategoryBoxArt(sized, moment.categoryId) ? sized : null
}

export function exactCategoryArtwork(body: unknown): Map<string, CategoryArt> {
  const result = new Map<string, CategoryArt>()
  const conflicts = new Set<string>()
  if (!Array.isArray(body)) return result
  for (const row of body.slice(0, 1000)) {
    if (!row || typeof row.gameName !== 'string' || typeof row.categoryId !== 'string' || typeof row.boxArtUrl !== 'string' || !isExactCategoryBoxArt(row.boxArtUrl, row.categoryId)) continue
    const old = result.get(row.gameName)
    if (old && old.categoryId !== row.categoryId) conflicts.add(row.gameName)
    result.set(row.gameName, { categoryId: row.categoryId, boxArtUrl: row.boxArtUrl })
  }
  conflicts.forEach(name => result.delete(name))
  return result
}

/** The answer's game segments in stream order; a cover is kept only when it is Twitch's own for the segment's category id. */
export function categorySegments(body: unknown): CategorySegment[] {
  if (!Array.isArray(body)) return []
  const segments: CategorySegment[] = []
  for (const row of body.slice(0, 1000)) {
    if (!row || typeof row !== 'object') continue
    const { gameName, offsetSeconds, durationSeconds, categoryId, boxArtUrl } = row as Record<string, unknown>
    if (typeof gameName !== 'string' || !gameName.trim() || typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) continue
    const id = typeof categoryId === 'string' && /^\d{1,20}$/.test(categoryId) ? categoryId : null
    segments.push({
      gameName, offsetSeconds,
      durationSeconds: typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
      categoryId: id,
      boxArtUrl: id && typeof boxArtUrl === 'string' && isExactCategoryBoxArt(boxArtUrl, id) ? boxArtUrl : null,
    })
  }
  return segments.sort((a, b) => a.offsetSeconds - b.offsetSeconds)
}

/**
 * The segment a point `offsetSeconds` into the stream falls in, else the last one when the point is past
 * its start (the game a stream is still on), else null: a point before or between segments has no game.
 */
export function categorySegmentAt(segments: readonly CategorySegment[], offsetSeconds: number): CategorySegment | null {
  if (!Number.isFinite(offsetSeconds)) return null
  const within = segments.find(segment => offsetSeconds >= segment.offsetSeconds && offsetSeconds < segment.offsetSeconds + segment.durationSeconds)
  if (within) return within
  const last = segments[segments.length - 1]
  return last && offsetSeconds >= last.offsetSeconds ? last : null
}

/**
 * A Moment's game art at a size: Twitch's own cover for the game the stream was on at `offsetSeconds`,
 * with that game's name. Null when that game, or its exact cover, is not known.
 */
export function momentGameArtAt(segments: readonly CategorySegment[], offsetSeconds: number, width: number, height: number): { url: string; gameName: string } | null {
  const segment = categorySegmentAt(segments, offsetSeconds)
  if (!segment?.categoryId || !segment.boxArtUrl) return null
  const url = momentGameArtUrl({ categoryId: segment.categoryId, boxArtUrl: segment.boxArtUrl }, width, height)
  return url ? { url, gameName: segment.gameName } : null
}

/** The stream's /games answer, read once for every caller and kept ten minutes (a failed read, one minute). */
function loadStreamGames(streamId: string): Promise<StreamGames> {
  const key = `${getBackendUrl()}|${streamId}`
  const found = cache.get(key)
  if (found && found.expires > Date.now()) return found.work
  // Cosmetic shared transport has its own deadline, not a component's lifetime.
  const entry: { expires: number; work: Promise<StreamGames> } = { expires: Date.now() + 600_000, work: Promise.resolve({ art: new Map(), segments: [] }) }
  entry.work = apiClient<unknown>(`/v1/portal/analytics/streams/${encodeURIComponent(streamId)}/games`, {
    timeoutMs: 3500, maxResponseBytes: 256 * 1024, credentials: 'omit',
  }).then(({ data }): StreamGames => ({ art: exactCategoryArtwork(data), segments: categorySegments(data) })).catch((): StreamGames => {
    entry.expires = Date.now() + 60_000
    return { art: new Map(), segments: [] }
  })
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > 64) cache.delete(cache.keys().next().value!)
  return entry.work
}

export function loadCategoryArtwork(streamId: string): Promise<Map<string, CategoryArt>> {
  return loadStreamGames(streamId).then(games => games.art)
}

/** The stream's game segments (categorySegments), from the same read as its covers. Empty when the read failed. */
export function loadCategorySegments(streamId: string): Promise<CategorySegment[]> {
  return loadStreamGames(streamId).then(games => games.segments)
}

/** Tests only. */
export function resetCategoryArtwork(): void {
  cache.clear()
}
