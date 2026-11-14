/**
 * Top moments today (D1 C1 F1 O1, 10-30; board artifacts/moments-top-today-20261030):
 * the hub's rail is always the day's strongest moments, the last 24 hours, up
 * to 20, strongest first. Pure functions over one of two sources, never both
 * in one list:
 *
 * - The Moments list (/v1/public/moments, where it is on and answers): its
 *   moments that hold up and rose (those with a ×), one per burst, by the
 *   feed's score, as Moments' Top shows them. Every figure is the feed's.
 * - Otherwise the hub's own moments (it sends its latest 10, on streams live now):
 *   none older than 24 hours by the hub's clock (a long stream sends peaks
 *   from its whole session), only a ready × of 1.5 or more; a
 *   minute two channels counted the same emotes in is one row, one row per
 *   burst, strongest × first. The hub sends only its latest 10, so the page
 *   keeps the rows it was sent earlier in the day (topDayRows, 11-02): a
 *   moment stays after the hub moves on or its stream ends.
 *   Carousel fill (board 2A, deep audit 11-02): a moment from a stream's first
 *   20 minutes, or one whose counts and comparison disagree (the backend's
 *   minute off-by-one), stays, with its rate and no × (`plain`), after the
 *   rows with one. Under 10, each other channel's busiest minute from the
 *   chart's hub/moments reads fills in (busiestFillRows): "Busiest minute",
 *   never a spike.
 */
import { compareStreamEdgeLast, formatLiftRatio, streamEdgeLabel, type StreamEdgeKind } from '@streampulse/pulse-core'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import { avatarImage, boxArtImage, checkMoment, clk, EARLY_STREAM_MIN, EARLY_STREAM_WORDS, earlyInStream, edgeFlag, emoteImage, feedStreamEnds, int, momentEdge, topBursts, TOP_BURST_MS, when, type CheckedMoment } from '../../../../lib/momentsChecked'
import { momentsFeedFrom, type MomentsFeedCategoryFacet, type MomentsFeedSnapshot } from '../../../../lib/momentsFeed'
import type { MomentVodRef } from '../../../../lib/momentsFeedVod'
import type { HubLivePulseMoment, PublicHub } from '../../../../lib/publicHub'
import { hubCategoryArt, momentHref, momentRowKey, momentRowsV5 } from './hubV5Model'

/** Rows the list shows. */
export const TOP_ROWS = 20
/** Moments read: enough that 20 remain after Top's bursts. */
export const TOP_READ = 50
/** "Today": the last 24 hours. */
export const TOP_DAY_MS = 24 * 60 * 60_000
/** A list read that failed leaves its last answer up, greyed, this long; then the hub's rows stand in. */
export const TOP_KEEP_MS = 15 * 60_000
/** Hub rows: none from a stream's first 20 minutes (too soon for its own average), and a ready × of at least 1.5. The 20 minutes are the shared early rule (X1, 11-13). */
export const TOP_START_MIN = EARLY_STREAM_MIN
export const TOP_MIN_X = 1.5

/** `from` for the last 24 hours, floored to 10 minutes so readers in the same 10 minutes share one cached URL. */
export const topFrom = (nowMs: number) => momentsFeedFrom(nowMs, TOP_DAY_MS)

/** The day's moments that hold up (the footer's "of M"); the feed's total when it sends no verdicts. */
export function topCount(snap: Pick<MomentsFeedSnapshot, 'total' | 'verdicts'>): number {
  return snap.verdicts ? snap.verdicts.ok : snap.total
}

export interface TopGame {
  id: string
  name: string
  art: string | null
  /** The day's moments in that game that hold up (the feed's facet, read with verdict=ok). */
  moments: number
}

/**
 * The day's games for the chips, most moments first, as the feed's facets send
 * them. `keep` (the picked game) stays listed with 0 after a read leaves it
 * none, so the pick can still be cleared.
 */
export function topGames(categories: readonly MomentsFeedCategoryFacet[] | null | undefined, keep: TopGame | null = null): TopGame[] {
  const games = (categories ?? [])
    .filter((c) => c.moments > 0)
    .map((c) => ({ id: c.id, name: c.name, art: boxArtImage({ category: c }) ?? null, moments: c.moments }))
  if (keep && !games.some((g) => g.id === keep.id)) games.push({ ...keep, moments: 0 })
  return games
}

/** Cards the carousel fills up to with busiest minutes (board 2A: 5–10). */
export const TOP_FILL_TO = 10

/** "All moments →": the Moments page (it has no Top view yet), on the picked game by name (its category filter). */
export function topMomentsHref(gameName: string | null): string {
  return gameName ? `/analytics/moments?${new URLSearchParams({ category: gameName })}` : '/analytics/moments'
}

export interface TopEmote {
  name: string
  imageUrl: string | undefined
  count: number
}

/**
 * Why a row shows its rate and no ×: 'early', a stream's first 20 minutes (too
 * soon for its own average); 'unmatched', the moment's counts and its
 * comparison's disagree; 'busiest', a channel's busiest minute from the chart's
 * reads (a fill, not a spike).
 */
export type TopPlain = 'early' | 'unmatched' | 'busiest'

/** One row, from either source; it names its moment as a VOD lookup does (momentVods). */
export interface TopRowData extends MomentVodRef {
  /** Lowercase. */
  login: string
  name: string
  /** The source's picture; the page's live channels fill a missing one. */
  avatar: string | null
  /** What rose. */
  kind: 'chat' | 'emotes'
  /** The × against the usual; null for a `plain` row. */
  x: number | null
  /** Why it shows no ×; null for a row with one. */
  plain: TopPlain | null
  /** Epoch ms of the moment's minute. */
  at: number
  game: string | null
  art: string | null
  /** The minute's top emote, for an emote moment. */
  emote: TopEmote | null
  /** Its top emotes, at most 3, for the opened row. */
  emotes: TopEmote[]
  /** The moment's series a minute, and the usual the × compares it with. */
  rate: number | null
  usual: number | null
  viewers: number | null
  /** The stream is still live. */
  live: boolean
  /** Opens the moment in Moments. */
  href: string
  /** Other channels that counted the same emotes in the same minute, folded into this row. */
  also: string[]
  /** The Moments list's moment, with the minutes around it; null for a hub row. */
  checked: CheckedMoment | null
  /**
   * Its stream edge (E1, 11-13): the backend's flag when the data carries one,
   * else a stream's first 5 minutes or, once an ended stream's chat has
   * stopped, its last 10 (topEdge). Unset: worked out from the offset.
   */
  edge?: StreamEdgeKind | null
}

function feedRow(m: CheckedMoment, ends: ReadonlyMap<string, number>): TopRowData {
  const item = m.item
  const emotes = item.topEmotes.slice(0, 3).map((e) => ({ name: e.name, imageUrl: emoteImage(e), count: e.count }))
  return {
    id: item.id, login: item.login.toLowerCase(), name: m.name, streamId: item.streamId, offsetSeconds: item.offsetSeconds,
    avatar: avatarImage(item) ?? null, kind: m.kind, x: m.rowX!, plain: null, at: m.at,
    game: item.category?.name || null, art: boxArtImage(item) ?? null,
    emote: m.kind === 'emotes' ? emotes[0] ?? null : null, emotes,
    rate: item[m.kind].perMin, usual: m.kind === 'chat' ? m.baseC : m.baseE, viewers: item.viewers ?? null, live: item.streamLive,
    href: `/analytics/moments?${new URLSearchParams({ m: item.id })}`, also: [], checked: m,
    edge: momentEdge(item.offsetSeconds, item.streamEdge, ends.get(`${item.login.toLowerCase()}|${item.streamId}`)) ?? null,
  }
}

/**
 * The Moments list's answer as rows: the moments that hold up and rose, one
 * per burst, by the feed's score, with a stream's edge minutes after the rest
 * (E1), at most 20. An ended stream's last 10 minutes are its edge once a
 * moment's minutes show where its chat stopped (feedStreamEnds).
 */
export function topFeedRows(snap: Pick<MomentsFeedSnapshot, 'items' | 'generatedAt'>): TopRowData[] {
  const ends = feedStreamEnds(snap.items)
  return topBursts(snap.items.map((item) => checkMoment(item, snap.generatedAt)).filter((m) => m.rowX != null))
    .map((m) => feedRow(m, ends))
    .sort((a, b) => compareStreamEdgeLast({ streamEdge: a.edge }, { streamEdge: b.edge }))
    .slice(0, TOP_ROWS)
}

/**
 * A row's stream edge (E1, 11-13, pulse-core's rule): the one it carries (the
 * backend's flag, or an ended stream's last 10 minutes), else a stream's first
 * 5 minutes by its offset.
 */
export function topEdge(row: { offsetSeconds?: number | null; edge?: StreamEdgeKind | null }): StreamEdgeKind | undefined {
  if (row.edge !== undefined) return row.edge ?? undefined
  return row.offsetSeconds == null ? undefined : momentEdge(row.offsetSeconds, undefined)
}

type Ordered = Pick<TopRowData, 'x' | 'rate' | 'at'> & Partial<Pick<TopRowData, 'offsetSeconds' | 'edge'>>
/** The list's order: a stream's edge minutes last (E1); rows with a × first, strongest first; then the rest by their rate; the newer first on a tie. */
export function topOrder(a: Ordered, b: Ordered): number {
  const edge = compareStreamEdgeLast({ streamEdge: topEdge(a) }, { streamEdge: topEdge(b) })
  if (edge) return edge
  if ((a.x == null) !== (b.x == null)) return a.x == null ? 1 : -1
  return (a.x != null && b.x != null ? b.x - a.x : (b.rate ?? 0) - (a.rate ?? 0)) || b.at - a.at
}

/**
 * The hub's rows now with the day's rows it sent before (`kept`), as the list
 * shows them: none older than 24 hours by `nowMs`, one row per burst (the hub's
 * latest answer wins), in topOrder, at most TOP_ROWS. A kept row is live
 * while its channel is in the hub's live channels (`live`, lowercase logins).
 */
export function topDayRows(kept: readonly TopRowData[], fresh: readonly TopRowData[], live: ReadonlySet<string>, nowMs: number): TopRowData[] {
  const from = nowMs - TOP_DAY_MS
  const rows = [...fresh]
  const ids = new Set(fresh.map((r) => r.id))
  for (const r of kept) {
    if (ids.has(r.id) || !(r.at >= from) || r.at > nowMs + 60_000) continue
    if (rows.some((k) => k.login === r.login && k.streamId === r.streamId && Math.abs(k.at - r.at) < TOP_BURST_MS)) continue
    ids.add(r.id)
    rows.push({ ...r, live: live.has(r.login) })
  }
  return rows.sort(topOrder).slice(0, TOP_ROWS)
}

const str = (v: unknown): v is string => typeof v === 'string'
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const orNull = <T,>(v: unknown, ok: (v: unknown) => v is T): T | null => (ok(v) ? v : null)
function keptEmote(v: unknown): TopEmote | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  return str(e.name) && num(e.count) ? { name: e.name, imageUrl: sanitizeEmoteImageUrl(str(e.imageUrl) ? e.imageUrl : undefined), count: e.count } : null
}

/** Rows saved with topDayRows' answer (JSON), checked field by field; anything else is dropped. Saved rows are never live. */
export function topDayParse(raw: unknown): TopRowData[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, TOP_ROWS).flatMap((v): TopRowData[] => {
    if (!v || typeof v !== 'object') return []
    const r = v as Record<string, unknown>
    if (!str(r.id) || !str(r.login) || !str(r.name) || !num(r.at) || !str(r.href) || !/^\/analytics\/[a-z]/.test(r.href)) return []
    if (r.kind !== 'chat' && r.kind !== 'emotes') return []
    // a row has its × or says why not (a busiest-minute fill is never kept)
    const plain = r.plain === 'early' || r.plain === 'unmatched' ? r.plain : null
    if (num(r.x) ? r.plain != null : plain == null) return []
    return [{
      id: r.id, login: r.login.toLowerCase(), name: r.name, streamId: str(r.streamId) ? r.streamId : '',
      offsetSeconds: num(r.offsetSeconds) ? r.offsetSeconds : 0, avatar: orNull(r.avatar, str), kind: r.kind, x: orNull(r.x, num), plain, at: r.at,
      game: orNull(r.game, str), art: orNull(r.art, str), emote: keptEmote(r.emote),
      emotes: Array.isArray(r.emotes) ? r.emotes.flatMap((e) => keptEmote(e) ?? []).slice(0, 3) : [],
      rate: orNull(r.rate, num), usual: orNull(r.usual, num), viewers: orNull(r.viewers, num), live: false,
      href: r.href, also: Array.isArray(r.also) ? r.also.filter(str) : [], checked: null,
      ...(r.edge === null || edgeFlag(r.edge) ? { edge: edgeFlag(r.edge) ?? null } : {}),
    }]
  })
}

/** The hub's moments as rows, under the rules at the top of this file. */
export function hubTopRows(hub: Pick<PublicHub, 'liveChannels' | 'livePulseMoments' | 'generatedAt'> | null | undefined): TopRowData[] {
  if (!hub) return []
  const live = new Map(hub.liveChannels.map((c) => [c.login.toLowerCase(), c]))
  const art = hubCategoryArt(hub.livePulseMoments ?? [])
  // the last 24 hours by the answer's own clock (no clock: none left out)
  const from = Date.parse(hub.generatedAt) - TOP_DAY_MS
  type Gated = { row: (typeof rows)[number]; x: number | null; plain: TopPlain | null; at: number; rate: number | null; offsetSeconds: number; edge: StreamEdgeKind | null }
  const rows = momentRowsV5(hub.livePulseMoments ?? [])
  const gated = rows.flatMap((row): Gated[] => {
    if (row.at == null || row.at < from) return []
    const x = 'x' in row.cmp ? row.cmp.x : null
    const at = row.at
    const offsetSeconds = row.moment.offsetSeconds || 0
    // a stream's first 20 minutes, or a minute whose two counts disagree: its rate, no ×
    const plain: TopPlain | null = earlyInStream(offsetSeconds) ? 'early'
      : 'why' in row.cmp && row.cmp.why === 'not compared' ? 'unmatched' : null
    // the backend's edge flag wins; its streams are live, so no closing edge of its own (E1)
    const edge = momentEdge(offsetSeconds, row.moment.streamEdge) ?? null
    if (plain) return row.rate != null ? [{ row, x: null, plain, at, rate: row.rate, offsetSeconds, edge }] : []
    return x != null && x >= TOP_MIN_X ? [{ row, x, plain, at, rate: row.rate, offsetSeconds, edge }] : []
  }).sort(topOrder)
  const kept: TopRowData[] = []
  const twins = new Map<string, TopRowData>()
  for (const { row, x, plain, at, edge } of gated) {
    const m = row.moment
    const login = row.login.toLowerCase()
    const c = live.get(login)
    const streamId = m.streamId || c?.streamId || ''
    // a minute two channels counted the same emotes in is one row, under the stronger ×
    const counts = (m.topEmotes ?? []).map((e) => `${e.name}:${e.count}`).join('|')
    const twinKey = `${Math.floor(at / 60_000)}|${counts}`
    const twin = counts ? twins.get(twinKey) : undefined
    if (twin) {
      if (twin.login !== login && !twin.also.includes(row.displayName)) twin.also.push(row.displayName)
      continue
    }
    // one row per burst: the stream's strongest minute within 5 minutes
    if (kept.some((k) => k.login === login && k.streamId === streamId && Math.abs(k.at - at) < TOP_BURST_MS)) continue
    const emotes = (m.topEmotes ?? []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3)
      .map((e) => ({ name: e.name, imageUrl: sanitizeEmoteImageUrl(e.imageUrl), count: e.count || 0 }))
    const top = row.series === 'emotes' && row.topEmote ? row.topEmote : null
    const next: TopRowData = {
      id: row.key, login, name: row.displayName, streamId, offsetSeconds: m.offsetSeconds || 0,
      avatar: m.profileImageUrl || c?.profileImageUrl || null, kind: row.series, x, plain, at,
      game: m.category || null,
      art: m.categoryMetadataRejected ? null : m.boxArtUrl || (m.category ? art.get(m.category) ?? null : null),
      emote: top ? { name: row.topEmoteName ?? top.name, imageUrl: sanitizeEmoteImageUrl(top.imageUrl), count: top.count || 0 } : null, emotes,
      rate: row.rate, usual: x != null && 'x' in row.cmp ? row.cmp.avg : null, viewers: Number.isFinite(m.viewers) ? m.viewers! : null, live: !!c,
      href: row.href, also: [], checked: null, edge,
    }
    if (counts) twins.set(twinKey, next)
    kept.push(next)
    if (kept.length === TOP_ROWS) break
  }
  return kept
}

/**
 * Each other channel's busiest minute in the chart's hub/moments reads
 * (`moments`), within the 24 hours to `nowMs`, as rows after `shown`: one per
 * channel, none for a channel `shown` has, the most chat a minute first, up to
 * TOP_FILL_TO rows in all. The backend ranks these by size alone and sends no
 * comparison, so they carry no ×. Live while the channel is in `live`.
 */
export function busiestFillRows(
  moments: readonly HubLivePulseMoment[],
  shown: readonly Pick<TopRowData, 'login'>[],
  live: ReadonlyMap<string, { profileImageUrl?: string }>,
  nowMs: number,
): TopRowData[] {
  const room = TOP_FILL_TO - shown.length
  if (room <= 0) return []
  const from = nowMs - TOP_DAY_MS
  const taken = new Set(shown.map((r) => r.login))
  const best = new Map<string, HubLivePulseMoment & { login: string; at: number; chatPerMin: number }>()
  for (const m of moments) {
    if (!m || !str(m.login) || !m.login || !num(m.at) || !num(m.chatPerMin) || m.chatPerMin <= 0) continue
    if (m.at < from || m.at > nowMs + 60_000) continue
    const login = m.login.toLowerCase()
    if (taken.has(login)) continue
    const prev = best.get(login)
    if (!prev || m.chatPerMin > prev.chatPerMin || (m.chatPerMin === prev.chatPerMin && m.at > prev.at)) {
      best.set(login, m as HubLivePulseMoment & { login: string; at: number; chatPerMin: number })
    }
  }
  return [...best.entries()]
    .sort(([, a], [, b]) => b.chatPerMin - a.chatPerMin || b.at - a.at)
    .slice(0, room)
    .map(([login, m]): TopRowData => ({
      id: `busiest|${momentRowKey(m)}`, login, name: m.displayName || m.login, streamId: m.streamId || '', offsetSeconds: m.offsetSeconds || 0,
      avatar: m.profileImageUrl || live.get(login)?.profileImageUrl || null, kind: 'chat', x: null, plain: 'busiest', at: m.at,
      game: m.category || null, art: m.categoryMetadataRejected ? null : m.boxArtUrl || null, emote: null,
      emotes: (m.topEmotes ?? []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3)
        .map((e) => ({ name: e.name, imageUrl: sanitizeEmoteImageUrl(e.imageUrl), count: e.count || 0 })),
      rate: m.chatPerMin, usual: null, viewers: num(m.viewers) ? m.viewers : null, live: live.has(login),
      href: momentHref(m), also: [], checked: null, edge: momentEdge(m.offsetSeconds || 0, m.streamEdge) ?? null,
    }))
}

/** What a plain row says in place of its × ("Busiest minute", "Early in the stream", "Not compared"). */
export const topPlainLabel = (plain: TopPlain) => (plain === 'busiest' ? 'Busiest minute' : plain === 'early' ? EARLY_STREAM_WORDS : 'Not compared')

/** A plain row's reason; an early row in its stream's first 5 minutes is tagged 'Stream start' (E1, 11-13). */
export function topRowWhy(row: Pick<TopRowData, 'plain'> & Partial<Pick<TopRowData, 'offsetSeconds' | 'edge'>>): string | null {
  if (!row.plain) return null
  const edge = row.plain === 'early' ? topEdge(row) : undefined
  return edge ? streamEdgeLabel(edge) : topPlainLabel(row.plain)
}

/** The quiet tag on a row with a × in its stream's edge: 'Stream end' for an ended stream's last 10 minutes (E1, round 2). */
export function topEdgeTag(row: Pick<TopRowData, 'x'> & Partial<Pick<TopRowData, 'offsetSeconds' | 'edge'>>): string | null {
  if (row.x == null) return null
  const edge = topEdge(row)
  return edge ? streamEdgeLabel(edge) : null
}

/** What rose, for a label: "6.2 times more chat" (Z06: one wording), or "Busiest minute, 1,204 chat a minute". */
export function topFigureWords(row: Pick<TopRowData, 'kind' | 'x' | 'plain' | 'rate'> & Partial<Pick<TopRowData, 'offsetSeconds' | 'edge'>>): string {
  if (row.x != null) {
    const tag = topEdgeTag(row)
    return `${tag ? `${tag}, ` : ''}${formatLiftRatio(row.x)} times more ${row.kind}`
  }
  const why = topRowWhy(row)
  return `${why ? `${why}, ` : ''}${int(row.rate)} ${row.kind} a minute`
}

/** A row's label; `open` null for the phone peek, whose rows open in the rail. */
export function topRowAria(row: TopRowData, rank: number, nowMs: number): string {
  const x = topFigureWords(row)
  const t = `${when(row.at, nowMs)}${nowMs - row.at < 60 * 60_000 ? ` at ${clk(row.at)}` : ''}`
  return `${rank}. ${row.name}${row.emote ? `, ${row.emote.name}` : ''}, ${x}${row.game ? `, ${row.game}` : ''}`
    + `${row.also.length ? `, the same emotes on ${row.also.join(', ')}` : ''}, ${t}. Open it in Top moments below.`
}
