/**
 * Top moments (F1, 10-25): where the Moments list is on, the hub's feed is one
 * ranked list of that list's moments over a window you pick (1 h, 6 h, 24 h,
 * 7 d), strongest first or newest first, one game at a time. Pure functions
 * over /v1/public/moments pages: every figure is the feed's, nothing is scored
 * here, and both orders keep the Moments page's own rules.
 *
 * - Top: the moments that hold up and rose (those with a ×), one per burst,
 *   by the feed's score, as Moments' Top shows them.
 * - Latest: every moment that holds up or partly does, newest first, as
 *   Moments' Latest shows them.
 */
import { boxArtImage, checkMoment, clk, fx, SORTS, topBursts, type CheckedMoment } from '../../../../lib/momentsChecked'
import type { MomentsFeedCategoryFacet, MomentsFeedSnapshot } from '../../../../lib/momentsFeed'

export type TopWindowKey = '1h' | '6h' | '24h' | '7d'
export type TopSort = 'top' | 'new'
export interface TopWindow {
  key: TopWindowKey
  /** The tab's label. */
  short: string
  /** "the last 6 hours" */
  words: string
  ms: number
}

const HOUR = 60 * 60_000
export const TOP_WINDOWS: readonly TopWindow[] = [
  { key: '1h', short: '1 h', words: 'the last hour', ms: HOUR },
  { key: '6h', short: '6 h', words: 'the last 6 hours', ms: 6 * HOUR },
  { key: '24h', short: '24 h', words: 'the last 24 hours', ms: 24 * HOUR },
  { key: '7d', short: '7 d', words: 'the last 7 days', ms: 7 * 24 * HOUR },
]
export const TOP_DEFAULT_WINDOW: TopWindowKey = '24h'
/** Rows the list shows. */
export const TOP_ROWS = 20
/** Moments read for a window: enough that 20 remain after Top's checks and bursts. */
export const TOP_READ = 50
/** Under this many rows the list offers the next window up. */
export const TOP_FEW = 10

export const topWindow = (key: TopWindowKey): TopWindow => TOP_WINDOWS.find((w) => w.key === key) ?? TOP_WINDOWS[2]!
export function topNextWindow(key: TopWindowKey): TopWindow | null {
  const i = TOP_WINDOWS.findIndex((w) => w.key === key)
  return TOP_WINDOWS[i + 1] ?? null
}

/** `from` for a window, floored to the minute so readers in the same minute ask for the same URL (the edge caches it). */
export function topFrom(nowMs: number, key: TopWindowKey): number {
  return Math.floor((nowMs - topWindow(key).ms) / 60_000) * 60_000
}

/** The window's moments as the list shows them, at most 20 (see the top of this file). */
export function topRows(items: MomentsFeedSnapshot['items'], sort: TopSort, nowMs: number): CheckedMoment[] {
  const all = items.map((item) => checkMoment(item, nowMs))
  const rows = sort === 'top'
    ? topBursts(all.filter((m) => m.rowX != null))
    : all.filter((m) => m.item.verdict !== 'bad').sort(SORTS.new)
  return rows.slice(0, TOP_ROWS)
}

/** A window's count on its tab: the moments that hold up or partly do (what Latest can show); the feed's total when it sends no verdicts. */
export function topCount(snap: Pick<MomentsFeedSnapshot, 'total' | 'verdicts'>): number {
  return snap.verdicts ? snap.verdicts.ok + snap.verdicts.warn : snap.total
}

export interface TopGame {
  id: string
  name: string
  art: string | null
  /** The window's moments in that game, every verdict counted (the feed's facet). */
  moments: number
}

/**
 * The window's games for the chips, most moments first, as the feed's facets
 * send them. `keep` (the picked game) stays listed with 0 after a new window
 * leaves it none, so the pick can still be cleared.
 */
export function topGames(categories: readonly MomentsFeedCategoryFacet[] | null | undefined, keep: TopGame | null = null): TopGame[] {
  const games = (categories ?? [])
    .filter((c) => c.moments > 0)
    .map((c) => ({ id: c.id, name: c.name, art: boxArtImage({ category: c }) ?? null, moments: c.moments }))
  if (keep && !games.some((g) => g.id === keep.id)) games.push({ ...keep, moments: 0 })
  return games
}

/** A row's time on the right: "now", "13m", "2h", "3d". */
export function topAgo(at: number, nowMs: number): string {
  const m = Math.max(0, Math.floor((nowMs - at) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/** "see all": the Moments page in the same order, on the picked game. */
export function topMomentsHref(sort: TopSort, gameId: string | null): string {
  const query = new URLSearchParams()
  if (sort === 'top') query.set('view', 'top')
  if (gameId) query.set('game', gameId)
  const q = query.toString()
  return q ? `/analytics/moments?${q}` : '/analytics/moments'
}

/** The emote a row names: the minute's top emote, for an emote moment. */
export const topEmote = (m: CheckedMoment) => (m.kind === 'emotes' ? m.item.topEmotes[0] ?? null : null)

function agoWords(at: number, nowMs: number): string {
  const m = Math.max(0, Math.floor((nowMs - at) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} ${h === 1 ? 'hour' : 'hours'} ago` : `${Math.floor(h / 24)} ${Math.floor(h / 24) === 1 ? 'day' : 'days'} ago`
}

export function topRowAria(m: CheckedMoment, rank: number | null, nowMs: number, open: boolean): string {
  const emote = topEmote(m)
  const x = m.rowX != null ? `${m.kind} ${fx(m.rowX).replace('×', ' times')} usual` : m.why
  const cat = m.item.category?.name
  return `${rank != null ? `${rank}. ` : ''}${m.name}${emote ? `, ${emote.name}` : ''}${x ? `, ${x}` : ''}${cat ? `, ${cat}` : ''}, ${agoWords(m.at, nowMs)} at ${clk(m.at)}. ${open ? 'Hide' : 'Show'} the minutes around it.`
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
