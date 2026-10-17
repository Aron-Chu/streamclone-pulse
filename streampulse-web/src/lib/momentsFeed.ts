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

/**
 * Build-time switch for the checked Moments page (VITE_PUBLIC_MOMENTS_FEED).
 * Off unless the build sets it to `on` (or `1`). Off, /analytics/moments is
 * exactly master's page. On, the page reads /v1/public/moments, and falls back
 * to master's page when the feed is not there (404 while the backend flag is
 * off) or does not answer on the first load.
 */
export function momentsFeedEnabled(): boolean {
  const value = import.meta.env.VITE_PUBLIC_MOMENTS_FEED
  return value === 'on' || value === '1'
}

export type MomentVerdict = 'ok' | 'warn' | 'bad'
export type MomentCheckLevel = MomentVerdict
export type MomentMetricKind = 'chat' | 'emotes'

export interface MomentsFeedCheck { level: MomentCheckLevel; code: string }
export interface MomentsFeedChecks { history: MomentsFeedCheck; busy?: MomentsFeedCheck; rise?: MomentsFeedCheck }
export interface MomentsFeedLabel { kind: MomentMetricKind; text: string; spammed?: boolean; relabelled?: boolean }
export interface MomentsFeedMetric { perMin: number | null; baselinePerMin: number | null; x: number | null; state: string }
export interface MomentsFeedCategory { id: string; name: string; boxArtUrl?: string }
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
  facets: { verdicts: Record<MomentVerdict, number> }
  items: MomentsFeedItem[]
}

export interface MomentsFeedItemResponse {
  schemaVersion: number
  generatedAt: number
  snapshotVersion: string
  stale: boolean
  item: MomentsFeedItem
}

/** What the page holds after a load or a poll: the moments, newest snapshot first. */
export interface MomentsFeedSnapshot {
  items: MomentsFeedItem[]
  generatedAt: number
  stale: boolean
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

function feedPage(data: unknown): MomentsFeedResponse {
  const body = data as MomentsFeedResponse
  if (!body || typeof body !== 'object' || body.schemaVersion !== MOMENTS_FEED_SCHEMA_VERSION || !Array.isArray(body.items) || !finite(body.generatedAt)) {
    throw { kind: 'bad_request', message: 'Unexpected moments feed shape', status: 200, code: 'schema' }
  }
  // One malformed item is left out, not the whole page.
  return { ...body, items: body.items.filter(isMomentsFeedItem) }
}

const PAGE_LIMIT = 50
/** 6 × 50: more than a busy 12 hours brings (the 2026-10-16 fixture has 120). */
const MAX_PAGES = 6
const PAGE_BYTES = 512 * 1024
export const MOMENTS_WINDOW_MS = 12 * 60 * 60_000

/**
 * `from` for the last 12 hours, floored to 10 minutes so every reader in the
 * same 10 minutes asks for the same URL and the edge answers it from cache.
 */
export function momentsFeedFrom(nowMs: number): number {
  return Math.floor((nowMs - MOMENTS_WINDOW_MS) / 600_000) * 600_000
}

async function readPage(nowMs: number, cursor: string | null, signal?: AbortSignal): Promise<MomentsFeedResponse> {
  const query = new URLSearchParams({ sort: 'new', from: String(momentsFeedFrom(nowMs)), limit: String(PAGE_LIMIT) })
  if (cursor) query.set('cursor', cursor)
  // The feed answers with public, max-age=30 and is edge-cached; the browser may reuse it too.
  const { data } = await apiClient<unknown>(`/v1/public/moments?${query}`, { signal, timeoutMs: 8000, maxResponseBytes: PAGE_BYTES, cache: 'default' })
  return feedPage(data)
}

/**
 * The last 12 hours, newest first, every page (at most MAX_PAGES). A cursor
 * that expires between pages (409: a new snapshot was published) starts the
 * read again once from the first page.
 */
export async function loadMomentsFeed(nowMs: number, signal?: AbortSignal): Promise<MomentsFeedSnapshot> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const first = await readPage(nowMs, null, signal)
      const items = [...first.items]
      let cursor = first.nextCursor
      for (let page = 1; cursor && page < MAX_PAGES; page += 1) {
        const next = await readPage(nowMs, cursor, signal)
        items.push(...next.items)
        cursor = next.nextCursor
      }
      return { items: dedupe(items), generatedAt: first.generatedAt, stale: first.stale }
    } catch (error) {
      if (attempt === 0 && isApiError(error) && error.status === 409) continue
      throw error
    }
  }
}

/** A poll: the newest page only. New and changed moments are merged into what the page holds. */
export async function pollMomentsFeed(nowMs: number, signal?: AbortSignal): Promise<MomentsFeedSnapshot> {
  const first = await readPage(nowMs, null, signal)
  return { items: first.items, generatedAt: first.generatedAt, stale: first.stale }
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

function dedupe(items: MomentsFeedItem[]): MomentsFeedItem[] {
  const seen = new Set<string>()
  return items.filter(item => (seen.has(item.id) ? false : (seen.add(item.id), true)))
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
