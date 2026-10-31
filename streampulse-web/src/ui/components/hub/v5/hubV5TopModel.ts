/**
 * Top moments today (D1 C1 F1 O1, 10-30; board artifacts/moments-top-today-20261030):
 * the hub's rail is always the day's strongest moments, the last 24 hours, up
 * to 20, strongest first. Pure functions over one of two sources, never both
 * in one list:
 *
 * - The Moments list (/v1/public/moments, where it is on and answers): its
 *   moments that hold up and rose (those with a ×), one per burst, by the
 *   feed's score, as Moments' Top shows them. Every figure is the feed's.
 * - Otherwise the hub's own moments, on streams live now (it sends up to 10):
 *   none older than 24 hours by the hub's clock (a long stream sends peaks
 *   from its whole session), none from a stream's first 20 minutes, only a
 *   ready × of 1.5 or more; a
 *   minute two channels counted the same emotes in is one row, one row per
 *   burst, strongest × first.
 */
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import { avatarImage, boxArtImage, checkMoment, clk, emoteImage, fx, topBursts, TOP_BURST_MS, when, type CheckedMoment } from '../../../../lib/momentsChecked'
import { momentsFeedFrom, type MomentsFeedCategoryFacet, type MomentsFeedSnapshot } from '../../../../lib/momentsFeed'
import type { MomentVodRef } from '../../../../lib/momentsFeedVod'
import type { PublicHub } from '../../../../lib/publicHub'
import { hubCategoryArt, momentRowsV5 } from './hubV5Model'

/** Rows the list shows. */
export const TOP_ROWS = 20
/** Moments read: enough that 20 remain after Top's bursts. */
export const TOP_READ = 50
/** "Today": the last 24 hours. */
export const TOP_DAY_MS = 24 * 60 * 60_000
/** A list read that failed leaves its last answer up, greyed, this long; then the hub's rows stand in. */
export const TOP_KEEP_MS = 15 * 60_000
/** Hub rows: none from a stream's first 20 minutes (too soon for its own average), and a ready × of at least 1.5. */
export const TOP_START_MIN = 20
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

/** "Every moment →": the Moments page's Top, on the picked game. */
export function topMomentsHref(gameId: string | null): string {
  const query = new URLSearchParams({ view: 'top' })
  if (gameId) query.set('game', gameId)
  return `/analytics/moments?${query}`
}

export interface TopEmote {
  name: string
  imageUrl: string | undefined
  count: number
}

/** One row, from either source; it names its moment as a VOD lookup does (momentVods). */
export interface TopRowData extends MomentVodRef {
  /** Lowercase. */
  login: string
  name: string
  /** The source's picture; the page's live channels fill a missing one. */
  avatar: string | null
  /** What rose. */
  kind: 'chat' | 'emotes'
  x: number
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
}

function feedRow(m: CheckedMoment): TopRowData {
  const item = m.item
  const emotes = item.topEmotes.slice(0, 3).map((e) => ({ name: e.name, imageUrl: emoteImage(e), count: e.count }))
  return {
    id: item.id, login: item.login.toLowerCase(), name: m.name, streamId: item.streamId, offsetSeconds: item.offsetSeconds,
    avatar: avatarImage(item) ?? null, kind: m.kind, x: m.rowX!, at: m.at,
    game: item.category?.name || null, art: boxArtImage(item) ?? null,
    emote: m.kind === 'emotes' ? emotes[0] ?? null : null, emotes,
    rate: item[m.kind].perMin, usual: m.kind === 'chat' ? m.baseC : m.baseE, viewers: item.viewers ?? null, live: item.streamLive,
    href: `/analytics/moments?${new URLSearchParams({ m: item.id })}`, also: [], checked: m,
  }
}

/** The Moments list's answer as rows: the moments that hold up and rose, one per burst, by the feed's score, at most 20. */
export function topFeedRows(snap: Pick<MomentsFeedSnapshot, 'items' | 'generatedAt'>): TopRowData[] {
  return topBursts(snap.items.map((item) => checkMoment(item, snap.generatedAt)).filter((m) => m.rowX != null))
    .slice(0, TOP_ROWS)
    .map(feedRow)
}

/** The hub's moments as rows, under the rules at the top of this file. */
export function hubTopRows(hub: Pick<PublicHub, 'liveChannels' | 'livePulseMoments' | 'generatedAt'> | null | undefined): TopRowData[] {
  if (!hub) return []
  const live = new Map(hub.liveChannels.map((c) => [c.login.toLowerCase(), c]))
  const art = hubCategoryArt(hub.livePulseMoments ?? [])
  // the last 24 hours by the answer's own clock (no clock: none left out)
  const from = Date.parse(hub.generatedAt) - TOP_DAY_MS
  const gated = momentRowsV5(hub.livePulseMoments ?? []).flatMap((row) => {
    const x = 'x' in row.cmp ? row.cmp.x : null
    return row.at != null && !(row.at < from) && (row.moment.offsetSeconds || 0) / 60 >= TOP_START_MIN && x != null && x >= TOP_MIN_X ? [{ row, x, at: row.at }] : []
  }).sort((a, b) => b.x - a.x || b.at - a.at)
  const kept: TopRowData[] = []
  const twins = new Map<string, TopRowData>()
  for (const { row, x, at } of gated) {
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
      avatar: m.profileImageUrl || c?.profileImageUrl || null, kind: row.series, x, at,
      game: m.category || null,
      art: m.categoryMetadataRejected ? null : m.boxArtUrl || (m.category ? art.get(m.category) ?? null : null),
      emote: top ? { name: row.topEmoteName ?? top.name, imageUrl: sanitizeEmoteImageUrl(top.imageUrl), count: top.count || 0 } : null, emotes,
      rate: row.rate, usual: 'x' in row.cmp ? row.cmp.avg : null, viewers: Number.isFinite(m.viewers) ? m.viewers! : null, live: !!c,
      href: row.href, also: [], checked: null,
    }
    if (counts) twins.set(twinKey, next)
    kept.push(next)
    if (kept.length === TOP_ROWS) break
  }
  return kept
}

/** A row's label; `open` null for the phone peek, whose rows open in the rail. */
export function topRowAria(row: TopRowData, rank: number, nowMs: number, open: boolean | null): string {
  const x = `${row.kind} ${fx(row.x).replace('×', ' times')} usual`
  const t = `${when(row.at, nowMs)}${nowMs - row.at < 60 * 60_000 ? ` at ${clk(row.at)}` : ''}`
  const act = open == null ? 'Open it in Top moments below' : `${open ? 'Hide' : 'Show'} ${row.checked ? 'the minutes around it' : 'its numbers and links'}`
  return `${rank}. ${row.name}${row.emote ? `, ${row.emote.name}` : ''}, ${x}${row.game ? `, ${row.game}` : ''}`
    + `${row.also.length ? `, the same emotes on ${row.also.join(', ')}` : ''}, ${t}. ${act}.`
}

/** 1100–1535 px: rows of 45 px that fit the column's `px` under the header, beside Picking up, "Show N more" and the footer. */
export function topColumnCap(px: number, up: boolean): number {
  return Math.max(3, Math.floor((px - (up ? 56 : 0) - 40 - 26) / 45))
}

/* ---------- the opened row's chart ---------- */

export interface TopCurve {
  w: number
  h: number
  /** Lines, one path each (a gap where a minute wasn't measured). */
  chat: string
  emotes: string
  /** The area under the moment's own series. */
  area: string
  /** The moment's minutes, shaded. */
  span: { x: number; w: number }
  /** The stream's usual for the moment's series, as a y, when known. */
  base: number | null
  /** The first and last minute drawn (epoch ms). */
  from: number
  to: number
}

const pt = (n: number) => Math.round(n * 10) / 10

/** The 25 minutes around the moment (the feed's spark), chat and emotes on one scale, with the moment's usual dashed. */
export function topCurve(m: CheckedMoment, w = 400, h = 64): TopCurve {
  const s = m.item.spark
  const n = Math.max(s.chat.length, s.emotes.length, 2)
  const usual = m.kind === 'chat' ? m.baseC : m.baseE
  const vals = [...s.chat, ...s.emotes, usual].filter((v): v is number => v != null && Number.isFinite(v))
  const max = Math.max(1, ...vals) * 1.08
  const X = (i: number) => (i / (n - 1)) * w
  const Y = (v: number) => h - (v / max) * h
  const runs = (a: Array<number | null>) => {
    const out: Array<Array<[number, number]>> = []
    let run: Array<[number, number]> = []
    a.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { if (run.length) out.push(run); run = []; return }
      run.push([pt(X(i)), pt(Y(v))])
    })
    if (run.length) out.push(run)
    return out
  }
  const line = (a: Array<number | null>) => runs(a).map((r) => r.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('')).join('')
  const area = runs(m.kind === 'chat' ? s.chat : s.emotes)
    .filter((r) => r.length > 1)
    .map((r) => `M${r[0]![0]},${h}${r.map(([x, y]) => `L${x},${y}`).join('')}L${r[r.length - 1]![0]},${h}Z`).join('')
  const s0 = s.spanStartIndex ?? s.momentIndex
  const s1 = Math.min(n - 1, s0 + Math.max(1, m.item.spanMinutes || 1) - 1)
  const x0 = Math.max(0, X(s0 - 0.5))
  const x1 = Math.min(w, X(s1 + 0.5))
  return {
    w, h, chat: line(s.chat), emotes: line(s.emotes), area,
    span: { x: pt(x0), w: pt(Math.max(2, x1 - x0)) },
    base: usual != null && Number.isFinite(usual) ? pt(Y(usual)) : null,
    from: m.at - s.momentIndex * 60_000,
    to: m.at + (n - 1 - s.momentIndex) * 60_000,
  }
}
