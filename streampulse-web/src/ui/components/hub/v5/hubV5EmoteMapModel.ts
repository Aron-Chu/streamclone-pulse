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

/* ---------- the layout (r4 A2; mockup emotemap-moments-r4) ---------- */

export type HubEmoteWindow = 'all' | '1h'

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
}

/** r6 D2 field frames: a field's tiles sit this far inside it, so its frame shows around them. */
export const EMOTE_FIELD_INSET = 4

/** The map's height: desktop min(460, max(300, W × 0.5)); phone min(400, max(300, W × 0.9)); taller × 1.8 (≤ 1000). */
export function emoteMapHeight(width: number, phone: boolean, tall: boolean, tallFrom = 0): number {
  const b = phone ? Math.min(400, Math.max(300, width * 0.9)) : Math.min(460, Math.max(300, width * 0.5))
  return Math.round(tall ? Math.min(1000, Math.max(b, tallFrom) * 1.8) : b)
}

export function emoteMapValue(a: HubEmoteAgg, win: HubEmoteWindow): number {
  return win === 'all' ? a.c24 : a.c1h
}

export function emoteMapLayout(data: HubEmoteMapData, win: HubEmoteWindow, W: number, H: number): MapLayout {
  const ranked = data.emotes
    .map((a) => ({ a, v: emoteMapValue(a, win) }))
    .filter((x) => x.v > 0)
    .sort((x, y) => y.v - x.v || x.a.id.localeCompare(y.a.id))
  const total = ranked.reduce((s, x) => s + x.v, 0)
  const empty: MapLayout = { fields: [], tiles: [], ranked, count: ranked.length, total }
  if (!ranked.length || W <= 0 || H <= 0 || total <= 0) return empty
  const rank = new Map(ranked.map((x, i) => [x.a.id, i + 1]))
  const groups = EMOTE_FIELDS.map((field) => {
    const xs = ranked.filter((x) => fieldOf(x.a.prov) === field)
    return { field, xs, v: xs.reduce((s, x) => s + x.v, 0) }
  }).filter((g) => g.v > 0).sort((p, q) => q.v - p.v)
  const scale = (W * H) / total
  const fields: MapField[] = []
  const tiles: MapTile[] = []
  for (const g of squarify(groups.map((it) => ({ it, area: it.v * scale })), { x: 0, y: 0, w: W, h: H })) {
    const { field, xs, v } = g.it.it
    fields.push({ field, name: FIELD_NAMES[field], v, share: emoteSharePct((v / total) * 100), x: g.x, y: g.y, w: g.w, h: g.h })
    // the field's frame takes its outer 4 px (none on a sliver); its tiles share what is inside
    const inset = g.w > 12 && g.h > 12 ? EMOTE_FIELD_INSET : 0
    const inner = { x: g.x + inset, y: g.y + inset, w: g.w - 2 * inset, h: g.h - 2 * inset }
    if (inner.w <= 0 || inner.h <= 0) continue
    const fieldScale = (inner.w * inner.h) / v
    // Z1 (10-22): every emote gets its tile, however small; zooming in makes room for it
    for (const t of squarify(xs.map((x2) => ({ x2, area: x2.v * fieldScale })), inner)) {
      const x2 = t.it.x2
      tiles.push({
        field, a: x2.a, v: x2.v, rank: rank.get(x2.a.id) ?? 0, share: emoteSharePct((x2.v / total) * 100),
        // 2 px seams: each tile gives up 1 px on every side
        ...tileFace(t.w - 2, t.h - 2),
        x: t.x, y: t.y, w: t.w, h: t.h,
      })
    }
  }
  return { fields, tiles, ranked, count: ranked.length, total }
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

/** "120 emotes · sized by uses · last 24 h". */
export function emoteMapMeta(data: HubEmoteMapData, layout: MapLayout, win: HubEmoteWindow): string {
  return `${formatHubInt(layout.count)} emotes · sized by uses · ${win === 'all' ? `last ${data.windowLabel}` : hubClockRange(data.hourFrom, data.t1)}`
}

export function emoteMapTip(data: HubEmoteMapData): string {
  return `The hub sends each ${data.bucketMinutes}-minute interval’s top 10 emotes with their counts (${data.intervals} intervals here). The map adds them up: ${formatHubInt(data.emotes.length)} different emotes made a top 10 in the last ${data.windowLabel}. `
    + 'Uses outside an emote’s top-10 intervals are not sent, so smaller emotes count low'
    + (data.cover != null ? `; the lists hold about ${Math.round(data.cover)}% of all emote uses` : '') + '. '
    + (data.paceOk
      ? `A tile’s colour is its last hour (the last ${data.lastHourIntervals} intervals) against its own ${data.windowLabel} pace, counted the same way: orange is taking off, blue is cooling, plain is about its pace or under ${PACE_HEAT_MIN_USES} uses. In the list, ↗ and ↘ give the same. The frames are the providers (BTTV and FFZ share one). `
      : 'The three colours are the providers (BTTV and FFZ share one). ')
    + 'Size is uses; the share is of everything on the map. Every emote is on it: scroll or pinch over the map to zoom in, drag to move, double-click to zoom in or out. '
    + 'Click an emote to see where chat spammed it.'
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
