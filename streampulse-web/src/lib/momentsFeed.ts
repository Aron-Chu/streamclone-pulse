import { apiClient, isApiError } from './apiClient'

/**
 * GET /v1/public/moments, schemaVersion 1 (streampulse-backend
 * internal/analytics/moments_feed_types.go). The backend computes every
 * derived field: tier, verdict, checks, label, the 15-minute baselines and the
 * 25-minute sparklines. The portal only words and draws them; it never
 * re-applies a threshold or decides a verdict.
 *
 * The feed is behind the backend's PULSE_MOMENTS_FEED_ENABLED (404 while off).
 */
export const MOMENTS_FEED_SCHEMA_VERSION = 1

export type MomentVerdict = 'ok' | 'warn' | 'bad'
export type MomentCheckLevel = MomentVerdict
export type MomentMetricKind = 'chat' | 'emotes'

export interface MomentsFeedCheck { level: MomentCheckLevel; code: string }
export interface MomentsFeedChecks { history: MomentsFeedCheck; busy?: MomentsFeedCheck; rise?: MomentsFeedCheck }
export interface MomentsFeedLabel { kind: MomentMetricKind; text: string; spammed?: boolean; relabelled?: boolean }
export interface MomentsFeedMetric { perMin: number | null; baselinePerMin: number | null; x: number | null; state: string }
export interface MomentsFeedCategory { id: string; name: string; boxArtUrl?: string }
/** facets.categories: the window's games, most moments first (at most 24; every verdict counted), with each game's live channels. */
export interface MomentsFeedCategoryFacet { id: string; name: string; boxArtUrl?: string; moments: number; liveChannels: number }
export interface MomentsFeedEmote { name: string; imageUrl?: string; count: number; provider?: string; zeroWidth?: boolean; animated?: boolean }
/** 25 one-minute slots, -16..+8 around the moment; slot `momentIndex` (16) is the moment. */
export interface MomentsFeedSpark {
  chat: Array<number | null>
  emotes: Array<number | null>
  momentIndex: number
  /** Slots before this one fall before the stream started. */
  sparkStartIndex: number
  spanStartIndex?: number
}

export interface MomentsFeedItem {
  /** pulse-{login}-{streamId}-{offsetSeconds} */
  id: string
  login: string
  displayName: string
  profileImageUrl?: string
  hasDefaultAvatar?: boolean
  streamId: string
  offsetSeconds: number
  /** Epoch ms of the detector's minute. */
  minuteStart: number
  streamLive: boolean
  liveFrameUrl?: string
  tier: string
  verdict: MomentVerdict
  score: number
  reason?: string
  label: MomentsFeedLabel
  reaction: { key: string; label: string }
  category: MomentsFeedCategory | null
  /** At most 3, sorted by count. */
  topEmotes: MomentsFeedEmote[]
  hero: MomentMetricKind
  chat: MomentsFeedMetric
  emotes: MomentsFeedMetric
  spanMinutes: number
  viewers?: number
  spark: MomentsFeedSpark
  baselineMeasuredMinutes?: number
  checks: MomentsFeedChecks
}

export interface MomentsFeedResponse {
  schemaVersion: number
  generatedAt: number
  snapshotVersion: string
  window: string
  status: 'ready' | 'partial'
  stale: boolean
  coverage: { streamsScored: number; streamsEligible: number }
  total: number
  nextCursor: string | null
  /** Left out of some captures; the page reads the verdict counts and the games' live channels. */
  facets?: { verdicts?: Record<MomentVerdict, number>; categories?: unknown }
  items: MomentsFeedItem[]
}

export interface MomentsFeedItemResponse {
  schemaVersion: number
  generatedAt: number
  snapshotVersion: string
  stale: boolean
  item: MomentsFeedItem
}

/** One page as the page uses it: its moments, and the feed's own counts for the whole window. */
export interface MomentsFeedSnapshot {
  items: MomentsFeedItem[]
  generatedAt: number
  stale: boolean
  /** Every moment in the window, on all pages (the feed's count, not what has loaded). */
  total: number
  /** The window's moments by verdict, when the feed sends its facets. */
  verdicts: Record<MomentVerdict, number> | null
  /** The window's games from the feed's facets (malformed ones left out); null when it sends none. */
  categories: MomentsFeedCategoryFacet[] | null
  /** The next page; null on the last one. */
  nextCursor: string | null
}

const VERDICTS = new Set(['ok', 'warn', 'bad'])
const KINDS = new Set(['chat', 'emotes'])
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nullableFinite = (v: unknown) => v === null || finite(v)
const slots = (v: unknown) => Array.isArray(v) && v.length === 25 && v.every(nullableFinite)
const check = (v: unknown) => !!v && typeof v === 'object' && VERDICTS.has((v as MomentsFeedCheck).level) && typeof (v as MomentsFeedCheck).code === 'string'
const metric = (v: unknown) => !!v && typeof v === 'object' && nullableFinite((v as MomentsFeedMetric).perMin)
  && nullableFinite((v as MomentsFeedMetric).baselinePerMin) && nullableFinite((v as MomentsFeedMetric).x)

/** A whole item, as the feed sends it on `items` (runner-up cards lack spark and checks, and are never read here). */
export function isMomentsFeedItem(value: unknown): value is MomentsFeedItem {
  if (!value || typeof value !== 'object') return false
  const m = value as MomentsFeedItem
  return typeof m.id === 'string' && m.id.length > 0 && typeof m.login === 'string' && typeof m.displayName === 'string'
    && typeof m.streamId === 'string' && finite(m.offsetSeconds) && m.offsetSeconds >= 0 && finite(m.minuteStart)
    && typeof m.streamLive === 'boolean' && VERDICTS.has(m.verdict) && finite(m.score)
    && !!m.label && KINDS.has(m.label.kind) && typeof m.label.text === 'string'
    && Array.isArray(m.topEmotes) && metric(m.chat) && metric(m.emotes)
    && !!m.spark && slots(m.spark.chat) && slots(m.spark.emotes) && m.spark.momentIndex === 16 && finite(m.spark.sparkStartIndex)
    && !!m.checks && check(m.checks.history) && (m.checks.busy === undefined || check(m.checks.busy)) && (m.checks.rise === undefined || check(m.checks.rise))
}

const isCategoryFacet = (v: unknown): v is MomentsFeedCategoryFacet => {
  const c = v as MomentsFeedCategoryFacet
  return !!c && typeof c === 'object' && typeof c.id === 'string' && c.id.length > 0 && typeof c.name === 'string' && c.name.length > 0
    && finite(c.moments) && finite(c.liveChannels) && (c.boxArtUrl === undefined || typeof c.boxArtUrl === 'string')
}

function feedPage(data: unknown): MomentsFeedResponse {
  const body = data as MomentsFeedResponse
  if (!body || typeof body !== 'object' || body.schemaVersion !== MOMENTS_FEED_SCHEMA_VERSION || !Array.isArray(body.items) || !finite(body.generatedAt)) {
    throw { kind: 'bad_request', message: 'Unexpected moments feed shape', status: 200, code: 'schema' }
  }
  // One malformed item is left out, not the whole page.
  return { ...body, items: body.items.filter(isMomentsFeedItem) }
}

const PAGE_LIMIT = 50
const PAGE_BYTES = 512 * 1024
export const MOMENTS_WINDOW_MS = 12 * 60 * 60_000

/**
 * `from` for the last 12 hours, floored to 10 minutes so every reader in the
 * same 10 minutes asks for the same URL and the edge answers it from cache.
 */
export function momentsFeedFrom(nowMs: number): number {
  return Math.floor((nowMs - MOMENTS_WINDOW_MS) / 600_000) * 600_000
}

async function readPage(nowMs: number, cursor: string | null, signal?: AbortSignal, cache: RequestCache = 'default'): Promise<MomentsFeedSnapshot> {
  const query = new URLSearchParams({ sort: 'new', from: String(momentsFeedFrom(nowMs)), limit: String(PAGE_LIMIT) })
  if (cursor) query.set('cursor', cursor)
  // The feed answers with public, max-age=30 and is edge-cached; the browser may reuse it too.
  const { data } = await apiClient<unknown>(`/v1/public/moments?${query}`, { signal, timeoutMs: 8000, maxResponseBytes: PAGE_BYTES, cache })
  const page = feedPage(data)
  const verdicts = page.facets?.verdicts
  const categories = page.facets?.categories
  return {
    items: page.items, generatedAt: page.generatedAt, stale: page.stale === true,
    total: finite(page.total) && page.total >= 0 ? page.total : page.items.length,
    verdicts: verdicts && finite(verdicts.ok) && finite(verdicts.warn) && finite(verdicts.bad) ? { ok: verdicts.ok, warn: verdicts.warn, bad: verdicts.bad } : null,
    categories: Array.isArray(categories) ? categories.filter(isCategoryFacet) : null,
    nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null,
  }
}

/** The newest page of the last 12 hours: what the page draws first. The rest come from loadMomentsFeedRest. */
export function loadMomentsFeed(nowMs: number, signal?: AbortSignal): Promise<MomentsFeedSnapshot> {
  return readPage(nowMs, null, signal)
}

/**
 * The pages after the first, one at a time behind the drawn list, each handed
 * over as it arrives, until the last. A page that fails ends the read and the
 * page keeps what has arrived. A cursor that expires between pages (409: a new
 * snapshot was published) starts again once from a fresh first page (`fresh`),
 * read past the browser's cache so the expired cursor is not handed back.
 * Resolves true when every page arrived.
 */
export async function loadMomentsFeedRest(
  nowMs: number, cursor: string | null, onPage: (page: MomentsFeedSnapshot, fresh: boolean) => void, signal?: AbortSignal,
): Promise<boolean> {
  const seen = new Set<string>()
  let restarted = false
  while (cursor) {
    if (seen.has(cursor)) return false // a cursor that comes back would never end
    seen.add(cursor)
    let page: MomentsFeedSnapshot
    try {
      page = await readPage(nowMs, cursor, signal)
      onPage(page, false)
    } catch (error) {
      if (restarted || !isApiError(error) || error.status !== 409 || signal?.aborted) return false
      restarted = true
      seen.clear()
      try { page = await readPage(nowMs, null, signal, 'reload') } catch { return false }
      onPage(page, true)
    }
    cursor = page.nextCursor
  }
  return true
}

/** A poll: the newest page only. New and changed moments are merged into what the page holds. */
export function pollMomentsFeed(nowMs: number, signal?: AbortSignal): Promise<MomentsFeedSnapshot> {
  return readPage(nowMs, null, signal)
}

/** One moment by id (a deep link to a moment the list has not loaded). Null when the feed no longer has it. */
export async function loadMomentsFeedItem(id: string, signal?: AbortSignal): Promise<MomentsFeedItem | null> {
  try {
    const { data } = await apiClient<unknown>(`/v1/public/moments?${new URLSearchParams({ id })}`, { signal, timeoutMs: 8000, maxResponseBytes: 64 * 1024, cache: 'default' })
    const body = data as MomentsFeedItemResponse
    return body && body.schemaVersion === MOMENTS_FEED_SCHEMA_VERSION && isMomentsFeedItem(body.item) ? body.item : null
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null
    throw error
  }
}

/** Add a later page's moments: only the ones the page doesn't hold (a poll may already have sent a newer copy). */
export function appendMomentsFeed(held: MomentsFeedItem[], more: MomentsFeedItem[]): MomentsFeedItem[] {
  const ids = new Set(held.map(item => item.id))
  const fresh = more.filter(item => (ids.has(item.id) ? false : (ids.add(item.id), true)))
  return fresh.length ? [...held, ...fresh] : held
}

/** Merge a poll into what the page holds: a moment the poll sent again is replaced, a new one added. */
export function mergeMomentsFeed(held: MomentsFeedItem[], polled: MomentsFeedItem[]): { items: MomentsFeedItem[]; added: string[] } {
  const byId = new Map(held.map(item => [item.id, item]))
  const added: string[] = []
  for (const item of polled) {
    if (!byId.has(item.id)) added.push(item.id)
    byId.set(item.id, item)
  }
  return { items: [...byId.values()], added }
}

/** The feed id of a moment named the way the old page's links name one (?login=&stream=&offset=). */
export function momentsFeedIdFromLegacy(login: string | null, stream: string | null, offset: string | null): string | null {
  if (!login || !stream || offset == null || !/^\d+$/.test(offset) || !/^[a-z0-9_]{1,25}$/i.test(login) || !/^\d{1,30}$/.test(stream)) return null
  return `pulse-${login.toLowerCase()}-${stream}-${Number(offset)}`
}

/** The stream and offset a feed id names (pulse-{login}-{streamId}-{offsetSeconds}), for a link to a moment the feed no longer has. */
export function momentsFeedIdParts(id: string): { login: string; streamId: string; offsetSeconds: number } | null {
  const match = /^pulse-([a-z0-9_]{1,25})-(\d{1,30})-(\d{1,9})$/.exec(id)
  return match ? { login: match[1], streamId: match[2], offsetSeconds: Number(match[3]) } : null
}
