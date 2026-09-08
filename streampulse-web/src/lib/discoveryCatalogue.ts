import { apiClient } from './momentsApiClient'
import { fromHubMoment, type DiscoveryMoment } from './discoveryMoments'
import { verifiedArchiveArtwork } from './archiveArtwork'

export interface DiscoveryScope { month: string; creator: string; day: string; category?: string }
export interface DiscoveryDay {
  day: string; state: 'measured' | 'no_measurement' | 'future'; coverage: 'partial' | 'none'
  streams: number; measuredStreamMinutes: number; chatMessages: number | null; emoteUses: number | null; detections: number | null
}
export interface DiscoveryCatalogue {
  state: 'ready' | 'stale' | 'unavailable'; days: DiscoveryDay[]; items: DiscoveryMoment[]; nextCursor: string
  asOf: string; projectionUpdatedAt: string | null; dataThrough: string | null
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const categoryId = (value: unknown): string | undefined => typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : undefined
function categoryBoxArt(value: unknown, id: string | undefined): string | undefined {
  if (typeof value !== 'string' || !id || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    if (url.origin !== 'https://static-cdn.jtvnw.net' || url.username || url.password || url.search || url.hash) return undefined
    if (!new RegExp(`^/ttv-boxart/${id}(?:_IGDB)?-\\d+x\\d+\\.(?:jpe?g|png|webp)$`, 'i').test(url.pathname)) return undefined
    if (/\/404|livechannel/i.test(url.pathname)) return undefined
    return url.href
  } catch { return undefined }
}
export const currentDiscoveryMonth = () => new Date().toISOString().slice(0, 7)
export function validDiscoveryScope(scope: DiscoveryScope): boolean {
  const date = new Date(`${scope.month}-01T00:00:00Z`)
  if (!/^\d{4}-\d{2}$/.test(scope.month) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 7) !== scope.month || scope.month < '2011-01' || scope.month > currentDiscoveryMonth()) return false
  if (scope.creator && !/^[a-z0-9_]{1,25}$/.test(scope.creator)) return false
  if (scope.category && (scope.category.length > 150 || /[\u0000\r\n]/.test(scope.category))) return false
  if (!scope.day) return true
  const day = new Date(`${scope.day}T00:00:00Z`)
  return scope.day.startsWith(`${scope.month}-`) && /^\d{4}-\d{2}-\d{2}$/.test(scope.day) && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === scope.day
}

export function normalizeDiscoveryCatalogue(value: unknown, scope: DiscoveryScope): DiscoveryCatalogue {
  const body = object(value)
  const bad = () => { throw new Error('The catalogue response could not be verified.') }
  if (body.schemaVersion !== 1 || !['ready', 'stale', 'unavailable'].includes(String(body.state)) || body.scope !== 'indexed_public_irc_streams'
    || body.calendarScope !== 'month_and_creator_only' || body.month !== scope.month || (body.login || '') !== scope.creator || !timestamp(body.asOf)
    || !Array.isArray(body.days) || !Array.isArray(body.items) || body.items.length > 100) return bad()
  const expectedDays = new Date(Date.UTC(Number(scope.month.slice(0, 4)), Number(scope.month.slice(5)), 0)).getUTCDate()
  if (body.days.length !== expectedDays) return bad()
  const days = body.days.map((value, index): DiscoveryDay => {
    const d = object(value)
    if (d.day !== `${scope.month}-${String(index + 1).padStart(2, '0')}` || !['measured', 'no_measurement', 'future'].includes(String(d.state))
      || !count(d.streams) || !count(d.measuredStreamMinutes)) return bad()
    if (d.state === 'measured') {
      if (d.coverage !== 'partial' || !d.streams || !d.measuredStreamMinutes || !count(d.chatMessages) || !count(d.emoteUses) || !count(d.detections)) return bad()
    } else if (d.coverage !== 'none' || d.streams !== 0 || d.measuredStreamMinutes !== 0 || d.chatMessages !== null || d.emoteUses !== null || d.detections !== null) return bad()
    return d as unknown as DiscoveryDay
  })
  const keys = new Set<string>()
  const items = body.items.map(value => {
    const m = object(value)
    if (typeof m.id !== 'string' || !/^dm_[a-f0-9]{32}$/.test(m.id) || m.source !== 'stored_irc' || !count(m.revision) || m.revision < 1
      || typeof m.label !== 'string' || m.label.length > 300 || !count(m.at) || !count(m.chatPerMin) || !count(m.emotesPerMin)
      || !['measured_segment', 'unavailable'].includes(String(m.categorySource))) return bad()
    const hasArchiveArtwork = Object.prototype.hasOwnProperty.call(m, 'archiveArtwork')
    const artworkValue = object(m.archiveArtwork)
    const artworkVodId = typeof artworkValue.vodId === 'string' && /^\d{6,20}$/.test(artworkValue.vodId) ? artworkValue.vodId : undefined
    const archiveArtwork = !hasArchiveArtwork || !artworkVodId ? undefined
      : verifiedArchiveArtwork(m.archiveArtwork, artworkVodId)
    // Optional catalogue artwork is display metadata only. Discard malformed
    // supplied metadata without withholding the legitimate detection.
    const at = new Date(m.at).toISOString().slice(0, 10)
    if (!at.startsWith(`${scope.month}-`) || (scope.day && at !== scope.day) || (scope.creator && m.login !== scope.creator)) return bad()
    const emotes = Array.isArray(m.topEmotes) ? m.topEmotes.slice(0, 5).flatMap(value => {
      const e = object(value)
      return typeof e.name === 'string' && e.name.length <= 100 && count(e.count) ? [{ name: e.name, count: e.count,
        provider: typeof e.provider === 'string' ? e.provider : undefined, imageUrl: typeof e.imageUrl === 'string' ? e.imageUrl : undefined }] : []
    }) : []
    const exactCategoryId = m.categorySource === 'measured_segment' ? categoryId(m.categoryId) : undefined
    const exactBoxArtUrl = categoryBoxArt(m.boxArtUrl, exactCategoryId)
    const suppliedCategoryId = m.categoryId !== undefined && m.categoryId !== null && m.categoryId !== ''
    const suppliedBoxArt = m.boxArtUrl !== undefined && m.boxArtUrl !== null && m.boxArtUrl !== ''
    const categoryMetadataRejected = (suppliedCategoryId && !exactCategoryId) || (suppliedBoxArt && !exactBoxArtUrl)
      || ((suppliedCategoryId || suppliedBoxArt) && m.categorySource !== 'measured_segment')
    const rawMeasuredCategory = m.categorySource === 'measured_segment' && typeof m.category === 'string' ? m.category : undefined
    if (scope.category && rawMeasuredCategory !== scope.category) return bad()
    const moment = fromHubMoment({ login: typeof m.login === 'string' ? m.login : undefined, streamId: typeof m.streamId === 'string' ? m.streamId : undefined,
      offsetSeconds: typeof m.offsetSeconds === 'number' ? m.offsetSeconds : NaN, at: m.at, label: m.label,
      displayName: typeof m.displayName === 'string' ? m.displayName.slice(0, 100) : undefined,
      category: m.categorySource === 'measured_segment' && typeof m.category === 'string' ? m.category.slice(0, 150) : undefined,
      categoryId: exactCategoryId, boxArtUrl: exactBoxArtUrl, categoryMetadataRejected: categoryMetadataRejected || undefined,
      chatPerMin: m.chatPerMin, emotesPerMin: m.emotesPerMin, topEmotes: emotes })
    if (!moment || keys.has(moment.key)) return bad()
    keys.add(moment.key)
    // Catalogue IDs are not the separate existing publicMomentId namespace.
    return { ...moment, revision: m.revision, archiveArtwork }
  })
  if (body.nextCursor != null && (typeof body.nextCursor !== 'string' || body.nextCursor.length > 1024)) return bad()
  for (const field of ['projectionUpdatedAt', 'dataThrough']) if (body[field] !== null && !timestamp(body[field])) return bad()
  return { state: body.state as DiscoveryCatalogue['state'], days, items, nextCursor: (body.nextCursor as string) || '',
    asOf: body.asOf, projectionUpdatedAt: body.projectionUpdatedAt as string | null, dataThrough: body.dataThrough as string | null }
}

export async function fetchDiscoveryCatalogue(scope: DiscoveryScope, signal: AbortSignal, cursor = '') {
  if (!validDiscoveryScope(scope)) throw new Error('Choose a valid month, day and creator login.')
  const query = new URLSearchParams({ month: scope.month, limit: '50' })
  if (scope.creator) query.set('login', scope.creator)
  if (scope.day) query.set('day', scope.day)
  if (scope.category) query.set('category', scope.category)
  if (cursor) query.set('cursor', cursor)
  const { data } = await apiClient<unknown>(`/v1/public/discovery?${query}`, { signal, timeoutMs: 8000, maxResponseBytes: 512 * 1024 })
  return normalizeDiscoveryCatalogue(data, scope)
}
