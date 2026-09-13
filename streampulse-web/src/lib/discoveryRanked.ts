import { apiClient } from './momentsApiClient'
import { fromHubMoment, type DiscoveryMoment } from './discoveryMoments'

export interface RankedScope { from: string; to: string; creator: string; category: string; categoryMissing: boolean }
export interface RankedFacet { category: string; categoryMissing: boolean; count: number; artwork: null }
export interface RankedMoment extends DiscoveryMoment { detectionId: string; rank: number; score: number; rankingVersion: string; scoreExplanation: string; categoryMissing: boolean }
export interface RankedDiscovery {
  state: 'ready'; from: string; to: string; creator: string; category: string | null; categoryMissing: boolean;
  asOf: string; rankingVersion: string; items: RankedMoment[]; facets: RankedFacet[]; nextCursor: string | null;
  coverage: { state: 'partial' | 'none'; scope: 'time_and_creator_only'; indexedStreams: number; measuredMinutes: number };
  eligibility: { scope: 'time_creator_category_before_pagination'; totalDetections: number; rankedDetections: number; excludedDetections: number };
  freshness: 'ready' | 'stale'; projectionUpdatedAt: string | null; dataThrough: string | null;
}
const DAY = 86400000
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && date(Date.parse(s)) === s
export function rankedRange(period: string, start = '', end = '', now = new Date()) {
  const today = Date.parse(now.toISOString().slice(0, 10))
  let from = date(today), to = date(today + DAY)
  if (period === 'yesterday') { from = date(today - DAY); to = date(today) }
  else if (period === 'week') from = date(today - ((new Date(today).getUTCDay() + 6) % 7) * DAY)
  else if (period === 'custom') {
    if (!validDate(start) || !validDate(end)) throw new Error('Choose valid UTC dates.')
    from = start; to = date(Date.parse(end) + DAY)
  } else if (period !== 'today') throw new Error('Choose a supported period.')
  const days = (Date.parse(to) - Date.parse(from)) / DAY
  if (days < 1 || days > 31 || Date.parse(from) > today || Date.parse(to) > today + DAY) throw new Error('Choose 1 to 31 inclusive UTC days, ending no later than today.')
  return { from, to }
}
export function readRankedScope(params: URLSearchParams, now = new Date()): RankedScope {
  for (const key of ['period', 'from', 'to', 'creator', 'category', 'categoryMissing', 'sort']) if (params.getAll(key).length > 1) throw new Error('Repeated Explore filter.')
  const category = params.get('category') || ''
  const missing = params.get('categoryMissing')
  if (missing !== null && missing !== 'true' && missing !== 'false') throw new Error('Invalid missing-category filter.')
  const categoryMissing = missing === 'true' || category === '__unknown__'
  if ((category && category !== '__unknown__' && categoryMissing) || (category === '__unknown__' && missing === 'false')) throw new Error('Choose one category filter.')
  const scope = { ...rankedRange(params.get('period') || 'today', params.get('from') || '', params.get('to') || '', now),
    creator: (params.get('creator') || '').trim().toLowerCase(), category: category === '__unknown__' ? '' : category, categoryMissing }
  validateScope(scope, now)
  if (params.has('sort') && params.get('sort') !== 'top') throw new Error('Explore supports Top ordering only.')
  return scope
}
function validateScope(s: RankedScope, now = new Date()) {
  if (!validDate(s.to)) throw new Error('Choose valid UTC dates.')
  rankedRange('custom', s.from, date(Date.parse(s.to) - DAY), now)
  if ((s.creator && !/^[a-z0-9_]{1,25}$/.test(s.creator)) || (s.category && s.categoryMissing)
    || new TextEncoder().encode(s.category).length > 150 || /[\u0000-\u001f]/.test(s.category)
    || s.category.trim().toLowerCase() === '__unknown__') throw new Error('Choose a valid creator and exact category.')
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(v) && validDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v))
const bad = (): never => { throw new Error('Ranked response could not be verified. Reload the collection.') }
const facetKey = (f: { category: string; categoryMissing: boolean }) => JSON.stringify([f.categoryMissing, f.category])
function ordered(a: RankedMoment, b: RankedMoment) {
  return b.rank === a.rank + 1 && (a.score > b.score || (a.score === b.score && (a.at! > b.at! || (a.at === b.at && a.detectionId > b.detectionId))))
}
export function normalizeRankedDiscovery(value: unknown, scope: RankedScope, firstRank = 1): RankedDiscovery {
  const b = object(value), c = object(b.coverage), e = object(b.eligibility)
  if (b.schemaVersion !== 1 || b.state !== 'ready' || b.scope !== 'indexed_public_irc_streams' || b.sort !== 'top'
    || b.from !== scope.from || b.to !== scope.to || (b.login ?? '') !== scope.creator || b.categoryMissing !== scope.categoryMissing
    || b.category !== (scope.categoryMissing ? 'Unknown' : scope.category || null) || !timestamp(b.asOf) || !text(b.rankingVersion, 200)
    || !['ready', 'stale'].includes(String(b.freshness)) || !Array.isArray(b.items) || b.items.length > 50
    || !Array.isArray(b.facets) || b.facets.length > 1000 || c.scope !== 'time_and_creator_only'
    || !['partial', 'none'].includes(String(c.state)) || !count(c.indexedStreams) || !count(c.measuredMinutes)
    || (c.state === 'none' && (c.indexedStreams !== 0 || c.measuredMinutes !== 0 || b.items.length > 0))) return bad()
  if (e.scope !== 'time_creator_category_before_pagination' || !count(e.totalDetections) || !count(e.rankedDetections) || !count(e.excludedDetections)
    || e.rankedDetections > e.totalDetections || e.excludedDetections !== e.totalDetections - e.rankedDetections
    || !count(firstRank) || firstRank < 1) return bad()
  const lastRank = firstRank + b.items.length - 1
  if (lastRank > e.rankedDetections || (!b.items.length && (e.rankedDetections !== 0 || firstRank !== 1))
    || Boolean(b.nextCursor) !== (lastRank < e.rankedDetections)) return bad()
  for (const field of ['projectionUpdatedAt', 'dataThrough']) if (b[field] !== null && (!timestamp(b[field]) || Date.parse(b[field] as string) > Date.parse(b.asOf))) return bad()
  if (b.dataThrough !== null && Date.parse(b.dataThrough as string) > Date.parse(scope.to)) return bad()
  if (b.nextCursor !== null && (!text(b.nextCursor, 2048) || !b.items.length)) return bad()
  const facets: RankedFacet[] = b.facets.map(v => {
    const f = object(v)
    if (!text(f.category, 150) || typeof f.categoryMissing !== 'boolean' || !count(f.count) || f.artwork !== null || (f.categoryMissing && f.category !== 'Unknown')) return bad()
    return { category: f.category, categoryMissing: f.categoryMissing, count: f.count, artwork: null }
  })
  if (new Set(facets.map(facetKey)).size !== facets.length || ((scope.category || scope.categoryMissing) && !facets.some(f => f.categoryMissing === scope.categoryMissing && f.category === b.category))) return bad()
  const selectedFacetCount = facets.filter(f => !scope.category && !scope.categoryMissing || f.categoryMissing === scope.categoryMissing && f.category === b.category)
    .reduce((total, f) => total + f.count, 0)
  if (!count(selectedFacetCount) || selectedFacetCount !== e.rankedDetections) return bad()
  const ids = new Set<string>(), keys = new Set<string>()
  const upperBound = Math.min(Date.parse(scope.to), Date.parse(b.asOf))
  const items: RankedMoment[] = b.items.map((v, index) => {
    const m = object(v)
    if (typeof m.id !== 'string' || !/^dm_[a-f0-9]{32}$/.test(m.id) || !count(m.rank) || m.rank !== firstRank + index
      || !finite(m.score) || m.rankingVersion !== b.rankingVersion || !text(m.scoreExplanation, 1000) || m.source !== 'stored_irc'
      || !count(m.revision) || m.revision < 1 || !count(m.at) || m.at < Date.parse(scope.from) || m.at >= upperBound
      || !count(m.chatPerMin) || !count(m.emotesPerMin) || !count(m.offsetSeconds)
      || !text(m.label, 300) || typeof m.login !== 'string' || !/^[a-z0-9_]{1,25}$/.test(m.login) || (scope.creator && m.login !== scope.creator)
      || typeof m.categoryMissing !== 'boolean' || (m.categoryMissing ? m.categorySource !== 'unavailable' || Boolean(m.category) : m.categorySource !== 'measured_segment' || !text(m.category, 150))
      || (scope.categoryMissing && !m.categoryMissing) || (scope.category && m.category !== scope.category)) return bad()
    const moment = fromHubMoment({ login: m.login, streamId: typeof m.streamId === 'string' ? m.streamId : '', offsetSeconds: m.offsetSeconds,
      at: m.at, label: m.label, displayName: typeof m.displayName === 'string' ? m.displayName.slice(0, 100) : undefined,
      category: m.categoryMissing ? undefined : m.category as string, chatPerMin: m.chatPerMin, emotesPerMin: m.emotesPerMin,
      topEmotes: Array.isArray(m.topEmotes) ? m.topEmotes.slice(0, 5).flatMap(v => { const e = object(v); return text(e.name, 100) && count(e.count) ? [{ name: e.name, count: e.count, provider: typeof e.provider === 'string' ? e.provider : undefined, imageUrl: typeof e.imageUrl === 'string' ? e.imageUrl : undefined }] : [] }) : [] })
    if (!moment || ids.has(m.id) || keys.has(moment.key)) return bad()
    ids.add(m.id); keys.add(moment.key)
    return { ...moment, detectionId: m.id, rank: m.rank, score: m.score, rankingVersion: m.rankingVersion as string,
      scoreExplanation: m.scoreExplanation, categoryMissing: m.categoryMissing, revision: m.revision, evidenceAsOf: b.asOf as string }
  })
  if (items.some((m, i) => i > 0 && !ordered(items[i - 1], m))) return bad()
  if (items.some(m => !facets.some(f => f.categoryMissing === m.categoryMissing && f.category === (m.categoryMissing ? 'Unknown' : m.category) && f.count > 0))) return bad()
  return { state: 'ready', from: scope.from, to: scope.to, creator: scope.creator, category: b.category as string | null,
    categoryMissing: scope.categoryMissing, asOf: b.asOf, rankingVersion: b.rankingVersion, facets, items,
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: e.totalDetections, rankedDetections: e.rankedDetections, excludedDetections: e.excludedDetections },
    nextCursor: b.nextCursor as string | null, coverage: { state: c.state as 'partial' | 'none', scope: 'time_and_creator_only', indexedStreams: c.indexedStreams, measuredMinutes: c.measuredMinutes }, freshness: b.freshness as RankedDiscovery['freshness'],
    projectionUpdatedAt: b.projectionUpdatedAt as string | null, dataThrough: b.dataThrough as string | null }
}
export function appendRankedPage(previous: RankedDiscovery, page: RankedDiscovery): RankedDiscovery {
  const { items: _old, nextCursor: _cursor, ...oldMeta } = previous
  const { items: _new, nextCursor: _next, ...newMeta } = page
  if (JSON.stringify(oldMeta) !== JSON.stringify(newMeta) || !page.items.length || !previous.items.length
    || !ordered(previous.items[previous.items.length - 1], page.items[0]) || page.items.some(m => previous.items.some(p => p.key === m.key || p.detectionId === m.detectionId))) return bad()
  return { ...page, items: [...previous.items, ...page.items] }
}
export async function fetchRankedDiscovery(scope: RankedScope, signal: AbortSignal, cursor = '', firstRank = 1) {
  validateScope(scope)
  if (cursor.length > 2048) return bad()
  const query = new URLSearchParams({ from: scope.from, to: scope.to, sort: 'top', limit: '50' })
  if (scope.creator) query.set('login', scope.creator)
  if (scope.categoryMissing) query.set('categoryMissing', 'true'); else if (scope.category) query.set('category', scope.category)
  if (cursor) query.set('cursor', cursor)
  const { data } = await apiClient<unknown>(`/v1/public/discovery/ranked?${query}`, { signal, maxResponseBytes: 150000, timeoutMs: 8000 })
  return normalizeRankedDiscovery(data, scope, firstRank)
}
