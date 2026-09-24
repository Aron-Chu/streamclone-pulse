import { apiClient, getBackendUrl } from './apiClient'

export type CategoryArtworkItem = { category?: string; categoryId?: string; boxArtUrl?: string; categoryMetadataRejected?: true; streamId?: string }
type CategoryArt = { categoryId: string; boxArtUrl: string }
const cache = new Map<string, { expires: number; work: Promise<Map<string, CategoryArt>> }>()

export function isExactCategoryBoxArt(value: string, id: string): boolean {
  if (!/^\d{1,20}$/.test(id)) return false
  try {
    const url = new URL(value)
    return url.origin === 'https://static-cdn.jtvnw.net' && !url.username && !url.password && !url.search && !url.hash
      && new RegExp(`^/ttv-boxart/${id}(?:_IGDB)?-\\d+x\\d+\\.(?:jpe?g|png|webp)$`, 'i').test(url.pathname)
  } catch { return false }
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

export function loadCategoryArtwork(streamId: string): Promise<Map<string, CategoryArt>> {
  const key = `${getBackendUrl()}|${streamId}`
  const found = cache.get(key)
  if (found && found.expires > Date.now()) return found.work
  // Cosmetic shared transport has its own deadline, not a component's lifetime.
  const entry = { expires: Date.now() + 600_000, work: Promise.resolve(new Map<string, CategoryArt>()) }
  entry.work = apiClient<unknown>(`/v1/portal/analytics/streams/${encodeURIComponent(streamId)}/games`, {
    timeoutMs: 3500, maxResponseBytes: 256 * 1024, credentials: 'omit',
  }).then(({ data }) => exactCategoryArtwork(data)).catch(() => {
    entry.expires = Date.now() + 60_000
    return new Map<string, CategoryArt>()
  })
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > 64) cache.delete(cache.keys().next().value!)
  return entry.work
}
