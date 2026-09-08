import { useEffect, useState } from 'react'
import { apiClient, getBackendUrl } from './momentsApiClient'

export type CategoryArtworkInput = { categoryId?: string; name?: string }
export type CategoryArtworkResult = { status: 'resolved' | 'not_found' | 'unavailable'; categoryId?: string; name?: string; boxArtUrl?: string; matchedBy?: 'id' | 'name' }
export type CategoryArtworkMap = ReadonlyMap<string, CategoryArtworkResult>
export const categoryArtworkKey = (item: CategoryArtworkInput) => item.categoryId ? `id:${item.categoryId}` : `name:${item.name}`
const cache = new Map<string, { value: CategoryArtworkResult; expires: number }>()
const unavailable: CategoryArtworkResult = { status: 'unavailable' }

export function isExactCategoryBoxArt(value: string, id: string): boolean {
  if (!/^\d{1,20}$/.test(id) || id === '404') return false
  try {
    const url = new URL(value)
    return url.origin === 'https://static-cdn.jtvnw.net' && !url.username && !url.password && !url.search && !url.hash
      && !value.includes('?') && !value.includes('#')
      && new RegExp(`^/ttv-boxart/${id}(?:_IGDB)?-[1-9][0-9]{0,3}x[1-9][0-9]{0,3}\\.(?:jpe?g|png|webp)$`, 'i').test(url.pathname)
  } catch { return false }
}
function validInput(item: CategoryArtworkInput) {
  return (!item.categoryId || /^\d{1,20}$/.test(item.categoryId))
    && Boolean(item.categoryId || item.name?.trim())
    && (!item.name || (new TextEncoder().encode(item.name).length <= 200 && !/[\u0000-\u001f\u007f-\u009f]|:\/\//.test(item.name)))
}
function validateResult(raw: unknown, input: CategoryArtworkInput): CategoryArtworkResult {
  if (!raw || typeof raw !== 'object') return unavailable
  const row = raw as Record<string, unknown>
  if (row.status === 'not_found' || row.status === 'unavailable') return { status: row.status }
  if (row.status !== 'resolved' || typeof row.categoryId !== 'string' || typeof row.name !== 'string'
    || !row.name.trim() || !validInput({ name: row.name }) || typeof row.boxArtUrl !== 'string'
    || !isExactCategoryBoxArt(row.boxArtUrl, row.categoryId)
    || (input.categoryId ? row.matchedBy !== 'id' || row.categoryId !== input.categoryId : row.matchedBy !== 'name' || row.name !== input.name)) return unavailable
  return { status: 'resolved', categoryId: row.categoryId, name: row.name, boxArtUrl: row.boxArtUrl, matchedBy: row.matchedBy as 'id' | 'name' }
}
const pause = (signal: AbortSignal) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
  const timer = setTimeout(done, 2100)
  signal.addEventListener('abort', done, { once: true })
  if (signal.aborted) done()
})

/** Catalogue presentation only: never merge this map into detection or Saved records. */
export async function loadCategoryArtwork(inputs: readonly CategoryArtworkInput[], signal: AbortSignal,
  onBatch?: (map: CategoryArtworkMap) => void): Promise<CategoryArtworkMap> {
  const output = new Map<string, CategoryArtworkResult>()
  const origin = getBackendUrl()
  const unique = [...new Map(inputs.filter(validInput).map(item => [categoryArtworkKey(item), item])).values()].slice(0, 1000)
  const missing: CategoryArtworkInput[] = []
  for (const item of unique) {
    const key = categoryArtworkKey(item), cached = cache.get(`${origin}:${key}`)
    if (cached && cached.expires > Date.now()) output.set(key, cached.value)
    else missing.push(item)
  }
  if (!signal.aborted) onBatch?.(new Map(output))
  for (let offset = 0; offset < missing.length && !signal.aborted;) {
    if (offset) await pause(signal)
    if (signal.aborted) break
    const batch = missing.slice(offset, offset + 50)
    while (new TextEncoder().encode(JSON.stringify({ items: batch })).length > 16 * 1024) batch.pop()
    offset += batch.length
    let rows: unknown[] = []
    try {
      const { data } = await apiClient<{ items?: unknown[] }>('/v1/public/categories/artwork', {
        method: 'POST', body: { items: batch }, signal, timeoutMs: 12_000, maxResponseBytes: 64 * 1024, credentials: 'omit', redirect: 'error',
      })
      if (Array.isArray(data?.items) && data.items.length === batch.length) rows = data.items
    } catch { /* Undeployed and transient failures remain neutral, without automatic retries. */ }
    if (signal.aborted) break
    batch.forEach((item, index) => {
      const row = rows[index]
      const value = row && typeof row === 'object' && 'index' in row && row.index === index ? validateResult(row, item) : unavailable
      const key = categoryArtworkKey(item)
      output.set(key, value)
      // Short failure cooldown, not an absence claim. No timer-driven retry loop.
      if (cache.size >= 4096) cache.delete(cache.keys().next().value!)
      cache.set(`${origin}:${key}`, { value, expires: Date.now() + (value.status === 'unavailable' ? 60_000 : 86_400_000) })
    })
    onBatch?.(new Map(output))
  }
  return output
}

export function useCategoryArtwork(inputs: readonly CategoryArtworkInput[]): CategoryArtworkMap {
  const signature = JSON.stringify(inputs)
  const origin = getBackendUrl()
  const [state, setState] = useState<{ signature: string; origin: string; map: CategoryArtworkMap }>({ signature: '', origin, map: new Map() })
  useEffect(() => {
    const controller = new AbortController()
    void loadCategoryArtwork(JSON.parse(signature) as CategoryArtworkInput[], controller.signal, map => {
      if (!controller.signal.aborted) setState({ signature, origin, map })
    })
    return () => controller.abort()
  }, [signature, origin])
  return state.signature === signature && state.origin === origin ? state.map : new Map()
}
