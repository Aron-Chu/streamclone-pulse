/**
 * The emote map (R5-13, refined R5-17; mockup d3-v5 hub-emap.js): a treemap
 * like a stock-market heat map. Segments are the providers; a tile's size is
 * the emote's uses and its colour the last hour against its own pace over the
 * window. Data: each closed activity interval's top 10 emotes with their counts
 * (activity.points[].topEmotes), added up per emote, so uses outside an emote's
 * top-10 intervals are not in it. Every size, share and pace here is a sum of
 * those sent counts; nothing is estimated.
 */
import type { HubActivityPoint, HubBucketEmote } from '../../../../lib/publicHub'
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
}

export interface HubEmoteMapData {
  emotes: HubEmoteAgg[]
  byId: ReadonlyMap<string, HubEmoteAgg>
  intervals: number
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
      if (!a) agg.set(id, (a = { id, e, prov: e.provider || 'other', c24: 0, c1h: 0, n: 0, peak: 0, peakT: 0, pace: 0, isNew: false }))
      a.c24 += e.count
      a.n += 1
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

/* ---------- colour: 7 tones as on a market map ---------- */

export const EMOTE_TONES: ReadonlyArray<{ t: string; d: string }> = [
  { t: 'none', d: 'made no top 10 in the last hour' },
  { t: '<0.5×', d: 'under half its usual pace' },
  { t: '<0.8×', d: 'below its usual pace' },
  { t: '≈1×', d: 'near its usual pace' },
  { t: '>1.25×', d: 'above its usual pace' },
  { t: '>2×', d: 'over twice its usual pace' },
  { t: '>4×', d: 'over 4 times its usual pace' },
]

/** 0 none (no top 10 in the last hour: a dark neutral, not the strongest red), 1–2 quieter, 3 as usual, 4–6 busier. */
export function emoteTone(a: Pick<HubEmoteAgg, 'c1h' | 'pace'>): number {
  if (!a.c1h) return 0
  const p = a.pace
  return p < 0.5 ? 1 : p < 0.8 ? 2 : p <= 1.25 ? 3 : p <= 2 ? 4 : p <= 4 ? 5 : 6
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
  if (/static-cdn\.jtvnw\.net\/emoticons\/v2\//.test(url)) return url.replace(/\/[123]\.0$/, px > 40 ? '/3.0' : '/2.0')
  if (/cdn\.7tv\.app\/emote\//.test(url)) return url.replace(/\/[1-4]x\.(webp|avif|png|gif)$/, px > 40 ? '/4x.$1' : '/2x.$1')
  return url
}

/* ---------- squarified treemap (Bruls, Huizing, van Wijk) ---------- */

export interface Rect { x: number; y: number; w: number; h: number }
export type Placed<T> = Rect & { it: T }

export function squarify<T extends { area: number }>(items: readonly T[], rect: Rect): Placed<T>[] {
  const out: Placed<T>[] = []
  const r = { ...rect }
  let row: T[] = []
  const worst = (rw: readonly T[], len: number) => {
    let s = 0
    let mx = 0
    let mn = Infinity
    for (const it of rw) {
      s += it.area
      mx = Math.max(mx, it.area)
      mn = Math.min(mn, it.area)
    }
    const s2 = s * s
    const l2 = len * len
    return Math.max((l2 * mx) / s2, s2 / (l2 * mn))
  }
  const lay = (rw: readonly T[]) => {
    const s = rw.reduce((x, it) => x + it.area, 0)
    if (r.w >= r.h) {
      const w = r.h ? s / r.h : 0
      let y = r.y
      for (const it of rw) {
        const h = w ? it.area / w : 0
        out.push({ it, x: r.x, y, w, h })
        y += h
      }
      r.x += w
      r.w -= w
    } else {
      const h = r.w ? s / r.w : 0
      let x = r.x
      for (const it of rw) {
        const w = h ? it.area / h : 0
        out.push({ it, x, y: r.y, w, h })
        x += w
      }
      r.y += h
      r.h -= h
    }
  }
  for (let i = 0; i < items.length;) {
    const len = Math.min(r.w, r.h)
    const it = items[i]!
    if (!row.length || worst([...row, it], len) <= worst(row, len)) {
      row.push(it)
      i += 1
    } else {
      lay(row)
      row = []
    }
  }
  if (row.length) lay(row)
  return out
}

/* ---------- the layout ---------- */

export type HubEmoteWindow = 'all' | '1h'

export interface MapSeg extends Rect { prov: string; name: string; share: string | null }
export interface MapTile extends Rect {
  kind: 'emote'
  a: HubEmoteAgg
  v: number
  rank: number
  share: string
  /** Poster-sized: share, "of uses", name, bottom left. */
  cap: boolean
  name: boolean
  val: boolean
  fs: number
  /** Picture size in px (0: none). */
  img: number
  chip: boolean
}
export interface MapCell extends Rect { a: HubEmoteAgg }
export interface MapMore extends Rect {
  kind: 'more'
  prov: string
  n: number
  v: number
  share: string
  cells: MapCell[]
  /** "+12 more · 3.1%", shortened to fit; null when nothing fits. */
  label: { n: string; rest: string } | null
}
export interface MapLayout {
  segs: MapSeg[]
  tiles: MapTile[]
  mores: MapMore[]
  /** Emotes in this view. */
  count: number
  total: number
}

const MIN_DESK = 26 * 26
const MIN_PHONE = 24 * 24
const SG = 2 // half the gap between segments
const PAD = 3 // inside a segment
const HEAD = 22

/** The map's height: desktop min(620, max(360, W × 0.72)); phone min(460, max(340, W × 1.05)); taller × 1.8 (≤ 1000). */
export function emoteMapHeight(width: number, phone: boolean, tall: boolean, tallFrom = 0): number {
  const b = phone ? Math.min(460, Math.max(340, width * 1.05)) : Math.min(620, Math.max(360, width * 0.72))
  return Math.round(tall ? Math.min(1000, Math.max(b, tallFrom) * 1.8) : b)
}

export function emoteMapLayout(data: HubEmoteMapData, win: HubEmoteWindow, W: number, H: number, phone: boolean): MapLayout {
  const value = (a: HubEmoteAgg) => (win === 'all' ? a.c24 : a.c1h)
  const items = data.emotes.filter((a) => value(a) > 0).map((a) => ({ a, v: value(a) })).sort((x, y) => y.v - x.v || x.a.id.localeCompare(y.a.id))
  const total = items.reduce((s, x) => s + x.v, 0)
  const empty: MapLayout = { segs: [], tiles: [], mores: [], count: items.length, total }
  if (!items.length || W <= 0 || H <= 0 || total <= 0) return empty
  const rank = new Map(items.map((x, i) => [x.a.id, i + 1]))
  const by = new Map<string, typeof items>()
  for (const x of items) {
    const list = by.get(x.a.prov)
    if (list) list.push(x)
    else by.set(x.a.prov, [x])
  }
  const segList = [...by.entries()].map(([prov, xs]) => ({ prov, xs, v: xs.reduce((s, x) => s + x.v, 0) })).sort((p, q) => q.v - p.v)
  const scale = (W * H) / total
  const MIN = phone ? MIN_PHONE : MIN_DESK
  const segs: MapSeg[] = []
  type Place = { area: number; x2?: (typeof items)[number]; more?: { n: number; v: number; xs: typeof items } }
  const raw: Array<Placed<Place> & { prov: string }> = []
  for (const sr of squarify(segList.map((s) => ({ s, area: s.v * scale })), { x: 0, y: 0, w: W, h: H })) {
    const s = sr.it.s
    const x = sr.x + SG
    const y = sr.y + SG
    const w = Math.max(0, sr.w - 2 * SG)
    const h = Math.max(0, sr.h - 2 * SG)
    const label = h >= 64 && w >= 64
    const top = label ? HEAD : 0
    const inner = { x: x + PAD, y: y + PAD + top, w: Math.max(0, w - 2 * PAD), h: Math.max(0, h - 2 * PAD - top) }
    const A = inner.w * inner.h
    const ideal = (v: number) => (v / s.v) * A
    let keep = s.xs.filter((x2) => ideal(x2.v) >= MIN).slice(0, 160)
    let rest = s.xs.slice(keep.length)
    if (rest.length === 1) {
      keep = keep.concat(rest)
      rest = []
    }
    const place: Place[] = keep.map((x2) => ({ x2, area: ideal(x2.v) }))
    if (rest.length) {
      const v = rest.reduce((t, x2) => t + x2.v, 0)
      place.push({ more: { n: rest.length, v, xs: rest }, area: ideal(v) })
    }
    segs.push({ prov: s.prov, name: providerName(s.prov), share: label ? emoteSharePct((s.v / total) * 100) : null, x, y, w, h })
    for (const r of squarify(place, inner)) raw.push({ ...r, prov: s.prov })
  }
  const tiles: MapTile[] = []
  const mores: MapMore[] = []
  for (const t of raw.filter((q) => q.w >= 2 && q.h >= 2)) {
    if (t.it.more) {
      const m = t.it.more
      const share = emoteSharePct((m.v / total) * 100)
      const cw = Math.max(0, t.w - 2)
      const ch = Math.max(0, t.h - 2)
      const cells: MapCell[] = []
      for (const c of squarify(m.xs.map((x2) => ({ x2, area: (x2.v / m.v) * cw * ch })), { x: 0, y: 0, w: cw, h: ch })) {
        if (c.w < 3 || c.h < 3) continue // under 3 px: left as the segment's background
        cells.push({ a: c.it.x2.a, x: c.x + 0.5, y: c.y + 0.5, w: Math.max(1, c.w - 1), h: Math.max(1, c.h - 1) })
      }
      // the label drops the share, then the word, rather than be cut off (about 7 px a character at 12 px)
      const fit = (txt: string) => txt.length * 7 + 18 <= t.w - 8
      const n0 = `+${formatHubInt(m.n)}`
      const label = t.h < 28 ? null
        : fit(`${n0} more · ${share}`) ? { n: n0, rest: ` more · ${share}` }
          : fit(`${n0} more`) ? { n: n0, rest: ' more' }
            : fit(n0) ? { n: n0, rest: '' } : null
      mores.push({ kind: 'more', prov: t.prov, n: m.n, v: m.v, share, cells, label, x: t.x, y: t.y, w: t.w, h: t.h })
      continue
    }
    const x2 = t.it.x2!
    const w = t.w - 2
    const h = t.h - 2
    const r = rank.get(x2.a.id) ?? 0
    const cap = w >= 110 && h >= 104
    const name = !cap && w >= 64 && h >= 58
    const val = !cap && w >= 84 && h >= 84
    const fs = w >= 110 && h >= 100 ? 13 : 12
    let img = cap ? Math.round(Math.min(w * 0.5, (h - 54) * 0.82, 88)) : Math.round(Math.min(w, h) * (name ? 0.42 : 0.62))
    if (!cap) img = Math.min(img, 72, h - 8 - (name ? fs + 6 : 0) - (val ? 16 : 0))
    tiles.push({
      kind: 'emote', a: x2.a, v: x2.v, rank: r, share: emoteSharePct((x2.v / total) * 100),
      cap, name, val, fs, img: img >= 14 ? img : 0, chip: r <= 3 && w >= 44 && h >= 44,
      x: t.x, y: t.y, w: t.w, h: t.h,
    })
  }
  return { segs, tiles, mores, count: items.length, total }
}

/** "120 emotes · sized by uses · last 24 h · 64 pictured". */
export function emoteMapMeta(data: HubEmoteMapData, layout: MapLayout, win: HubEmoteWindow): string {
  const n = layout.count
  const shown = layout.tiles.length
  return `${formatHubInt(n)} emotes · sized by uses · ${win === 'all' ? `last ${data.windowLabel}` : hubClockRange(data.hourFrom, data.t1)}${shown < n ? ` · ${shown} pictured` : ''}`
}

export function emoteMapTip(data: HubEmoteMapData): string {
  return `The hub sends each ${data.bucketMinutes}-minute interval’s top 10 emotes with their counts (${data.intervals} intervals here). The map adds them up: ${formatHubInt(data.emotes.length)} different emotes made a top 10 in the last ${data.windowLabel}. `
    + 'Uses outside an emote’s top-10 intervals are not sent, so smaller emotes count low'
    + (data.cover != null ? `; the lists hold about ${Math.round(data.cover)}% of all emote uses` : '') + '. '
    + 'Segments are the providers. Size is uses; the share is of everything on the map. '
    + (data.paceOk
      ? `Colour is the last hour (the last ${data.lastHourIntervals} intervals) against the emote’s own ${data.windowLabel} pace, counted the same way: green is busier than usual, red quieter, dark grey made no top 10 this hour. `
      : 'The intervals are too long to compare the last hour, so the tiles are not coloured. ')
    + 'Emotes too small for a picture are the small cells in each segment’s “more” block; hover one for its numbers.'
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
