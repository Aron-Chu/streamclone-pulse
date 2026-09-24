import { apiClient } from './apiClient'
import { fromHubMoment, type DiscoveryMoment } from './discoveryMoments'

export interface RankedScope { from: string; to: string; creator: string; category: string; categoryMissing: boolean; sort?: 'top' | 'volume' }
export interface RankedFacet { category: string; categoryMissing: boolean; count: number; artwork: null }
export interface RankedMoment extends DiscoveryMoment { detectionId: string; rank: number; score: number; rankingVersion: string; scoreExplanation: string; categoryMissing: boolean }
export interface RankedDiscovery {
  sort?: 'top' | 'volume';
  state: 'ready'; from: string; to: string; creator: string; category: string | null; categoryMissing: boolean;
  asOf: string; rankingVersion: string; items: RankedMoment[]; facets: RankedFacet[]; nextCursor: string | null;
  coverage: { state: 'partial' | 'none'; scope: 'time_and_creator_completed_broadcasts_only'; indexedStreams: number; measuredMinutes: number };
  eligibility: { scope: 'time_creator_category_before_pagination'; totalDetections: number; rankedDetections: number; excludedDetections: number };
  freshness: 'ready' | 'stale'; projectionUpdatedAt: string | null; dataThrough: string | null;
  indexedRetentionStart: string | null; indexedRetentionAttestedAt: string | null; certifiedThroughExclusive: string | null; certificateGeneration: number | null;
}
const DAY = 86400000
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && date(Date.parse(s)) === s
export const HISTORY_RECENT_DAYS = 30
export function historyRecentWindow(now: Date, indexedRetentionStart: string, certifiedThroughExclusive: string) {
  const today = Date.parse(now.toISOString().slice(0, 10))
  if (!validDate(indexedRetentionStart) || !validDate(certifiedThroughExclusive)
    || indexedRetentionStart >= certifiedThroughExclusive || certifiedThroughExclusive > date(today)) throw new Error('Certified dates are unavailable.')
  const cap = date(today - HISTORY_RECENT_DAYS * DAY)
  const from = indexedRetentionStart > cap ? indexedRetentionStart : cap
  if (from >= certifiedThroughExclusive) throw new Error('No certified recent UTC days are available.')
  return { from, to: certifiedThroughExclusive, latestDay: date(Date.parse(certifiedThroughExclusive) - DAY), today: date(today) }
}
export function rankedRange(period: string, start: string, end: string, now: Date, certifiedThroughExclusive: string) {
  const today = Date.parse(now.toISOString().slice(0, 10))
  if (!validDate(certifiedThroughExclusive) || Date.parse(certifiedThroughExclusive) > today) throw new Error('Certified dates are unavailable.')
  let from = date(Date.parse(certifiedThroughExclusive) - DAY), to = certifiedThroughExclusive
  if (period === 'last7') from = date(Date.parse(certifiedThroughExclusive) - 7 * DAY)
  else if (period === 'custom') {
    if (!validDate(start) || !validDate(end)) throw new Error('Choose valid UTC dates.')
    from = start; to = date(Date.parse(end) + DAY)
  } else if (period !== 'latest') throw new Error('Choose a certified period. The open UTC day is available in Latest moments.')
  const days = (Date.parse(to) - Date.parse(from)) / DAY
  if (days < 1 || days > HISTORY_RECENT_DAYS || Date.parse(from) >= today || Date.parse(to) > Date.parse(certifiedThroughExclusive)) throw new Error('Choose 1 to 30 inclusive certified UTC days.')
  return { from, to }
}
export function readRankedScope(params: URLSearchParams, now: Date, indexedRetentionStart: string, certifiedThroughExclusive: string): RankedScope {
  if (!validDate(indexedRetentionStart) || !validDate(certifiedThroughExclusive) || indexedRetentionStart >= certifiedThroughExclusive) throw new Error('Certified dates are unavailable.')
  for (const key of ['period', 'from', 'to', 'creator', 'category', 'categoryMissing', 'sort']) if (params.getAll(key).length > 1) throw new Error('Repeated Explore filter.')
  const category = params.get('category') || ''
  const missing = params.get('categoryMissing')
  if (missing !== null && missing !== 'true' && missing !== 'false') throw new Error('Invalid missing-category filter.')
  const categoryMissing = missing === 'true' || category === '__unknown__'
  if ((category && category !== '__unknown__' && categoryMissing) || (category === '__unknown__' && missing === 'false')) throw new Error('Choose one category filter.')
  const period = params.get('period') || 'latest'
  const range = rankedRange(period, params.get('from') || '', params.get('to') || '', now, certifiedThroughExclusive)
  if (range.from < indexedRetentionStart) {
    if (period === 'custom' || range.to <= indexedRetentionStart) throw new Error(`Explore currently starts at ${indexedRetentionStart} UTC. Choose a later range.`)
    range.from = indexedRetentionStart
  }
  const scope: RankedScope = { ...range,
    creator: (params.get('creator') || '').trim().toLowerCase(), category: category === '__unknown__' ? '' : category, categoryMissing, sort: 'volume' }
  validateScope(scope, now)
  if (params.has('sort') && params.get('sort') !== 'volume') throw new Error('Relative ranking is not certified yet. Choose observed IRC volume.')
  return scope
}

/**
 * Translate History URL filters into the ranked discovery contract. The source
 * minute rollups have no durable year retention contract, so this surface only
 * offers the recent 30 UTC days clipped to the attested indexed boundary.
 * Legacy month links are clipped; older day or month links fail explicitly.
 */
export function readHistoryRankedScope(params: URLSearchParams, now: Date, indexedRetentionStart: string, certifiedThroughExclusive: string): RankedScope {
  if (!validDate(indexedRetentionStart) || !validDate(certifiedThroughExclusive) || indexedRetentionStart >= certifiedThroughExclusive) throw new Error('Certified dates are unavailable.')
  for (const key of ['year', 'month', 'day', 'creator', 'scope', 'category', 'categoryMissing', 'sort']) {
    if (params.getAll(key).length > 1) throw new Error('Repeated History filter.')
  }
  const recent = historyRecentWindow(now, indexedRetentionStart, certifiedThroughExclusive)
  const yearText = params.get('year') || ''
  if (yearText && (!/^\d{4}$/.test(yearText) || Number(yearText) < 2011 || Number(yearText) > Number(recent.today.slice(0, 4)))) {
    throw new Error('Choose a valid UTC year.')
  }

  const month = params.get('month') || ''
  if (month && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (yearText && !month.startsWith(`${yearText}-`)))) {
    throw new Error('Choose a valid UTC month.')
  }
  const day = params.get('day') || ''
  if (day && (!validDate(day) || (yearText && !day.startsWith(`${yearText}-`)) || (month && !day.startsWith(`${month}-`)))) {
    throw new Error('Choose a valid UTC day.')
  }
  if (day && (day < recent.from || day > recent.latestDay)) {
    throw new Error(`History currently covers ${recent.from} through ${recent.latestDay} UTC. Older days are not a durable archive.`)
  }
  if (yearText && !day && !month && yearText !== recent.latestDay.slice(0, 4)) {
    throw new Error(`History currently covers ${recent.from} through ${recent.latestDay} UTC. Choose a recent day.`)
  }

  const monthStart = month ? `${month}-01` : ''
  const monthEnd = month ? date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)) : ''
  if (month && !day && (monthEnd <= recent.from || monthStart >= recent.to)) {
    throw new Error(`History currently covers ${recent.from} through ${recent.latestDay} UTC. Older months are not a durable archive.`)
  }
  const from = day || (month ? (monthStart > recent.from ? monthStart : recent.from) : recent.from)
  const to = day ? date(Date.parse(day) + DAY) : month ? (monthEnd < recent.to ? monthEnd : recent.to) : recent.to

  const category = params.get('category') || ''
  const missing = params.get('categoryMissing')
  if (missing !== null && missing !== 'true' && missing !== 'false') {
    throw new Error('Invalid missing-category filter.')
  }
  const categoryMissing = missing === 'true' || category === '__unknown__'
  if ((category && category !== '__unknown__' && categoryMissing) || (category === '__unknown__' && missing === 'false')) {
    throw new Error('Choose one category filter.')
  }

  const scope = params.get('scope') === 'creator'
    || (!params.has('scope') && params.get('collection') === 'history' && params.has('creator'))
  const creator = scope ? (params.get('creator') || '').trim().toLowerCase() : ''
  const sort = params.get('sort') || 'volume'
  if (sort !== 'volume') throw new Error('Relative ranking is not certified yet. Choose observed IRC volume.')

  const result: RankedScope = {
    from,
    to,
    creator,
    category: category === '__unknown__' ? '' : category,
    categoryMissing,
    sort,
  }
  validateScope(result, now)
  return result
}
function validateScope(s: RankedScope, now = new Date()) {
  if (!validDate(s.from) || !validDate(s.to)) throw new Error('Choose valid UTC dates.')
  const days = (Date.parse(s.to) - Date.parse(s.from)) / DAY
  const today = Date.parse(now.toISOString().slice(0, 10))
  if (days < 1 || days > 366 || Date.parse(s.from) > today || Date.parse(s.to) > today + DAY) throw new Error('Choose up to one year, ending no later than today.')
  if (s.sort !== undefined && s.sort !== 'top' && s.sort !== 'volume') throw new Error('Choose a supported ranking.')
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
  if (b.schemaVersion !== 1 || b.state !== 'ready' || b.scope !== 'indexed_completed_public_irc_streams' || b.sort !== (scope.sort || 'top')
    || b.from !== scope.from || b.to !== scope.to || (b.login ?? '') !== scope.creator || b.categoryMissing !== scope.categoryMissing
    || b.category !== (scope.categoryMissing ? 'Unknown' : scope.category || null) || !timestamp(b.asOf) || !text(b.rankingVersion, 200)
    || !['ready', 'stale'].includes(String(b.freshness)) || !Array.isArray(b.items) || b.items.length > 50
    || !Array.isArray(b.facets) || b.facets.length > 1000 || c.scope !== 'time_and_creator_completed_broadcasts_only'
    || !['partial', 'none'].includes(String(c.state)) || !count(c.indexedStreams) || !count(c.measuredMinutes)
    || (c.state === 'none' && (c.indexedStreams !== 0 || c.measuredMinutes !== 0 || b.items.length > 0))) return bad()
  if ((scope.sort === 'volume' && (!validDate(String(b.indexedRetentionStart)) || String(b.indexedRetentionStart) > scope.from
      || !validDate(String(b.certifiedThroughExclusive)) || scope.to > String(b.certifiedThroughExclusive)
      || !count(b.certificateGeneration) || b.certificateGeneration < 1
      // A continuation keeps the first page's asOf, while the operator may
      // renew the retention proof between pages. The server checks that proof
      // against the actual request time on every read.
      || !timestamp(b.indexedRetentionAttestedAt)
      || Date.parse(b.indexedRetentionAttestedAt as string) - Date.parse(b.asOf as string) > (firstRank === 1 ? 0 : 24 * 60 * 60 * 1000 + 60 * 1000)
      || Date.parse(b.asOf as string) - Date.parse(b.indexedRetentionAttestedAt as string) >= 2 * 60 * 60 * 1000))
    || (b.indexedRetentionStart != null && !validDate(String(b.indexedRetentionStart)))
    || (b.certifiedThroughExclusive != null && !validDate(String(b.certifiedThroughExclusive)))
    || (b.indexedRetentionAttestedAt != null && !timestamp(b.indexedRetentionAttestedAt))) return bad()
  if (e.scope !== 'time_creator_category_before_pagination' || !count(e.totalDetections) || !count(e.rankedDetections) || !count(e.excludedDetections)
    || e.rankedDetections > e.totalDetections || e.excludedDetections !== e.totalDetections - e.rankedDetections
    || (c.state === 'none' && e.totalDetections > 0)
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
      || (scope.sort === 'volume' && m.score !== m.chatPerMin)
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
    categoryMissing: scope.categoryMissing, sort: scope.sort || 'top', asOf: b.asOf, rankingVersion: b.rankingVersion, facets, items,
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: e.totalDetections, rankedDetections: e.rankedDetections, excludedDetections: e.excludedDetections },
    nextCursor: b.nextCursor as string | null, coverage: { state: c.state as 'partial' | 'none', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: c.indexedStreams, measuredMinutes: c.measuredMinutes }, freshness: b.freshness as RankedDiscovery['freshness'],
    projectionUpdatedAt: b.projectionUpdatedAt as string | null, dataThrough: b.dataThrough as string | null,
    indexedRetentionStart: b.indexedRetentionStart as string | null ?? null,
    indexedRetentionAttestedAt: b.indexedRetentionAttestedAt as string | null ?? null,
    certifiedThroughExclusive: b.certifiedThroughExclusive as string | null ?? null,
    certificateGeneration: b.certificateGeneration as number | null ?? null }
}
export function appendRankedPage(previous: RankedDiscovery, page: RankedDiscovery): RankedDiscovery {
  // The attestation is current request evidence, not part of the cursor's
  // snapshot identity. Keep the indexed boundary and every other field fixed.
  const { items: _old, nextCursor: _cursor, indexedRetentionAttestedAt: _oldAttestation, ...oldMeta } = previous
  const { items: _new, nextCursor: _next, indexedRetentionAttestedAt: _newAttestation, ...newMeta } = page
  if (JSON.stringify(oldMeta) !== JSON.stringify(newMeta) || !page.items.length || !previous.items.length
    || !ordered(previous.items[previous.items.length - 1], page.items[0]) || page.items.some(m => previous.items.some(p => p.key === m.key || p.detectionId === m.detectionId))) return bad()
  return { ...page, items: [...previous.items, ...page.items] }
}
export function rankedEmptyMessage(data: RankedDiscovery): string {
  if (data.coverage.state === 'none') return 'No indexed measurement in this selection. This does not mean no moments occurred.'
  if (data.eligibility.totalDetections === 0) return 'No stored detections in this measured, partially covered selection.'
  return 'Stored detections exist here, but none qualify for observed IRC volume ranking. Try another date or creator.'
}
export async function fetchRankedDiscovery(scope: RankedScope, signal: AbortSignal, cursor = '', firstRank = 1) {
  validateScope(scope)
  if (cursor.length > 2048) return bad()
  const query = new URLSearchParams({ from: scope.from, to: scope.to, sort: scope.sort || 'top', limit: '50' })
  if (scope.creator) query.set('login', scope.creator)
  if (scope.categoryMissing) query.set('categoryMissing', 'true'); else if (scope.category) query.set('category', scope.category)
  if (cursor) query.set('cursor', cursor)
  const { data } = await apiClient<unknown>(`/v1/public/discovery/ranked?${query}`, { signal, maxResponseBytes: 150000, timeoutMs: 8000 })
  return normalizeRankedDiscovery(data, scope, firstRank)
}
