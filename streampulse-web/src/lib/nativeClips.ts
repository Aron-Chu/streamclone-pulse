import { apiClient, isApiError } from './apiClient'
import { isExactCategoryBoxArt } from './momentCategoryArtwork'

/**
 * GET /v1/public/clips, schemaVersion 1 (streampulse-backend
 * internal/analytics/public_native_clips.go): Twitch clips StreamPulse made
 * when chat reacted strongly. Twitch hosts every video. The backend sends each
 * clip's id, link and bounded facts it has checked against Twitch, and leaves
 * out a clip it can't vouch for. The portal draws them; it never re-ranks,
 * re-scores or proxies media.
 *
 * 404 while the backend's PULSE_NATIVE_CLIPS_CATALOGUE_ENABLED is off.
 */
export const NATIVE_CLIPS_SCHEMA_VERSION = 1
/** Ids in one saved-clips lookup (the backend refuses more). */
export const NATIVE_CLIPS_IDS_MAX = 50
export const NATIVE_CLIPS_SEARCH_MAX = 64

export type NativeClipsPeriod = '24h' | '7d' | '30d'
export type NativeClipsSort = 'newest' | 'views' | 'reaction'

export interface NativeClipChannel {
  id: string
  login: string
  displayName: string
  /** Twitch's profile picture; '' when there is none. */
  profileImageUrl: string
}

export interface NativeClipGame { id: string; name: string; boxArtUrl: string }

/** count is every use in the reaction's whole minutes. */
export interface NativeClipEmote { name: string; count: number }

export interface NativeClip {
  /** Twitch's clip id (its slug). */
  id: string
  /** The clip's page on Twitch. */
  url: string
  title: string
  /** Twitch's preview picture; '' when Twitch sent none. */
  thumbnailUrl: string
  durationSeconds: number
  /** Epoch ms. */
  createdAt: number
  channel: NativeClipChannel
  /** boxArtUrl is Twitch's own box art for the game, or '' (the page shows the name's first two letters). */
  game: NativeClipGame | null
  /** Lifetime views as last read from Twitch; null until the first read. */
  views: { count: number; checkedAt: number } | null
  /** offsetSeconds is null until Twitch places the clip in the VOD. */
  vod: { videoId: string; offsetSeconds: number | null } | null
  /**
   * How chat reacted when the clip was made, against that stream's usual pace.
   * topEmote is the emote chat used most in the reaction's minutes, or null.
   */
  reaction: { chatLift: number; emoteLift: number; chatters: number; largestShare: number; topEmote: NativeClipEmote | null }
  /** false once Twitch no longer has the clip (only a saved-clips lookup sends these). */
  available: boolean
}

/** Games are keyed by Twitch category id, channels by login. */
export interface NativeClipFacet { id: string; name: string; count: number }

export interface NativeClipsPage {
  generatedAt: number
  items: NativeClip[]
  /** The period's games and channels (after search, before the game filter), most clips first, at most 30. */
  games: NativeClipFacet[]
  channels: NativeClipFacet[]
  /** Clips in the period that match the search. */
  total: number
  /** ...and the game filter. */
  matching: number
  /** The library hit its row cap, so the oldest clips in the period are not listed. */
  truncated: boolean
  /** Most viewed only: clips left out because Twitch has not reported their views yet. */
  unranked: number
  /** The next page; null on the last one. */
  nextCursor: string | null
}

export interface NativeClipsQuery {
  period: NativeClipsPeriod
  sort: NativeClipsSort
  /** Twitch category id. */
  game?: string | null
  /** One channel's clips, by login. */
  channel?: string | null
  q?: string
  /** Spread channels so one busy channel doesn't fill the top (the backend's default). */
  mix: boolean
  cursor?: string | null
  /** Clips a page, 1–48 (the backend's default is 24). */
  limit?: number
}

const PAGE_BYTES = 512 * 1024
const CLIP_ID = /^[A-Za-z0-9_-]{1,256}$/
const THUMBNAIL_HOSTS = new Set(['static-cdn.jtvnw.net', 'clips-media-assets2.twitch.tv'])

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const plain = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
  && ![...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const time = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

export const validClipId = (id: unknown): id is string => typeof id === 'string' && CLIP_ID.test(id)

/** Twitch's own https link for this clip, or null. */
function clipUrl(raw: unknown, id: string): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash) return null
    if (u.hostname === 'clips.twitch.tv' && u.pathname === `/${id}`) return u.href
    const parts = u.pathname.split('/')
    return u.hostname === 'www.twitch.tv' && parts.length === 4 && parts[1] && parts[2] === 'clip' && parts[3] === id ? u.href : null
  } catch { return null }
}

/** An https picture on Twitch's image hosts, or ''. */
function twitchImage(raw: unknown, hosts: ReadonlySet<string>): string {
  if (typeof raw !== 'string' || !raw || raw.length > 1024) return ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && hosts.has(u.hostname) && !u.port && !u.username && !u.password ? u.href : ''
  } catch { return '' }
}

/** One clip as the backend sends it, or null (a malformed clip is left out, not the page). */
export function toNativeClip(value: unknown): NativeClip | null {
  if (!record(value) || !validClipId(value.id) || typeof value.available !== 'boolean') return null
  const url = clipUrl(value.url, value.id)
  const createdAt = time(value.createdAt)
  const { channel, reaction } = value
  if (!url || createdAt == null || !plain(value.title, 400) || !finite(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 120
    || !record(channel) || !plain(channel.id, 32) || !plain(channel.login, 25) || !channel.login || !plain(channel.displayName, 100)
    || !record(reaction) || !finite(reaction.chatLift) || !finite(reaction.emoteLift) || !finite(reaction.chatters) || !finite(reaction.largestShare)) return null
  const game = value.game == null ? null
    : record(value.game) && plain(value.game.id, 32) && value.game.id && plain(value.game.name, 150) && value.game.name
      ? { id: value.game.id, name: value.game.name, boxArtUrl: typeof value.game.boxArtUrl === 'string' && isExactCategoryBoxArt(value.game.boxArtUrl, value.game.id) ? value.game.boxArtUrl : '' }
      : undefined
  const views = value.views == null ? null
    : record(value.views) && finite(value.views.count) && value.views.count >= 0 && time(value.views.checkedAt) != null
      ? { count: Math.round(value.views.count), checkedAt: time(value.views.checkedAt)! } : undefined
  const vod = value.vod == null ? null
    : record(value.vod) && typeof value.vod.videoId === 'string' && /^[1-9]\d{0,29}$/.test(value.vod.videoId)
      && (value.vod.offsetSeconds == null || (finite(value.vod.offsetSeconds) && value.vod.offsetSeconds >= 0))
      ? { videoId: value.vod.videoId, offsetSeconds: value.vod.offsetSeconds == null ? null : Math.floor(value.vod.offsetSeconds as number) } : undefined
  if (game === undefined || views === undefined || vod === undefined) return null
  return {
    id: value.id, url, title: value.title.trim() || 'Untitled clip',
    thumbnailUrl: twitchImage(value.thumbnailUrl, THUMBNAIL_HOSTS), durationSeconds: value.durationSeconds, createdAt,
    channel: { id: channel.id, login: channel.login, displayName: channel.displayName || channel.login,
      profileImageUrl: twitchImage(channel.profileImageUrl, new Set(['static-cdn.jtvnw.net'])) },
    game, views, vod,
    reaction: { chatLift: reaction.chatLift, emoteLift: reaction.emoteLift, chatters: Math.max(0, Math.round(reaction.chatters)),
      largestShare: Math.min(1, Math.max(0, reaction.largestShare)), topEmote: topEmote(reaction.topEmote) },
    available: value.available,
  }
}

/** The reaction's top emote, or null: a malformed one is dropped, not the clip. */
function topEmote(v: unknown): NativeClipEmote | null {
  return record(v) && plain(v.name, 100) && v.name.trim() && finite(v.count) && v.count >= 1
    ? { name: v.name.trim(), count: Math.round(v.count) } : null
}

/** Uses, and emote pace against the stream's usual, before a headline calls the top emote a flood. */
const FLOOD_USES = 10
const FLOOD_EMOTE_LIFT = 1.5

/** 4.1, 4 (not 4.0), and whole numbers from 10 up. */
const liftText = (lift: number) => lift >= 10 ? String(Math.round(lift)) : lift.toFixed(1).replace(/\.0$/, '')

/**
 * StreamPulse's title for a clip, built from how chat reacted: "KEKW flood:
 * chat 4.1× faster, 2,300+ chatters". Twitch's own title (often the stream's
 * title, the same for every clip of a stream) stays in `title` and is shown
 * under it. Chatters is a lower bound, hence the "+". With nothing to say, it
 * is Twitch's title.
 */
export function clipHeadline(clip: Pick<NativeClip, 'title' | 'reaction'>): string {
  const r = clip.reaction
  const facts: string[] = []
  if (r.chatLift >= 1.1) facts.push(`chat ${liftText(r.chatLift)}× faster`)
  if (r.chatters >= 2) facts.push(`${r.chatters.toLocaleString()}+ chatters`)
  const emote = r.topEmote && r.topEmote.count >= FLOOD_USES && r.emoteLift >= FLOOD_EMOTE_LIFT ? r.topEmote.name : null
  if (!facts.length) return emote ? `${emote} flood in chat` : clip.title
  const text = facts.join(', ')
  return emote ? `${emote} flood: ${text}` : text[0].toUpperCase() + text.slice(1)
}

const facets = (v: unknown): NativeClipFacet[] => Array.isArray(v)
  ? v.flatMap(f => record(f) && plain(f.id, 32) && f.id && plain(f.name, 150) && f.name && finite(f.count) && f.count > 0
    ? [{ id: f.id, name: f.name, count: f.count }] : [])
  : []

function schema(data: unknown): Record<string, unknown> & { items: unknown[]; generatedAt: number } {
  const generatedAt = record(data) ? time(data.generatedAt) : null
  if (!record(data) || data.schemaVersion !== NATIVE_CLIPS_SCHEMA_VERSION || !Array.isArray(data.items) || generatedAt == null) {
    throw { kind: 'bad_request', message: 'Unexpected clips shape', status: 200, code: 'schema' }
  }
  return { ...data, items: data.items, generatedAt }
}

function unique(items: unknown[]): NativeClip[] {
  const seen = new Set<string>()
  return items.flatMap(item => {
    const clip = toNativeClip(item)
    if (!clip || seen.has(clip.id)) return []
    seen.add(clip.id)
    return [clip]
  })
}

/** The query string for one page. Defaults are left out so every reader of the same view asks for the same URL. */
export function nativeClipsSearch(query: NativeClipsQuery): string {
  const params = new URLSearchParams({ period: query.period, sort: query.sort })
  if (query.game) params.set('game', query.game)
  if (query.channel) params.set('channel', query.channel.toLowerCase())
  const q = (query.q ?? '').trim().toLowerCase().slice(0, NATIVE_CLIPS_SEARCH_MAX)
  if (q) params.set('q', q)
  if (!query.mix) params.set('mix', '0')
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit && query.limit !== 24) params.set('limit', String(Math.min(48, Math.max(1, Math.round(query.limit)))))
  return params.toString()
}

/** One page of the library. The backend rebuilds it at most once a minute; the browser may reuse an answer that long. */
export async function loadNativeClips(query: NativeClipsQuery, signal?: AbortSignal): Promise<NativeClipsPage> {
  const { data } = await apiClient<unknown>(`/v1/public/clips?${nativeClipsSearch(query)}`, { signal, timeoutMs: 8000, maxResponseBytes: PAGE_BYTES, cache: 'default' })
  const body = schema(data)
  const scope = record(body.scope) ? body.scope : {}
  const facetsBody = record(body.facets) ? body.facets : {}
  const items = unique(body.items)
  const count = (v: unknown, fallback: number) => finite(v) && v >= 0 ? Math.round(v) : fallback
  return {
    generatedAt: body.generatedAt, items, games: facets(facetsBody.games), channels: facets(facetsBody.channels),
    total: count(scope.total, items.length), matching: count(scope.matching, items.length), truncated: scope.truncated === true,
    unranked: record(body.unranked) ? count(body.unranked.count, 0) : 0,
    nextCursor: typeof body.nextCursor === 'string' && /^[1-9]\d{0,5}$/.test(body.nextCursor) ? body.nextCursor : null,
  }
}

/**
 * Saved clips by id, in the order asked. A clip the library no longer lists is
 * simply absent. What someone saved is theirs: neither the backend nor the
 * browser keeps these answers.
 */
export async function lookupNativeClips(ids: readonly string[], signal?: AbortSignal): Promise<NativeClip[]> {
  const wanted = [...new Set(ids.filter(validClipId))]
  const found = new Map<string, NativeClip>()
  for (let i = 0; i < wanted.length; i += NATIVE_CLIPS_IDS_MAX) {
    const params = new URLSearchParams({ ids: wanted.slice(i, i + NATIVE_CLIPS_IDS_MAX).join(',') })
    const { data } = await apiClient<unknown>(`/v1/public/clips?${params}`, { signal, timeoutMs: 8000, maxResponseBytes: PAGE_BYTES, cache: 'no-store' })
    for (const clip of unique(schema(data).items)) found.set(clip.id, clip)
  }
  return wanted.flatMap(id => found.get(id) ?? [])
}

/** The library isn't switched on yet (the backend answers 404 while its flag is off). */
export const clipsNotOn = (error: unknown) => isApiError(error) && error.status === 404

/** Twitch's clip player. `parent` is this page's host, as Twitch requires. */
export function clipEmbedSrc(id: string, host: string): string {
  return `https://clips.twitch.tv/embed?${new URLSearchParams({ clip: id, parent: host, autoplay: 'true' })}`
}

/** The clip's place in its VOD on Twitch, once Twitch has placed it. */
export function clipVodHref(clip: Pick<NativeClip, 'vod'>): string | null {
  const offset = clip.vod?.offsetSeconds
  if (!clip.vod || offset == null) return null
  return `https://www.twitch.tv/videos/${clip.vod.videoId}?t=${Math.floor(offset / 3600)}h${Math.floor((offset % 3600) / 60)}m${offset % 60}s`
}

const NEW_MS = 6 * 3_600_000
/** Made in the last 6 hours: the card says New. */
export const isNewClip = (clip: Pick<NativeClip, 'createdAt'>, now = Date.now()) => now - clip.createdAt >= 0 && now - clip.createdAt < NEW_MS

/** The clip's own page on this site. */
export const clipPagePath = (id: string) => `/analytics/clips/${encodeURIComponent(id)}`
