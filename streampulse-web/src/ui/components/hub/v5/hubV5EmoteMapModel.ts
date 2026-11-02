/**
 * The emote map (R5-13, re-done as r4 A2 on 2026-10-21, then restyled the
 * same day as r5 C1 quiet tiles and r6 D2 field frames; mockups
 * emotemap-moments-r4, emotemap-r5, emotemap-r6): a treemap in three framed
 * provider fields, a tile's size the emote's uses and its picture the hero,
 * with a ranked list under it where the last hour against its
 * own pace shows as a change chip. Since the 10-22 board (Z1, K1) every emote
 * has a tile, the map zooms, and a tile's fill shows that pace too.
 * Data: each closed activity interval's top 10 emotes with their counts
 * (activity.points[].topEmotes), added up per emote, so uses outside an emote's
 * top-10 intervals are not in it. Every size, share and pace here is a sum of
 * those sent counts; nothing is estimated.
 * Since the 10-30 board (W1, C1) chips re-cut the same counts to a shorter
 * window, and a selected emote shows them per interval with its busiest one,
 * whose streams one hub/moments read lists.
 */
import type { HubActivityPoint, HubBucketEmote, HubLivePulseMoment } from '../../../../lib/publicHub'
import { formatHubInt, hubClockRange } from './hubV5Model'

export interface HubEmoteAgg {
  id: string
  e: HubBucketEmote
  prov: string
  /** Uses over the whole window (while in a top 10). */
  c24: number
  /** Uses in the last hour (while in a top 10). */
  c1h: number
  /** Intervals it made a top 10 in. */
  n: number
  peak: number
  peakT: number
  /** The last hour against its own pace over the window, both counted the same way. */
  pace: number
  /** In a top 10 this hour and never before it. */
  isNew: boolean
  /** Its count in each interval it made a top 10 in, oldest first: the chips and the timeline cut these. */
  series: Array<{ t: number; c: number }>
}

export interface HubEmoteMapData {
  emotes: HubEmoteAgg[]
  byId: ReadonlyMap<string, HubEmoteAgg>
  intervals: number
  /** Each closed interval's start, oldest first. */
  times: number[]
  lastHourIntervals: number
  t0: number
  t1: number
  hourFrom: number
  bucketMinutes: number
  /** Share of all emote uses the top-10 lists hold, percent. */
  cover: number | null
  /** The window holds more than the last hour, in intervals short enough to tell it apart. */
  paceOk: boolean
  /** "24 h", or the span the hub served. */
  windowLabel: string
}

export const PROVIDER_NAMES: Record<string, string> = { twitch: 'Twitch', seventv: '7TV', bttv: 'BTTV', ffz: 'FFZ' }
export const providerName = (p: string) => PROVIDER_NAMES[p] || p

/** Provider, picture and name: the same name on two providers is two emotes. */
export const emoteMapId = (e: Pick<HubBucketEmote, 'provider' | 'imageUrl' | 'name'>) => `${e.provider || ''}|${e.imageUrl || ''}|${e.name}`

const HOUR = 60 * 60_000

function windowLabel(spanMinutes: number, bucketMinutes: number): string {
  if (Math.abs(spanMinutes - 1440) <= 2 * bucketMinutes) return '24 h'
  if (spanMinutes < 120) return `${Math.round(spanMinutes)} min`
  if (spanMinutes < 2880) return `${Math.round(spanMinutes / 60)} h`
  return `${Math.round(spanMinutes / 1440)} days`
}

export function emoteMapData(points: readonly HubActivityPoint[], bucketMinutes: number): HubEmoteMapData | null {
  const bm = Number.isFinite(bucketMinutes) && bucketMinutes > 0 ? bucketMinutes : 6
  const slot = bm * 60_000
  // the open live edge has no list yet
  const closed = points
    .filter((p) => p && Number.isFinite(p.t) && p.bucketComplete !== false && Array.isArray(p.topEmotes) && p.topEmotes.length > 0)
    .slice()
    .sort((a, b) => a.t - b.t)
  if (!closed.length) return null
  const nbt = closed.length
  const t0 = closed[0]!.t
  const t1 = closed[nbt - 1]!.t + slot
  const hourFrom = t1 - HOUR
  const lastN = closed.filter((p) => p.t >= hourFrom).length
  const agg = new Map<string, HubEmoteAgg>()
  let all = 0
  let emo = 0
  for (const p of closed) {
    const inHour = p.t >= hourFrom
    emo += Number.isFinite(p.emotes) ? p.emotes! : 0
    for (const e of p.topEmotes!) {
      if (!e || !e.name || !Number.isFinite(e.count) || e.count <= 0) continue
      const id = emoteMapId(e)
      let a = agg.get(id)
      if (!a) agg.set(id, (a = { id, e, prov: e.provider || 'other', c24: 0, c1h: 0, n: 0, peak: 0, peakT: 0, pace: 0, isNew: false, series: [] }))
      a.c24 += e.count
      a.n += 1
      a.series.push({ t: p.t, c: e.count })
      all += e.count
      if (inHour) a.c1h += e.count
      if (e.count > a.peak) {
        a.peak = e.count
        a.peakT = p.t
      }
    }
  }
  const emotes = [...agg.values()]
  for (const a of emotes) {
    a.pace = a.c1h && lastN ? (a.c1h / lastN) / (a.c24 / nbt) : 0
    a.isNew = a.c1h > 0 && a.c1h === a.c24
  }
  return {
    emotes,
    byId: agg,
    intervals: nbt,
    times: closed.map((p) => p.t),
    lastHourIntervals: lastN,
    t0,
    t1,
    hourFrom,
    bucketMinutes: bm,
    cover: emo > 0 ? (all / emo) * 100 : null,
    paceOk: lastN > 0 && lastN < nbt && bm <= 30,
    windowLabel: windowLabel((t1 - t0) / 60_000, bm),
  }
}

/* ---------- pace: the last hour against the emote's own pace, as a change chip ---------- */

export interface EmoteChange {
  dir: 'up' | 'dn' | 'fl'
  /** "↗ +38%", "↘ −20%", "→ +2%", "new", "–". */
  text: string
  /** For screen readers and the card. */
  words: string
}

/** Under 5% either way reads as flat; no top 10 this hour is a dash, not −100%. */
export function emoteChange(a: Pick<HubEmoteAgg, 'c1h' | 'pace' | 'isNew'>, windowLabel = '24 h'): EmoteChange {
  if (!a.c1h) return { dir: 'fl', text: '–', words: 'no top 10 in the last hour' }
  if (a.isNew) return { dir: 'up', text: 'new', words: 'new this hour: no top 10 before it' }
  const d = Math.round((a.pace - 1) * 100)
  const abs = Math.abs(d)
  if (abs < 5) return { dir: 'fl', text: `→ ${d < 0 ? '−' : '+'}${abs}%`, words: `about its ${windowLabel} pace` }
  return d > 0
    ? { dir: 'up', text: `↗ +${abs}%`, words: `${abs}% above its ${windowLabel} pace` }
    : { dir: 'dn', text: `↘ −${abs}%`, words: `${abs}% below its ${windowLabel} pace` }
}

export function emotePaceText(a: Pick<HubEmoteAgg, 'c1h' | 'pace' | 'isNew'>, windowLabel = '24 h'): string {
  if (!a.c1h) return 'no top 10 in the last hour'
  if (a.isNew) return 'new this hour: no top 10 before it'
  return `${(Math.round(a.pace * 10) / 10).toFixed(1)}× its ${windowLabel} pace`
}

/** "26%", "4.1%", "0.42%", "<0.1%". */
export function emoteSharePct(x: number): string {
  return `${x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x >= 0.1 ? x.toFixed(2) : '<0.1'}%`
}

/** A sharper picture for a bigger tile (Twitch 2.0/3.0, 7TV 2x/4x). */
export function emoteImageAt(url: string | undefined, px: number): string {
  if (!url) return ''
  if (/^https?:\/\/static-cdn\.jtvnw\.net\/emoticons\/v2\//.test(url)) return url.replace(/\/[123]\.0$/, px > 40 ? '/3.0' : '/2.0')
  if (/^https?:\/\/cdn\.7tv\.app\/emote\//.test(url)) return url.replace(/\/[1-4]x\.(webp|avif|png|gif)$/, px > 40 ? '/4x.$1' : '/2x.$1')
  return url
}

/**
 * A (10-31 board): a map tile's picture file, at the scale its side needs on
 * this screen (px × device pixels) and, unless it plays, a still: 600 moving
 * pictures were a large part of the map's cost. Twitch serves a still of any
 * emote; 7TV only of an animated one (a still emote's _static file is a 404),
 * so a 7TV still needs the hub's animated flag. Other hosts pass through.
 */
export function tilePicUrl(url: string | undefined, px: number, play: boolean, animated: boolean, dpr = 1): string {
  if (!url) return ''
  const need = px * dpr
  const tw = /^(https?:\/\/static-cdn\.jtvnw\.net\/emoticons\/v2\/[^/]+\/)(?:default|static|animated)(\/[^/]+\/)[123]\.0$/.exec(url)
  if (tw) return `${tw[1]}${play ? 'default' : 'static'}${tw[2]}${need > 56 ? '3.0' : need > 28 ? '2.0' : '1.0'}`
  const sv = /^(https?:\/\/cdn\.7tv\.app\/emote\/[^/]+\/)[1-4]x(?:_static)?\.(?:webp|avif|png|gif)$/.exec(url)
  if (sv) return `${sv[1]}${need > 96 ? 4 : need > 64 ? 3 : need > 32 ? 2 : 1}x${!play && animated ? '_static' : ''}.webp`
  return url
}

/** Provider and name: how the hub's top emotes (the ones with an animated flag) match a tile. */
export const emoteFlagKey = (prov: string | undefined, name: string) => `${prov || 'other'}|${name}`

/* ---------- squarified treemap (Bruls, Huizing, van Wijk) ---------- */

export interface Rect { x: number; y: number; w: number; h: number }
export type Placed<T> = Rect & { it: T }

/** The remaining rect once a row of this total area is laid along its shorter side. */
function shrink(r: Rect, s: number) {
  if (r.w >= r.h) {
    const w = r.h ? s / r.h : 0
    r.x += w
    r.w -= w
  } else {
    const h = r.w ? s / r.w : 0
    r.y += h
    r.h -= h
  }
}

/**
 * Squarify's rows: a row takes the next item while that does not make its
 * worst aspect ratio worse. The row's sum, largest and smallest grow with it,
 * so each test is O(1) instead of a pass over the row.
 */
export function chooseRows<T extends { area: number }>(items: readonly T[], rect: Rect): T[][] {
  const rows: T[][] = []
  const r = { ...rect }
  let row: T[] = []
  let s = 0
  let mx = 0
  let mn = Infinity
  const worst = (sum: number, big: number, small: number, len: number) => {
    const s2 = sum * sum
    const l2 = len * len
    return Math.max((l2 * big) / s2, s2 / (l2 * small))
  }
  for (let i = 0; i < items.length;) {
    const len = Math.min(r.w, r.h)
    const it = items[i]!
    if (!row.length || worst(s + it.area, Math.max(mx, it.area), Math.min(mn, it.area), len) <= worst(s, mx, mn, len)) {
      row.push(it)
      s += it.area
      mx = Math.max(mx, it.area)
      mn = Math.min(mn, it.area)
      i += 1
    } else {
      rows.push(row)
      shrink(r, s)
      row = []
      s = 0
      mx = 0
      mn = Infinity
    }
  }
  if (row.length) rows.push(row)
  return rows
}

/** Lays rows into the rect in order, each along the shorter side of what is left. */
export function layRows<T extends { area: number }>(rows: readonly (readonly T[])[], rect: Rect): Placed<T>[] {
  const out: Placed<T>[] = []
  const r = { ...rect }
  for (const rw of rows) {
    const s = rw.reduce((x, it) => x + it.area, 0)
    if (r.w >= r.h) {
      const w = r.h ? s / r.h : 0
      let y = r.y
      for (const it of rw) {
        const h = w ? it.area / w : 0
        out.push({ it, x: r.x, y, w, h })
        y += h
      }
    } else {
      const h = r.w ? s / r.w : 0
      let x = r.x
      for (const it of rw) {
        const w = h ? it.area / h : 0
        out.push({ it, x, y: r.y, w, h })
        x += w
      }
    }
    shrink(r, s)
  }
  return out
}

export function squarify<T extends { area: number }>(items: readonly T[], rect: Rect): Placed<T>[] {
  return layRows(chooseRows(items, rect), rect)
}

/** Area-weighted mean of max(w/h, h/w): 1 is all squares, and long slivers push it up. */
export function layoutAspect<T extends { area: number }>(placed: readonly Placed<T>[]): number {
  let s = 0
  let a = 0
  for (const p of placed) {
    if (!(p.w > 0 && p.h > 0)) continue
    s += Math.max(p.w / p.h, p.h / p.w) * p.it.area
    a += p.it.area
  }
  return a ? s / a : 1
}

/**
 * M1 sticky rows (10-31 board): keep the last layout's rows (who shares a row,
 * in what order) and only resize them, so a poll moves tiles a little instead
 * of reshuffling them; newcomers squarify into what is left. When the kept rows
 * get less square than a fresh layout by more than the slack, the fresh one wins.
 */
export function stickyRows<T extends { area: number; key: string }>(
  items: readonly T[], rect: Rect, prev: readonly (readonly string[])[] | null | undefined, slack: number,
): { rows: T[][]; fresh: boolean } {
  const fresh = chooseRows(items, rect)
  if (!prev?.length) return { rows: fresh, fresh: true }
  const byKey = new Map(items.map((it) => [it.key, it]))
  const rows: T[][] = []
  const kept = new Set<string>()
  for (const keys of prev) {
    const row: T[] = []
    for (const k of keys) {
      const it = byKey.get(k)
      if (it && !kept.has(k)) {
        row.push(it)
        kept.add(k)
      }
    }
    if (row.length) rows.push(row)
  }
  const rest = items.filter((it) => !kept.has(it.key))
  if (rest.length) {
    const r = { ...rect }
    for (const row of rows) shrink(r, row.reduce((x, it) => x + it.area, 0))
    for (const row of chooseRows(rest, r)) rows.push(row)
  }
  return layoutAspect(layRows(rows, rect)) <= layoutAspect(layRows(fresh, rect)) * slack ? { rows, fresh: false } : { rows: fresh, fresh: true }
}

/* ---------- W1 window chips (10-30 board): the standard stops that fit the loaded answer ---------- */

/** 'all' is the whole answer; a number is its last that many minutes, cut on interval edges. */
export type HubEmoteWindow = 'all' | number

export interface EmoteChip { win: HubEmoteWindow; label: string }

/** The page's window names, and the shorter stops under them. */
const STOPS: ReadonlyArray<{ m: number; label: string }> = [
  { m: 5, label: '5m' }, { m: 15, label: '15m' }, { m: 30, label: '30m' }, { m: 60, label: '1h' }, { m: 360, label: '6h' },
  { m: 1440, label: '24h' }, { m: 10_080, label: '7d' }, { m: 43_200, label: '1mo' }, { m: 129_600, label: '3mo' }, { m: 525_600, label: '1 year' },
]

/** A span no stop names, in the same short style ("10h", "12d"). */
function chipLabel(minutes: number): string {
  if (minutes < 120) return `${Math.round(minutes)}m`
  if (minutes < 2880) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

/**
 * The chips: the 3 longest stops that hold at least 4 intervals, are shorter
 * than the answer and not named like it, then the whole answer, named by its
 * stop (30m · 1h · 6h · 24h; 5m · 15m · 30m on the live-pool fallback). One
 * chip is no choice, so none.
 */
export function emoteMapChips(data: Pick<HubEmoteMapData, 't0' | 't1' | 'bucketMinutes'>): EmoteChip[] {
  const span = (data.t1 - data.t0) / 60_000
  const near = Math.max(2 * data.bucketMinutes, span * 0.05)
  const all = STOPS.find((s) => Math.abs(s.m - span) <= near)?.label ?? chipLabel(span)
  // a 6h stop beside a 6.4 h answer named "6h" would be two chips with one name
  const chips: EmoteChip[] = STOPS
    .filter((s) => s.m >= 4 * data.bucketMinutes && s.m < span - near && s.label !== all)
    .slice(-3)
    .map((s) => ({ win: s.m, label: s.label }))
  return chips.length ? [...chips, { win: 'all', label: all }] : []
}

/** Where a window starts: the intervals that start at or after it are in it. */
export function emoteWindowFrom(data: Pick<HubEmoteMapData, 't0' | 't1'>, win: HubEmoteWindow): number {
  return win === 'all' ? data.t0 : Math.max(data.t0, data.t1 - win * 60_000)
}

/** The minutes a window covers: whole intervals, so 6h on 42-minute intervals is 5.6 h. */
export function emoteWindowMinutes(data: Pick<HubEmoteMapData, 't0' | 't1' | 'bucketMinutes'>, win: HubEmoteWindow): number {
  const span = (data.t1 - data.t0) / 60_000
  return win === 'all' ? span : Math.min(span, Math.floor(win / data.bucketMinutes) * data.bucketMinutes)
}

/** "24 h", "1 h", "30 min", "6 days": the span a window covers. */
export function emoteWindowLabel(data: HubEmoteMapData, win: HubEmoteWindow): string {
  if (win === 'all') return data.windowLabel
  const m = emoteWindowMinutes(data, win)
  return m === 60 ? '1 h' : windowLabel(m, data.bucketMinutes)
}

/** "last 24 h", "last hour", "last 30 min": for the list, the tiles and the cards. */
export function emoteWindowWords(data: HubEmoteMapData, win: HubEmoteWindow): string {
  return win !== 'all' && emoteWindowMinutes(data, win) === 60 ? 'last hour' : `last ${emoteWindowLabel(data, win)}`
}

/* ---------- the layout (r4 A2; mockup emotemap-moments-r4) ---------- */

/**
 * Three fields: Twitch, 7TV, and BTTV with FFZ. Four provider hues fail the
 * colour-blind check once every field can touch every other; three pass.
 */
export type EmoteField = 'twitch' | 'seventv' | 'other'
export const EMOTE_FIELDS: readonly EmoteField[] = ['twitch', 'seventv', 'other']
export const FIELD_NAMES: Record<EmoteField, string> = { twitch: 'Twitch', seventv: '7TV', other: 'BTTV & FFZ' }
export const fieldOf = (prov: string): EmoteField => (prov === 'twitch' ? 'twitch' : prov === 'seventv' ? 'seventv' : 'other')

/**
 * What a tile can hold (r5 C1, kept in r6): xl and l the picture over the name and the
 * share; row (wide and short) the picture, then the name and, from 150 px wide,
 * the share on one line; m the picture and the name; s the picture; xs a picture
 * from 12 px, else nothing.
 * The tile pads 8 px top and bottom, a name is 18 px and a share 16 px, so each
 * class's lines fit whole.
 */
export type TileSize = 'xl' | 'l' | 'row' | 'm' | 's' | 'xs'
export function tileSize(w: number, h: number): TileSize {
  if (w >= 118 && h >= 104) return 'xl'
  if (w >= 84 && h >= 92) return 'l'
  if (w >= 112 && h >= 36) return 'row'
  if (w >= 64 && h >= 68) return 'm'
  if (w >= 21 && h >= 18) return 's'
  return 'xs'
}

/**
 * The picture's side for a tile of this class and inner size (0: none). An xl
 * picture grows with its tile up to 112 px (zoomed in, Z1); an xs tile still
 * shows its picture from 12 px.
 */
export function tilePic(size: TileSize, w: number, h: number): number {
  if (size === 'xl') return Math.min(112, Math.max(48, Math.round(Math.min(w, h) * 0.42)))
  if (size === 'l') return 36
  if (size === 'row') return Math.min(30, h - 10)
  if (size === 'm') return 28
  if (size === 's') return Math.round(Math.max(12, Math.min(32, w - 6, h - 6)))
  return Math.min(w, h) >= 12 ? Math.round(Math.min(w, h) - 4) : 0
}

export interface TileFace {
  size: TileSize
  /** The picture's side in px (0: none). */
  pic: number
  name: boolean
  val: boolean
}

/** What a tile shows at this inner size; the map asks again for its size on screen, so zooming in brings names back. */
export function tileFace(w: number, h: number): TileFace {
  const size = tileSize(w, h)
  return {
    size,
    pic: tilePic(size, w, h),
    name: size === 'xl' || size === 'l' || size === 'row' || size === 'm',
    val: size === 'xl' || size === 'l' || (size === 'row' && w >= 150),
  }
}

export interface MapField extends Rect { field: EmoteField; name: string; v: number; share: string }
export interface MapTile extends Rect, TileFace {
  field: EmoteField
  a: HubEmoteAgg
  v: number
  rank: number
  share: string
}
export interface MapLayout {
  fields: MapField[]
  tiles: MapTile[]
  /** Every emote in this view, most used first. */
  ranked: Array<{ a: HubEmoteAgg; v: number }>
  /** Emotes in this view. */
  count: number
  total: number
  /** Its rows of keys, for the next poll's sticky layout (M1). */
  memo: MapMemo
}

/** A layout's rows: the fields' rows of field names, and each field's rows of emote ids. */
export interface MapMemo {
  fields: string[][] | null
  tiles: Partial<Record<EmoteField, string[][]>>
}

/** M1's slack: kept rows may be this much less square than a fresh layout before it takes over. */
export const EMOTE_STICKY_SLACK = 1.25

/** r6 D2 field frames: a field's tiles sit this far inside it, so its frame shows around them. */
export const EMOTE_FIELD_INSET = 4

/** The map's height: desktop min(460, max(300, W × 0.5)); phone min(400, max(300, W × 0.9)); taller × 1.8 (≤ 1000). */
export function emoteMapHeight(width: number, phone: boolean, tall: boolean, tallFrom = 0): number {
  const b = phone ? Math.min(400, Math.max(300, width * 0.9)) : Math.min(460, Math.max(300, width * 0.5))
  return Math.round(tall ? Math.min(1000, Math.max(b, tallFrom) * 1.8) : b)
}

/** Its uses in a window: the whole answer, or its counts from the window's start on. */
export function emoteMapValue(a: HubEmoteAgg, win: HubEmoteWindow, data: Pick<HubEmoteMapData, 't0' | 't1'>): number {
  if (win === 'all') return a.c24
  const from = emoteWindowFrom(data, win)
  let v = 0
  for (const x of a.series) if (x.t >= from) v += x.c
  return v
}

/** Its numbers in a window for the hover card: uses, its busiest interval (the first if tied) and its top-10 intervals. */
export function emoteInWindow(data: HubEmoteMapData, a: HubEmoteAgg, win: HubEmoteWindow): { v: number; peak: number; peakT: number; n: number; intervals: number } {
  if (win === 'all') return { v: a.c24, peak: a.peak, peakT: a.peakT, n: a.n, intervals: data.intervals }
  const from = emoteWindowFrom(data, win)
  const out = { v: 0, peak: 0, peakT: 0, n: 0, intervals: data.times.filter((t) => t >= from).length }
  for (const x of a.series) {
    if (x.t < from) continue
    out.v += x.c
    out.n += 1
    if (x.c > out.peak) {
      out.peak = x.c
      out.peakT = x.t
    }
  }
  return out
}

/**
 * The map's layout. Pass the last layout's memo to keep its rows (M1 sticky
 * rows, for a poll); without one it is a fresh squarify. Fields come out most
 * used first and tiles by field, then rank, however the rows fell.
 */
export function emoteMapLayout(
  data: HubEmoteMapData, win: HubEmoteWindow, W: number, H: number, memo?: MapMemo | null, slack = EMOTE_STICKY_SLACK,
): MapLayout {
  const ranked = data.emotes
    .map((a) => ({ a, v: emoteMapValue(a, win, data) }))
    .filter((x) => x.v > 0)
    .sort((x, y) => y.v - x.v || x.a.id.localeCompare(y.a.id))
  const total = ranked.reduce((s, x) => s + x.v, 0)
  const out: MapLayout = { fields: [], tiles: [], ranked, count: ranked.length, total, memo: { fields: null, tiles: {} } }
  if (!ranked.length || W <= 0 || H <= 0 || total <= 0) return out
  const rank = new Map(ranked.map((x, i) => [x.a.id, i + 1]))
  const groups = EMOTE_FIELDS.map((field) => {
    const xs = ranked.filter((x) => fieldOf(x.a.prov) === field)
    return { field, xs, v: xs.reduce((s, x) => s + x.v, 0) }
  }).filter((g) => g.v > 0).sort((p, q) => q.v - p.v)
  const order = new Map(groups.map((g, i) => [g.field, i]))
  const scale = (W * H) / total
  const rect = { x: 0, y: 0, w: W, h: H }
  const fieldRows = stickyRows(groups.map((g) => ({ key: g.field as string, area: g.v * scale, g })), rect, memo?.fields, slack)
  out.memo.fields = fieldRows.rows.map((row) => row.map((it) => it.key))
  for (const p of layRows(fieldRows.rows, rect)) {
    const { field, xs, v } = p.it.g
    out.fields.push({ field, name: FIELD_NAMES[field], v, share: emoteSharePct((v / total) * 100), x: p.x, y: p.y, w: p.w, h: p.h })
    // the field's frame takes its outer 4 px (none on a sliver); its tiles share what is inside
    const inset = p.w > 12 && p.h > 12 ? EMOTE_FIELD_INSET : 0
    const inner = { x: p.x + inset, y: p.y + inset, w: p.w - 2 * inset, h: p.h - 2 * inset }
    if (inner.w <= 0 || inner.h <= 0) continue
    const fieldScale = (inner.w * inner.h) / v
    // Z1 (10-22): every emote gets its tile, however small; zooming in makes room for it
    const tileRows = stickyRows(xs.map((x2) => ({ key: x2.a.id, area: x2.v * fieldScale, x2 })), inner, memo?.tiles[field], slack)
    out.memo.tiles[field] = tileRows.rows.map((row) => row.map((it) => it.key))
    for (const t of layRows(tileRows.rows, inner)) {
      const x2 = t.it.x2
      out.tiles.push({
        field, a: x2.a, v: x2.v, rank: rank.get(x2.a.id) ?? 0, share: emoteSharePct((x2.v / total) * 100),
        // 2 px seams: each tile gives up 1 px on every side
        ...tileFace(t.w - 2, t.h - 2),
        x: t.x, y: t.y, w: t.w, h: t.h,
      })
    }
  }
  out.fields.sort((p, q) => order.get(p.field)! - order.get(q.field)!)
  out.tiles.sort((p, q) => order.get(p.field)! - order.get(q.field)! || p.rank - q.rank)
  return out
}

/**
 * How far a new layout moves the tiles both layouts have: their mean centre
 * move, and the share whose centre moves over 24 px. M1 glides a small move
 * and fades a reshuffle (over 0.45), since 200 tiles crossing read as noise.
 */
export function emoteMapDrift(prev: readonly MapTile[], next: readonly MapTile[]): { n: number; mean: number; jump: number } {
  const was = new Map(prev.map((t) => [t.a.id, t]))
  let n = 0
  let sum = 0
  let jumps = 0
  for (const t of next) {
    const p = was.get(t.a.id)
    if (!p) continue
    const d = Math.hypot(t.x + t.w / 2 - (p.x + p.w / 2), t.y + t.h / 2 - (p.y + p.h / 2))
    n += 1
    sum += d
    if (d > 24) jumps += 1
  }
  return { n, mean: n ? sum / n : 0, jump: n ? jumps / n : 0 }
}

/** M1: a reshuffle past this share of jumping tiles fades the map instead of gliding it. */
export const EMOTE_FADE_JUMP = 0.45

/* ---------- M1 motion (10-31 board): how the map gets from one layout to the next ---------- */

export type MapMove = 'first' | 'glide' | 'fade' | 'still'
export interface MapLayer { gen: number; layout: MapLayout; out?: boolean }
export interface MapShown {
  data: HubEmoteMapData
  win: HubEmoteWindow
  W: number
  H: number
  /** The live layer last; a fade keeps the layer it replaces before it until that has faded out. */
  layers: MapLayer[]
  /** Tiles a glide drops: they fade out where they were. */
  gone: MapTile[]
  move: MapMove
  /** The layout a glide starts from. */
  from: MapLayout | null
  gen: number
  /** One per move, for the effect that runs it. */
  tid: number
}

/**
 * The map's next layout and how it gets there. A poll keeps the rows (sticky)
 * and glides, unless most tiles would still move over 24 px: then it fades to
 * a fresh layout, as another window does. A new size lays out afresh, as the
 * map did before M1 (the rows suit its shape, and the first answer often lands
 * before its height settles). That is still (dragging a window lays the map out
 * every frame), unless asked to glide (Taller map). Reduced motion is always
 * still; the first layout with tiles fades in.
 */
export function emoteMapNext(
  prev: MapShown | null, data: HubEmoteMapData, win: HubEmoteWindow, W: number, H: number,
  opts: { reduce?: boolean; glideResize?: boolean } = {},
): MapShown {
  const tid = (prev?.tid ?? 0) + 1
  const live = prev?.layers[prev.layers.length - 1]
  if (!prev || !live?.layout.tiles.length) {
    const gen = (prev?.gen ?? 0) + 1
    return { data, win, W, H, layers: [{ gen, layout: emoteMapLayout(data, win, W, H) }], gone: [], move: 'first', from: null, gen, tid }
  }
  let layout: MapLayout
  let move: MapMove
  if (prev.win !== win) {
    layout = emoteMapLayout(data, win, W, H)
    move = 'fade'
  } else if (prev.W !== W || prev.H !== H) {
    layout = emoteMapLayout(data, win, W, H)
    move = opts.glideResize ? 'glide' : 'still'
  } else {
    layout = emoteMapLayout(data, win, W, H, live.layout.memo)
    if (emoteMapDrift(live.layout.tiles, layout.tiles).jump > EMOTE_FADE_JUMP) {
      layout = emoteMapLayout(data, win, W, H)
      move = 'fade'
    } else move = 'glide'
  }
  if (opts.reduce || !layout.tiles.length) move = 'still'
  const fading = prev.layers.filter((l) => l.out)
  if (move === 'fade') {
    const gen = prev.gen + 1
    return { data, win, W, H, layers: [...fading, { ...live, out: true }, { gen, layout }], gone: [], move, from: null, gen, tid }
  }
  const ids = new Set(layout.tiles.map((t) => t.a.id))
  return {
    data, win, W, H,
    layers: [...fading, { gen: live.gen, layout }],
    gone: move === 'glide' ? live.layout.tiles.filter((t) => !ids.has(t.a.id)) : [],
    move,
    from: move === 'glide' ? live.layout : null,
    gen: prev.gen,
    tid,
  }
}

/**
 * M1's glide: a damped spring's progress (ω 13/s, ζ 0.8, about 1.5% over)
 * at n + 1 even steps through ms, ending on 1, for a CSS linear() easing.
 */
export function springCurve(omega = 13, zeta = 0.8, ms = 460, n = 30): number[] {
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  const out: number[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = ((i / n) * ms) / 1000
    out.push(1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t)))
  }
  out[n] = 1
  return out
}

/* ---------- Z1 zoom (10-22 board): the wheel, a drag, a pinch and fly-to over the map ---------- */

export const EMOTE_ZOOM_MAX = 8
/** Scale k, then a shift in px: a point at x in the map shows at x × k + tx. */
export interface MapView { k: number; tx: number; ty: number }
export const MAP_VIEW_1X: MapView = { k: 1, tx: 0, ty: 0 }

/** Within 1×–8×, and the map always covers the whole view. */
export function clampMapView(v: MapView, W: number, H: number): MapView {
  const k = Math.max(1, Math.min(EMOTE_ZOOM_MAX, v.k))
  return { k, tx: Math.min(0, Math.max(W - W * k, v.tx)), ty: Math.min(0, Math.max(H - H * k, v.ty)) }
}

/** Zoom to k about a point of the view, which stays where it is. */
export function zoomMapAt(v: MapView, px: number, py: number, k: number, W: number, H: number): MapView {
  const k2 = Math.max(1, Math.min(EMOTE_ZOOM_MAX, k))
  return clampMapView({ k: k2, tx: px - (px - v.tx) * (k2 / v.k), ty: py - (py - v.ty) * (k2 / v.k) }, W, H)
}

/** Into a field: fitted to the view and at least 2.5×; a field that overflows it starts at its top-left. */
export function fieldMapView(f: Rect, W: number, H: number): MapView {
  const k = Math.min(EMOTE_ZOOM_MAX, Math.max(2.5, Math.min(W / f.w, H / f.h) * 0.98))
  const tx = f.w * k <= W ? -f.x * k + (W - f.w * k) / 2 : -f.x * k
  const ty = f.h * k <= H ? -f.y * k + (H - f.h * k) / 2 : -f.y * k
  return clampMapView({ k, tx, ty }, W, H)
}

/** The same view moved just enough to show the whole rect (centred on it when it is out of sight). */
export function mapViewShowing(v: MapView, r: Rect, W: number, H: number): MapView {
  const s = mapRectOnScreen(r, v, W, H)
  if (s.cl + s.cr + s.ct + s.cb === 0) return v
  return clampMapView({ k: v.k, tx: W / 2 - (r.x + r.w / 2) * v.k, ty: H / 2 - (r.y + r.h / 2) * v.k }, W, H)
}

/** A map rect on screen, with how much of it each edge of the view cuts off. */
export function mapRectOnScreen(r: Rect, v: MapView, W: number, H: number): Rect & { cl: number; ct: number; cr: number; cb: number } {
  const x = r.x * v.k + v.tx
  const y = r.y * v.k + v.ty
  const w = r.w * v.k
  const h = r.h * v.k
  return { x, y, w, h, cl: Math.max(0, -x), ct: Math.max(0, -y), cr: Math.max(0, x + w - W), cb: Math.max(0, y + h - H) }
}

/* ---------- A (10-31 board): what tiles show once the camera settles, and which pictures move ---------- */

/** A tile's face at the settled zoom, when that is not its layout face; cut by the view's edge, a pad keeps it in the part on show. */
export interface TileFit { face: TileFace; pad?: string }
export const NO_TILE_FITS: ReadonlyMap<string, TileFit> = new Map()
/** Only tiles this near the view (screen px) re-fit when the camera settles. */
export const TILE_FIT_MARGIN = 48

const fitPx = (n: number) => `${n.toFixed(1)}px`
const sameFace = (p: TileFace, q: TileFace) => p.size === q.size && p.pic === q.pic && p.name === q.name && p.val === q.val

/**
 * The tiles' faces at a settled zoom. Only tiles within 48 px of the view are
 * measured, by a rectangle test over the layout (an observer re-checked every
 * tile on every frame of a glide); the rest keep the face they had. An entry
 * that comes out the same is the same object, so its tile skips a render.
 * At 1× every tile shows its layout face.
 */
export function tileFits(
  tiles: readonly MapTile[], v: MapView, W: number, H: number, prev: ReadonlyMap<string, TileFit> = NO_TILE_FITS,
): ReadonlyMap<string, TileFit> {
  if (v.k <= 1 + 1e-3 || W <= 0 || H <= 0) return NO_TILE_FITS
  const out = new Map(prev)
  const m = TILE_FIT_MARGIN / v.k
  const x0 = -v.tx / v.k - m
  const y0 = -v.ty / v.k - m
  const x1 = (W - v.tx) / v.k + m
  const y1 = (H - v.ty) / v.k + m
  for (const t of tiles) {
    if (t.x + t.w <= x0 || t.x >= x1 || t.y + t.h <= y0 || t.y >= y1) continue
    const s = mapRectOnScreen(t, v, W, H)
    const shown = s.x < W && s.y < H && s.x + s.w > 0 && s.y + s.h > 0
    // one bigger than the view keeps its picture and name in the part on show
    const face = shown ? tileFace(Math.max(0, s.w - 2 - s.cl - s.cr), Math.max(0, s.h - 2 - s.ct - s.cb)) : tileFace(s.w - 2, s.h - 2)
    const cut = shown && s.cl + s.ct + s.cr + s.cb > 0 && face.size !== 's' && face.size !== 'xs'
    const pad = cut ? `${fitPx(8 + s.ct)} ${fitPx(8 + s.cr)} ${fitPx(8 + s.cb)} ${fitPx(8 + s.cl)}` : undefined
    const was = out.get(t.a.id)
    if (!was || was.pad !== pad || !sameFace(was.face, face)) out.set(t.a.id, pad ? { face, pad } : { face })
  }
  return out
}

/** A (10-31 board): how many map pictures move at once; the rest show a still. */
export const EMOTE_PLAYING = 8

/** The pictures that move: the most used tiles on screen whose picture is 28 px or more. */
export function playingTiles(
  tiles: readonly MapTile[], v: MapView, W: number, H: number, fits: ReadonlyMap<string, TileFit> = NO_TILE_FITS, n = EMOTE_PLAYING,
): Set<string> {
  const x0 = -v.tx / v.k
  const y0 = -v.ty / v.k
  const x1 = (W - v.tx) / v.k
  const y1 = (H - v.ty) / v.k
  const pool = tiles.filter((t) => t.x + t.w > x0 && t.x < x1 && t.y + t.h > y0 && t.y < y1 && (fits.get(t.a.id)?.face.pic ?? t.pic) >= 28)
  pool.sort((p, q) => p.rank - q.rank)
  return new Set(pool.slice(0, n).map((t) => t.a.id))
}

/* ---------- K1 pace heat (10-22 board): a tile's fill is its last hour against its own pace ---------- */

/** Under this many uses in the window, a pace is noise and the tile stays neutral. */
export const PACE_HEAT_MIN_USES = 30

export interface PaceHeat {
  dir: 'up' | 'dn'
  /** Percent of the rising or cooling colour in the tile's fill, 18–58. */
  mix: number
}

/**
 * |log2 pace| past a dead zone of 0.26 (within about ±20% stays neutral), full
 * at 1.46 (2.75 times or a third). No top 10 this hour stays neutral like its
 * "–" chip; a new emote is taking off.
 */
export function paceHeat(a: Pick<HubEmoteAgg, 'c24' | 'c1h' | 'pace'>): PaceHeat | null {
  if (a.c24 < PACE_HEAT_MIN_USES || !a.c1h || !(a.pace > 0)) return null
  const l = Math.log2(a.pace)
  const over = Math.abs(l) - 0.26
  if (over < 0) return null
  return { dir: l > 0 ? 'up' : 'dn', mix: Math.round(18 + Math.min(1, over / 1.2) * 40) }
}

/**
 * "120 emotes · sized by uses · last 24 h". A chip under a day gives its clock
 * span, since its cut lands on interval edges (the 24h chip of a 7-day answer,
 * 23.8 h on 42-minute intervals, still reads "last 24 h"). While the backend
 * serves its live-pool fallback the line says the longer history is behind
 * instead (IRC-2 pick A's words), then the span.
 */
export function emoteMapMeta(data: HubEmoteMapData, layout: MapLayout, win: HubEmoteWindow, behind?: string | null): string {
  const span = win !== 'all' && win < 1440
    ? hubClockRange(data.t1 - emoteWindowMinutes(data, win) * 60_000, data.t1)
    : emoteWindowWords(data, win)
  return behind ? `${behind} · ${span}` : `${formatHubInt(layout.count)} ${layout.count === 1 ? 'emote' : 'emotes'} · sized by uses · ${span}`
}

export function emoteMapTip(data: HubEmoteMapData): string {
  return `The hub sends each ${data.bucketMinutes}-minute interval’s top 10 emotes with their counts (${data.intervals} intervals here). The map adds them up: ${formatHubInt(data.emotes.length)} different emotes made a top 10 in the last ${data.windowLabel}. `
    + 'Uses outside an emote’s top-10 intervals are not sent, so smaller emotes count low'
    + (data.cover != null ? `; the lists hold about ${Math.round(data.cover)}% of all emote uses` : '') + '. '
    + (data.paceOk
      ? `A tile’s colour is its last hour (the last ${data.lastHourIntervals} intervals) against its own ${data.windowLabel} pace, counted the same way: orange is taking off, blue is cooling, plain is about its pace or under ${PACE_HEAT_MIN_USES} uses. In the list, ↗ and ↘ give the same. The frames are the providers (BTTV and FFZ share one). `
      : 'The three colours are the providers (BTTV and FFZ share one). ')
    + 'Size is uses; the share is of everything on the map. Every emote is on it: scroll or pinch over the map to zoom in, drag to move, double-click to zoom in or out. '
    + 'The window chips add up only the last intervals of the same lists. '
    + 'Click an emote to see its uses per interval, the busiest one marked, and the streams in that interval that had it in their top 3.'
}

/* ---------- C1 (10-30 board): a selected emote's spike, and who drove it ---------- */

export interface EmoteSpike {
  /**
   * One bar per interval of the window, oldest first: its count, null where it
   * made no top 10, undefined where the hub sent no list at all (an outage, not
   * a quiet emote).
   */
  bars: Array<number | null | undefined>
  /** The busiest bar (-1: none; the first if tied), its interval's start and its count. */
  peak: number
  peakT: number
  peakCount: number
}

export function emoteSpike(data: HubEmoteMapData, a: HubEmoteAgg, win: HubEmoteWindow): EmoteSpike {
  const slot = data.bucketMinutes * 60_000
  const n = Math.max(1, Math.round(emoteWindowMinutes(data, win) / data.bucketMinutes))
  const start = data.t1 - n * slot
  const from = emoteWindowFrom(data, win)
  const at = (t: number) => Math.min(n - 1, Math.max(0, Math.floor((t - start) / slot)))
  const bars: Array<number | null | undefined> = Array.from({ length: n }, () => undefined)
  for (const t of data.times) if (t >= from) bars[at(t)] = null
  const starts: number[] = []
  for (const x of a.series) {
    if (x.t < from) continue
    const i = at(x.t)
    bars[i] = (bars[i] ?? 0) + x.c
    starts[i] = x.t
  }
  let peak = -1
  for (let i = 0; i < n; i += 1) if (bars[i] != null && (peak < 0 || bars[i]! > bars[peak]!)) peak = i
  return { bars, peak, peakT: peak >= 0 ? starts[peak]! : 0, peakCount: peak >= 0 ? bars[peak]! : 0 }
}

const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

/** "Oct 12", "Oct 12–13", "Sep 30–Oct 2": the days from a to b. */
function dayRange(a: number, b: number): string {
  const da = new Date(a)
  const db = new Date(b)
  if (da.toDateString() === db.toDateString()) return da.toLocaleDateString('en-US', DAY)
  const sameMonth = da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()
  return `${da.toLocaleDateString('en-US', DAY)}–${sameMonth ? db.getDate() : db.toLocaleDateString('en-US', DAY)}`
}

/**
 * When an interval was: its clock span in a window of a day or less
 * ("2:00–2:06 PM"), with its day in a longer one ("Oct 24, 7:00–7:42 PM"), and
 * its days when an interval is a day or longer ("Oct 12–13").
 */
export function emoteIntervalLabel(data: Pick<HubEmoteMapData, 't0' | 't1' | 'bucketMinutes'>, win: HubEmoteWindow, t: number): string {
  const end = t + data.bucketMinutes * 60_000
  if (data.bucketMinutes >= 1440) return dayRange(t, end - 1)
  const clock = hubClockRange(t, end)
  return emoteWindowMinutes(data, win) > 1440 + data.bucketMinutes ? `${new Date(t).toLocaleDateString('en-US', DAY)}, ${clock}` : clock
}

/** Uses a minute over an interval: "936", "12", "4.2", "<0.1" (a long interval never reads 0). */
export function emotePerMinute(count: number, bucketMinutes: number): string {
  const r = count / Math.max(1, bucketMinutes)
  if (r >= 9.95) return formatHubInt(Math.round(r))
  if (r >= 0.05) return String(Math.round(r * 10) / 10)
  return r > 0 ? '<0.1' : '0'
}

export interface EmoteDriver {
  m: HubLivePulseMoment
  /** The stream's uses of this emote in that minute. */
  uses: number
}

/**
 * C1's "Who drove it": of an interval's busiest chats (hub/moments, one row a
 * stream), those with this emote in their top 3, matched by provider and name;
 * most uses first, one row a channel.
 */
export function emoteDrivers(rows: readonly HubLivePulseMoment[], a: Pick<HubEmoteAgg, 'e' | 'prov'>, limit = 5): EmoteDriver[] {
  const best = new Map<string, EmoteDriver>()
  for (const m of rows) {
    if (!m?.login) continue
    const hit = (m.topEmotes ?? []).slice(0, 3).find((e) => e?.name && isSameEmote(e, a))
    const uses = hit && Number.isFinite(hit.count) ? hit.count : 0
    if (uses <= 0) continue
    const key = m.login.toLowerCase()
    const was = best.get(key)
    if (!was || uses > was.uses) best.set(key, { m, uses })
  }
  return [...best.values()].sort((p, q) => q.uses - p.uses || (q.m.at ?? 0) - (p.m.at ?? 0)).slice(0, limit)
}

/* ---------- where chat spammed an emote: the hub's live moments it led ---------- */

export interface EmoteMomentRowSource {
  series: 'chat' | 'emotes'
  topEmote: Pick<HubBucketEmote, 'name' | 'provider'> | null
  cmp: { x: number } | { why: string }
  at: number | null
}

/** The same emote: provider and name (the name alone merged 7TV and BTTV Clap). */
export function isSameEmote(e: Pick<HubBucketEmote, 'name' | 'provider'>, a: Pick<HubEmoteAgg, 'e' | 'prov'>): boolean {
  return e.name === a.e.name && (!e.provider || e.provider === a.prov)
}

/** Emote spikes whose named top emote is this one, biggest × first, then newest. */
export function emoteMomentRows<T extends EmoteMomentRowSource>(rows: readonly T[], a: Pick<HubEmoteAgg, 'e' | 'prov'>, limit = 10): T[] {
  const x = (r: T) => ('x' in r.cmp ? r.cmp.x : -1)
  return rows
    .filter((r) => r.series === 'emotes' && r.topEmote && isSameEmote(r.topEmote, a))
    .slice()
    .sort((p, q) => x(q) - x(p) || (q.at ?? 0) - (p.at ?? 0))
    .slice(0, limit)
}

/** The tile an arrow key moves to: the nearest centre in that direction (across counts double). */
export function nearestTile<T extends Rect>(tiles: readonly T[], from: T, dx: number, dy: number): T | null {
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  let best = Infinity
  let next: T | null = null
  for (const t of tiles) {
    if (t === from) continue
    const ex = t.x + t.w / 2 - cx
    const ey = t.y + t.h / 2 - cy
    const along = ex * dx + ey * dy
    const across = Math.abs(ex * dy + ey * dx)
    if (along <= 1) continue
    const score = along + across * 2
    if (score < best) {
      best = score
      next = t
    }
  }
  return next
}

/* ---------- the hero's conveyor (R5-15 at Soft; mockup hub-hero.js) ---------- */

export interface ConveyorEmote { url: string; w: number }

/**
 * The 120 emotes chat used most over the closed intervals (summed from each
 * interval's top 10), each weighted uses^0.6 so an emote used more turns up
 * more often. Only emotes with a picture; no numbers are shown.
 */
export function conveyorEmotes(points: readonly HubActivityPoint[], limit = 120): ConveyorEmote[] {
  const m = new Map<string, { url: string; n: number }>()
  for (const p of points) {
    if (!p || p.bucketComplete === false || !Array.isArray(p.topEmotes)) continue
    for (const e of p.topEmotes) {
      if (!e?.imageUrl || !e.name || !Number.isFinite(e.count) || e.count <= 0) continue
      const k = `${e.name}|${e.imageUrl}`
      const o = m.get(k)
      if (o) o.n += e.count
      else m.set(k, { url: e.imageUrl, n: e.count })
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((e) => ({ url: e.url, w: e.n ** 0.6 }))
}

/** Seeded randoms (an LCG), so the rows land the same way on every load. */
export function conveyorRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}
