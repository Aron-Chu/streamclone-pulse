import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubBucketEmote, HubLivePulseMoment } from '../src/lib/publicHub'
import { hubClockRange } from '../src/ui/components/hub/v5/hubV5Model'
import {
  EMOTE_FIELD_INSET,
  EMOTE_ZOOM_MAX,
  MAP_VIEW_1X,
  NO_TILE_FITS,
  clampMapView,
  conveyorEmotes,
  conveyorRng,
  emoteChange,
  emoteDrivers,
  emoteFlagKey,
  emoteImageAt,
  emoteInWindow,
  emoteIntervalLabel,
  emoteMapChips,
  emoteMapData,
  emoteMapDrift,
  emoteMapHeight,
  emoteMapId,
  emoteMapLayout,
  emoteMapMeta,
  emoteMapNext,
  emoteMapValue,
  emoteMomentRows,
  emoteSpike,
  emoteWindowFrom,
  emoteWindowLabel,
  emoteWindowMinutes,
  emoteWindowWords,
  emotePaceText,
  emotePerMinute,
  emoteSharePct,
  fieldMapView,
  fieldOf,
  mapRectOnScreen,
  mapViewShowing,
  nearestTile,
  paceHeat,
  playingTiles,
  springCurve,
  squarify,
  tileFace,
  tileFits,
  tilePic,
  tilePicUrl,
  tileSize,
  zoomMapAt,
} from '../src/ui/components/hub/v5/hubV5EmoteMapModel'
import type { HubEmoteAgg, MapTile } from '../src/ui/components/hub/v5/hubV5EmoteMapModel'

const T0 = Date.UTC(2026, 9, 19, 12, 0)
const MIN = 60_000

function point(i: number, bucketMinutes: number, top: HubBucketEmote[], over: Partial<HubActivityPoint> = {}): HubActivityPoint {
  return { t: T0 + i * bucketMinutes * MIN, chat: 0, seventv: 0, viewers: 0, emotes: 100, topEmotes: top, ...over }
}

const em = (name: string, provider: string, count: number): HubBucketEmote => ({ name, provider, count, imageUrl: `https://img.test/${provider}/${name}.png` })

/** 8 half-hour intervals: the last hour is the last two. */
function fourHours(): HubActivityPoint[] {
  const pts: HubActivityPoint[] = []
  for (let i = 0; i < 8; i += 1) {
    const top = [em('EmA', 'twitch', 10)]
    if (i >= 6) top.push(em('EmB', 'seventv', 5))
    if (i < 6) top.push(em('EmC', 'bttv', 8))
    if (i === 3) top.push(em('EmA', 'seventv', 2)) // the same name on another provider is another emote
    pts.push(point(i, 30, top))
  }
  // the open live edge has no settled list
  pts.push(point(8, 30, [em('EmA', 'twitch', 999)], { bucketComplete: false }))
  return pts
}

describe('emoteMapData', () => {
  const d = emoteMapData(fourHours(), 30)!

  it('adds up the closed intervals per provider, picture and name', () => {
    expect(d.intervals).toBe(8)
    expect(d.lastHourIntervals).toBe(2)
    expect(d.emotes).toHaveLength(4)
    const a = d.emotes.find((e) => e.e.name === 'EmA' && e.prov === 'twitch')!
    expect(a).toMatchObject({ c24: 80, c1h: 20, n: 8, peak: 10 })
    expect(d.emotes.find((e) => e.e.name === 'EmA' && e.prov === 'seventv')!.c24).toBe(2)
    expect(d.cover).toBeCloseTo(((80 + 10 + 48 + 2) / 800) * 100)
    expect(d.windowLabel).toBe('4 h')
    expect(d.paceOk).toBe(true)
  })

  it('reads the last hour against its own pace', () => {
    const a = d.emotes.find((e) => e.e.name === 'EmA' && e.prov === 'twitch')!
    const b = d.emotes.find((e) => e.e.name === 'EmB')!
    const c = d.emotes.find((e) => e.e.name === 'EmC')!
    expect(a.pace).toBeCloseTo(1)
    expect(emoteChange(a)).toMatchObject({ dir: 'fl', text: '→ +0%' })
    expect(b.isNew).toBe(true)
    expect(b.pace).toBeCloseTo(4)
    expect(emoteChange(b)).toMatchObject({ dir: 'up', text: 'new' })
    expect(emotePaceText(b)).toBe('new this hour: no top 10 before it')
    expect(c.c1h).toBe(0)
    expect(emoteChange(c)).toMatchObject({ dir: 'fl', text: '–' })
    expect(emotePaceText(c)).toBe('no top 10 in the last hour')
    expect(emotePaceText(a, d.windowLabel)).toBe('1.0× its 4 h pace')
  })

  it('cannot compare the last hour when it is the whole window or the intervals are long', () => {
    expect(emoteMapData(fourHours().slice(6, 8), 30)!.paceOk).toBe(false)
    expect(emoteMapData(fourHours().map((p, i) => ({ ...p, t: T0 + i * 60 * MIN })), 60)!.paceOk).toBe(false)
    expect(emoteMapData([], 6)).toBeNull()
  })

  it('shows pace as a change chip: flat under 5% either way', () => {
    const chip = (pace: number) => emoteChange({ c1h: 1, pace, isNew: false }).text
    expect([0.3, 0.8, 0.97, 1.04, 1.38, 3].map(chip)).toEqual(['↘ −70%', '↘ −20%', '→ −3%', '→ +4%', '↗ +38%', '↗ +200%'])
    expect(emoteChange({ c1h: 1, pace: 1.38, isNew: false }, '4 h').words).toBe('38% above its 4 h pace')
  })
})

describe('emote formatting', () => {
  it('rounds shares like the mockup', () => {
    expect(emoteSharePct(26.4)).toBe('26%')
    expect(emoteSharePct(4.12)).toBe('4.1%')
    expect(emoteSharePct(0.421)).toBe('0.42%')
    expect(emoteSharePct(0.05)).toBe('<0.1%')
  })

  it('asks for a sharper picture for a bigger tile', () => {
    const tw = 'https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/1.0'
    expect(emoteImageAt(tw, 50)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/3.0')
    expect(emoteImageAt(tw, 30)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/2.0')
    expect(emoteImageAt('https://cdn.7tv.app/emote/abc/1x.webp', 50)).toBe('https://cdn.7tv.app/emote/abc/4x.webp')
    expect(emoteImageAt('https://img.test/x.png', 50)).toBe('https://img.test/x.png')
    expect(emoteImageAt(undefined, 50)).toBe('')
  })

  it('only resizes pictures served by Twitch or 7TV themselves', () => {
    expect(emoteImageAt('https://img.test/static-cdn.jtvnw.net/emoticons/v2/1/default/dark/1.0', 50))
      .toBe('https://img.test/static-cdn.jtvnw.net/emoticons/v2/1/default/dark/1.0')
    expect(emoteImageAt('https://img.test/cdn.7tv.app/emote/abc/1x.webp', 50)).toBe('https://img.test/cdn.7tv.app/emote/abc/1x.webp')
  })

  it('sizes a map picture to its tile on screen, a still unless it plays (A, 10-31)', () => {
    const tw = 'https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/1.0'
    expect(tilePicUrl(tw, 20, true, true)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/1.0')
    expect(tilePicUrl(tw, 20, false, false)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/123/static/dark/1.0')
    expect(tilePicUrl(tw, 20, true, true, 2)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/2.0')
    expect(tilePicUrl(tw, 36, false, true, 2)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/123/static/dark/3.0')
    const sv = 'https://cdn.7tv.app/emote/abc/1x.webp'
    expect(tilePicUrl(sv, 28, true, true)).toBe('https://cdn.7tv.app/emote/abc/1x.webp')
    expect(tilePicUrl(sv, 40, false, true)).toBe('https://cdn.7tv.app/emote/abc/2x_static.webp')
    // 7TV has a still only for an emote the hub marks animated
    expect(tilePicUrl(sv, 112, false, false, 2)).toBe('https://cdn.7tv.app/emote/abc/4x.webp')
    expect(tilePicUrl('https://img.test/x.png', 50, false, true)).toBe('https://img.test/x.png')
    expect(tilePicUrl(undefined, 50, true, true)).toBe('')
    expect(emoteFlagKey('seventv', 'KEKW')).toBe('seventv|KEKW')
    expect(emoteFlagKey(undefined, 'KEKW')).toBe('other|KEKW')
  })
})

describe('squarify', () => {
  it('fills the rect with each item at its own area', () => {
    const items = [6, 6, 4, 3, 2, 2, 1].map((area) => ({ area }))
    const out = squarify(items, { x: 0, y: 0, w: 6, h: 4 })
    expect(out).toHaveLength(items.length)
    for (const r of out) {
      expect(r.w * r.h).toBeCloseTo(r.it.area)
      expect(r.x).toBeGreaterThanOrEqual(-1e-9)
      expect(r.y).toBeGreaterThanOrEqual(-1e-9)
      expect(r.x + r.w).toBeLessThanOrEqual(6 + 1e-9)
      expect(r.y + r.h).toBeLessThanOrEqual(4 + 1e-9)
    }
  })

  it('lays the same rects as the one-pass squarify it replaced', () => {
    const rnd = conveyorRng(7)
    for (let n = 1; n <= 120; n += 17) {
      const raw = Array.from({ length: n }, () => 1 + rnd() * 40).sort((a, b) => b - a)
      const scale = (640 * 360) / raw.reduce((s, x) => s + x, 0)
      const items = raw.map((x) => ({ area: x * scale }))
      expect(squarify(items, { x: 0, y: 0, w: 640, h: 360 })).toEqual(classicSquarify(items, { x: 0, y: 0, w: 640, h: 360 }))
    }
  })
})

/** squarify as it stood before the 11-01 split into rows and laying, kept to check the split changes nothing. */
function classicSquarify<T extends { area: number }>(items: readonly T[], rect: { x: number; y: number; w: number; h: number }) {
  const out: Array<{ it: T; x: number; y: number; w: number; h: number }> = []
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

describe('emoteMapLayout', () => {
  // 80 emotes on two providers, from one very big to many small
  const pts: HubActivityPoint[] = []
  for (let i = 0; i < 6; i += 1) {
    const top: HubBucketEmote[] = []
    for (let k = 0; k < 80; k += 1) top.push(em(`Em${k}`, k % 3 ? 'twitch' : 'seventv', Math.round(5000 / (k + 1) ** 1.6) + 1))
    pts.push(point(i, 6, top))
  }
  const d = emoteMapData(pts, 6)!
  const W = 800
  const H = emoteMapHeight(W, false, false)
  const lay = emoteMapLayout(d, 'all', W, H)

  it('gives every emote its own tile, in its provider\'s field', () => {
    expect(lay.count).toBe(80)
    expect(lay.tiles).toHaveLength(80)
    expect(lay.fields.map((f) => f.field).sort()).toEqual(['seventv', 'twitch'])
    for (const t of lay.tiles) expect(fieldOf(t.a.prov)).toBe(t.field)
  })

  it('sets each field\'s tiles inside its frame, still sized by uses', () => {
    const e = 1e-6
    for (const t of lay.tiles) {
      const f = lay.fields.find((x) => x.field === t.field)!
      expect(t.x).toBeGreaterThanOrEqual(f.x + EMOTE_FIELD_INSET - e)
      expect(t.y).toBeGreaterThanOrEqual(f.y + EMOTE_FIELD_INSET - e)
      expect(t.x + t.w).toBeLessThanOrEqual(f.x + f.w - EMOTE_FIELD_INSET + e)
      expect(t.y + t.h).toBeLessThanOrEqual(f.y + f.h - EMOTE_FIELD_INSET + e)
    }
    // within a field, area still follows uses
    for (const f of lay.fields) {
      const own = lay.tiles.filter((t) => t.field === f.field)
      const per = own.map((t) => (t.w * t.h) / t.v)
      for (const p of per) expect(p).toBeCloseTo(per[0], 6)
    }
  })

  it('stays inside the map and follows the size classes', () => {
    for (const t of lay.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-6)
      expect(t.y).toBeGreaterThanOrEqual(-1e-6)
      expect(t.x + t.w).toBeLessThanOrEqual(W + 1e-6)
      expect(t.y + t.h).toBeLessThanOrEqual(H + 1e-6)
      const w = t.w - 2
      const h = t.h - 2
      expect(t.size).toBe(tileSize(w, h))
      expect(t.pic).toBe(tilePic(t.size, w, h))
      if (t.val) expect(t.name && (t.size === 'xl' || t.size === 'l' || (t.size === 'row' && w >= 150))).toBe(true)
      // lines show whole: 8 px pads, the picture, a 4 px gap, an 18 px name, a 16 px share
      if (t.name && t.size !== 'row') expect(h).toBeGreaterThanOrEqual(16 + t.pic + 4 + 18 + (t.val ? 16 : 0))
      if (t.size === 'row') expect(h).toBeGreaterThanOrEqual(Math.max(16 + 18, t.pic + 6))
      if (t.size === 's' || t.size === 'xs') expect(t.name).toBe(false)
      if (t.size === 'xl') expect(t.name && t.val).toBe(true)
      if (t.size !== 'xs') expect(t.pic).toBeGreaterThan(0)
    }
    expect(lay.tiles.find((t) => t.rank === 1)!.size).toBe('xl')
    expect(lay.ranked.map((x) => x.v)).toEqual(lay.ranked.map((x) => x.v).slice().sort((a, b) => b - a))
  })

  it('shows only emotes from the last hour in the hour view', () => {
    const hour = emoteMapLayout(d, 60, W, H)
    expect(hour.count).toBe(d.emotes.filter((a) => a.c1h > 0).length)
    const none = emoteMapLayout(d, 'all', 0, H)
    expect(none.tiles).toEqual([])
    expect(none.ranked).toHaveLength(80)
  })

  it('says what the map holds', () => {
    expect(emoteMapMeta(d, lay, 'all')).toBe('80 emotes · sized by uses · last 36 min')
    // a chip under a day shows its clock span, as the last-hour view did
    expect(emoteMapMeta(d, lay, 30)).toBe(`80 emotes · sized by uses · ${hubClockRange(d.t1 - 30 * MIN, d.t1)}`)
  })

  describe('M1 sticky rows (10-31 board)', () => {
    // a poll later: every fifth emote a little busier, and one new
    const later = emoteMapData(pts.map((p) => ({
      ...p,
      topEmotes: [...p.topEmotes!.map((e, k) => (k % 5 ? e : { ...e, count: e.count + 4 })), em('EmNew', 'twitch', 30)],
    })), 6)!
    const kept = emoteMapLayout(later, 'all', W, H, lay.memo)

    it('keeps who shares a row, so a poll moves tiles less than a fresh layout would', () => {
      for (const f of ['twitch', 'seventv'] as const) {
        const was = lay.memo.tiles[f]!
        expect(kept.memo.tiles[f]!.slice(0, was.length)).toEqual(was)
      }
      expect(kept.memo.fields).toEqual(lay.memo.fields)
      const fresh = emoteMapLayout(later, 'all', W, H)
      expect(emoteMapDrift(lay.tiles, kept.tiles).mean).toBeLessThan(emoteMapDrift(lay.tiles, fresh.tiles).mean)
    })

    it('fits the newcomer into what the kept rows leave, every tile still sized by uses inside its frame', () => {
      expect(kept.tiles).toHaveLength(81)
      expect(kept.memo.tiles.twitch!.flat()).toContain(emoteMapId(em('EmNew', 'twitch', 30)))
      const e = 1e-6
      for (const f of kept.fields) {
        const own = kept.tiles.filter((t) => t.field === f.field)
        const per = own.map((t) => (t.w * t.h) / t.v)
        for (const p of per) expect(p).toBeCloseTo(per[0], 6)
        for (const t of own) {
          expect(t.x).toBeGreaterThanOrEqual(f.x + EMOTE_FIELD_INSET - e)
          expect(t.y).toBeGreaterThanOrEqual(f.y + EMOTE_FIELD_INSET - e)
          expect(t.x + t.w).toBeLessThanOrEqual(f.x + f.w - EMOTE_FIELD_INSET + e)
          expect(t.y + t.h).toBeLessThanOrEqual(f.y + f.h - EMOTE_FIELD_INSET + e)
        }
      }
    })

    it('goes back to a fresh layout when the kept rows get too thin', () => {
      const oneRow = { fields: lay.memo.fields, tiles: { ...lay.memo.tiles, twitch: [lay.memo.tiles.twitch!.flat()] } }
      expect(emoteMapLayout(d, 'all', W, H, oneRow).memo.tiles.twitch).toEqual(lay.memo.tiles.twitch)
    })

    it('comes out by field, most used first, then by rank, however the rows fell', () => {
      expect(kept.fields.map((f) => f.v)).toEqual(kept.fields.map((f) => f.v).slice().sort((a, b) => b - a))
      const at = (field: string) => kept.fields.findIndex((f) => f.field === field)
      const keys = kept.tiles.map((t) => [at(t.field), t.rank])
      expect(keys).toEqual(keys.slice().sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!))
    })

    it('measures how far tiles both layouts have move', () => {
      expect(emoteMapDrift(lay.tiles, lay.tiles)).toEqual({ n: 80, mean: 0, jump: 0 })
      const moved = lay.tiles.map((t) => ({ ...t, x: t.x + 30 }))
      expect(emoteMapDrift(lay.tiles, moved).jump).toBe(1)
      expect(emoteMapDrift(lay.tiles, moved).mean).toBeCloseTo(30)
      // a tile only one layout has does not count
      expect(emoteMapDrift(lay.tiles.slice(0, 10), moved).n).toBe(10)
    })
  })

  describe('M1 motion (10-31 board)', () => {
    const first = emoteMapNext(null, d, 'all', W, H)
    // a poll later, with one new emote
    const poll = emoteMapData(pts.map((p) => ({ ...p, topEmotes: [...p.topEmotes!, em('EmNew', 'twitch', 30)] })), 6)!
    const layers = (s: ReturnType<typeof emoteMapNext>) => s.layers.map((l) => [l.gen, !!l.out])

    it('fades the first layout in', () => {
      expect(first).toMatchObject({ move: 'first', gen: 1, tid: 1, from: null, gone: [] })
      expect(layers(first)).toEqual([[1, false]])
      expect(first.layers[0]!.layout.tiles).toHaveLength(80)
    })

    it('glides a poll on the kept rows, a tile it drops fading where it was', () => {
      const next = emoteMapNext(first, poll, 'all', W, H)
      expect(next).toMatchObject({ move: 'glide', gen: 1, tid: 2, gone: [] })
      expect(next.from).toBe(first.layers[0]!.layout)
      expect(layers(next)).toEqual([[1, false]])
      expect(next.layers[0]!.layout.memo.tiles.twitch!.slice(0, lay.memo.tiles.twitch!.length)).toEqual(lay.memo.tiles.twitch)
      const back = emoteMapNext(next, d, 'all', W, H)
      expect(back.move).toBe('glide')
      expect(back.gone.map((t) => t.a.e.name)).toEqual(['EmNew'])
    })

    it('fades to a fresh layout on another window, keeping the old layer until it has faded', () => {
      const hour = emoteMapNext(first, d, 60, W, H)
      expect(hour).toMatchObject({ move: 'fade', gen: 2, from: null, gone: [] })
      expect(layers(hour)).toEqual([[1, true], [2, false]])
      expect(hour.layers[0]!.layout).toBe(first.layers[0]!.layout)
      // another move while it fades keeps it; the map drops it once it has faded
      expect(layers(emoteMapNext(hour, d, 'all', W, H))).toEqual([[1, true], [2, true], [3, false]])
    })

    it('fades a reshuffle instead of gliding 80 tiles across each other', () => {
      // the order turned over: the least used now the most
      const flip = emoteMapData(pts.map((p) => ({ ...p, topEmotes: p.topEmotes!.map((e, k) => ({ ...e, count: p.topEmotes![79 - k]!.count })) })), 6)!
      const next = emoteMapNext(first, flip, 'all', W, H)
      expect(next.move).toBe('fade')
      expect(layers(next)).toEqual([[1, true], [2, false]])
    })

    it('lays a new size out afresh, still unless asked to glide, and always still under reduced motion', () => {
      // the map's height often settles after the first answer: the rows are the new size's, as before M1
      const settled = emoteMapNext(first, d, 'all', W, H - 40)
      expect(settled.move).toBe('still')
      expect(settled.layers[0]!.layout).toEqual(emoteMapLayout(d, 'all', W, H - 40))
      const taller = emoteMapNext(first, d, 'all', W, H + 200, { glideResize: true })
      expect(taller.move).toBe('glide')
      expect(taller.from).toBe(first.layers[0]!.layout)
      expect(taller.layers[0]!.layout).toEqual(emoteMapLayout(d, 'all', W, H + 200))
      expect(emoteMapNext(first, poll, 'all', W, H, { reduce: true })).toMatchObject({ move: 'still', gone: [], from: null })
      expect(layers(emoteMapNext(first, d, 60, W, H, { reduce: true }))).toEqual([[1, false]])
    })

    it('starts again from a map with no tiles', () => {
      const none = emoteMapNext(null, d, 'all', 0, H)
      expect(none.move).toBe('first')
      expect(none.layers[0]!.layout.tiles).toEqual([])
      expect(emoteMapNext(none, d, 'all', W, H)).toMatchObject({ move: 'first', gen: 2, tid: 2 })
    })
  })
})

/** `closed` closed intervals of `bm` minutes, one emote each, then the open live edge. */
function answer(closed: number, bm: number): HubActivityPoint[] {
  const pts = Array.from({ length: closed }, (_, i) => point(i, bm, [em('EmA', 'twitch', 10)]))
  pts.push(point(closed, bm, [em('EmA', 'twitch', 999)], { bucketComplete: false }))
  return pts
}

describe('the window chips (W1, 10-30)', () => {
  const chips = (closed: number, bm: number) => emoteMapChips(emoteMapData(answer(closed, bm), bm)!).map((c) => c.label)

  it('offers the 3 longest stops under the answer, then the whole answer by its stop', () => {
    expect(chips(239, 6)).toEqual(['30m', '1h', '6h', '24h'])
    expect(chips(240, 42)).toEqual(['6h', '24h', '7d'])
    expect(chips(240, 180)).toEqual(['24h', '7d', '1mo'])
    expect(chips(240, 540)).toEqual(['7d', '1mo', '3mo'])
    expect(chips(240, 2190)).toEqual(['7d', '1mo', '3mo', '1 year'])
  })

  it('cuts the 30 minutes the live-pool fallback has', () => {
    expect(chips(30, 1)).toEqual(['5m', '15m', '30m'])
    expect(chips(29, 1)).toEqual(['5m', '15m', '30m'])
  })

  it('names a span no stop names in the same short style, and shows no lone chip', () => {
    expect(chips(30, 6)).toEqual(['30m', '1h', '3h'])
    expect(chips(8, 30)).toEqual([])
    expect(chips(3, 1)).toEqual([])
  })

  it('never shows two chips with one name: a stop named like the answer gives way to it', () => {
    // 6.4 h and 7.4 days: too far from 6h and 7d to be them, but named like them
    expect(chips(64, 6)).toEqual(['30m', '1h', '6h'])
    expect(chips(59, 180)).toEqual(['24h', '7d'])
  })

  it('reads "last 24 h" for the 24h chip of a 7-day answer, and one emote as one', () => {
    const week = emoteMapData(answer(240, 42), 42)!
    expect(emoteMapMeta(week, emoteMapLayout(week, 1440, 800, 400), 1440)).toBe('1 emote · sized by uses · last 24 h')
  })

  it('leads with the chart\'s behind words on the fallback', () => {
    const fb = emoteMapData(answer(30, 1), 1)!
    expect(emoteMapMeta(fb, emoteMapLayout(fb, 'all', 800, 400), 'all', '24-hour history is behind right now'))
      .toBe('24-hour history is behind right now · last 30 min')
  })
})

describe('a window cut (W1, 10-30)', () => {
  const d = emoteMapData(fourHours(), 30)!
  const a = d.emotes.find((e) => e.e.name === 'EmA' && e.prov === 'twitch')!
  const b = d.emotes.find((e) => e.e.name === 'EmB')!
  const c = d.emotes.find((e) => e.e.name === 'EmC')!

  it('adds up only the intervals that start inside it', () => {
    expect(emoteWindowFrom(d, 60)).toBe(d.t1 - 60 * MIN)
    expect(emoteWindowFrom(d, 10_080)).toBe(d.t0)
    expect([a, b, c].map((x) => emoteMapValue(x, 60, d))).toEqual([20, 10, 0])
    expect([a, b, c].map((x) => emoteMapValue(x, 'all', d))).toEqual([80, 10, 48])
    expect(emoteMapLayout(d, 60, 800, 400).ranked.map((x) => x.a.e.name)).toEqual(['EmA', 'EmB'])
  })

  it('gives the hover card the window\'s uses, busiest interval and top-10 count', () => {
    expect(emoteInWindow(d, a, 60)).toEqual({ v: 20, peak: 10, peakT: T0 + 6 * 30 * MIN, n: 2, intervals: 2 })
    expect(emoteInWindow(d, a, 'all')).toEqual({ v: 80, peak: 10, peakT: T0, n: 8, intervals: 8 })
    expect(emoteInWindow(d, c, 60)).toMatchObject({ v: 0, n: 0, intervals: 2 })
  })

  it('covers whole intervals and names the span', () => {
    expect(emoteWindowMinutes(d, 60)).toBe(60)
    expect(emoteWindowMinutes(d, 45)).toBe(30)
    expect(emoteWindowMinutes(d, 'all')).toBe(240)
    expect(emoteWindowWords(d, 60)).toBe('last hour')
    expect(emoteWindowLabel(d, 60)).toBe('1 h')
    expect(emoteWindowLabel(d, 30)).toBe('30 min')
    expect(emoteWindowWords(d, 'all')).toBe('last 4 h')
    const week = emoteMapData(answer(240, 42), 42)!
    expect(emoteWindowMinutes(week, 360)).toBe(336)
    expect(emoteWindowLabel(week, 360)).toBe('6 h')
    expect(emoteWindowWords(week, 1440)).toBe('last 24 h')
  })
})

describe('the spike bars (C1, 10-30)', () => {
  // 20 six-minute intervals; Pog made a top 10 in five of them, twice at 12
  const pog: Record<number, number> = { 2: 4, 3: 12, 5: 12, 9: 7, 17: 9 }
  const d = emoteMapData(Array.from({ length: 20 }, (_, i) => point(i, 6, [em('Fill', 'twitch', 50), ...(pog[i] ? [em('Pog', 'seventv', pog[i]!)] : [])])), 6)!
  const p = d.emotes.find((e) => e.e.name === 'Pog')!

  it('draws one bar per interval, a gap where it made no top 10, the first busiest marked', () => {
    const s = emoteSpike(d, p, 'all')
    expect(s.bars).toHaveLength(20)
    expect(s.bars.slice(0, 6)).toEqual([null, null, 4, 12, null, 12])
    expect(s).toMatchObject({ peak: 3, peakT: T0 + 3 * 6 * MIN, peakCount: 12 })
  })

  it('re-cuts to the chip, and marks nothing when the window has none', () => {
    const s = emoteSpike(d, p, 30)
    expect(s.bars).toEqual([null, null, 9, null, null])
    expect(s).toMatchObject({ peak: 2, peakT: T0 + 17 * 6 * MIN, peakCount: 9 })
    expect(emoteSpike(d, p, 15)).toEqual({ bars: [null, null], peak: -1, peakT: 0, peakCount: 0 })
  })
})

describe('the busiest interval in words (C1, 10-30)', () => {
  // local noon, so the day is the same in every time zone
  const noon = new Date(2026, 9, 12, 12, 0).getTime()
  const day = emoteMapData(answer(239, 6), 6)!
  const week = emoteMapData(answer(240, 42), 42)!

  it('gives its clock in a day or less, its day too in a longer window, and its days when it is a day or longer', () => {
    expect(emoteIntervalLabel(day, 'all', noon)).toBe(hubClockRange(noon, noon + 6 * MIN))
    expect(emoteIntervalLabel(week, 1440, noon)).toBe(hubClockRange(noon, noon + 42 * MIN))
    expect(emoteIntervalLabel(week, 'all', noon)).toBe(`Oct 12, ${hubClockRange(noon, noon + 42 * MIN)}`)
    expect(emoteIntervalLabel({ ...week, bucketMinutes: 1440 }, 'all', new Date(2026, 9, 12).getTime())).toBe('Oct 12')
    expect(emoteIntervalLabel({ ...week, bucketMinutes: 2190 }, 'all', noon)).toBe('Oct 12–14')
    expect(emoteIntervalLabel({ ...week, bucketMinutes: 2190 }, 'all', new Date(2026, 8, 30, 12, 0).getTime())).toBe('Sep 30–Oct 2')
  })

  it('gives uses a minute: whole from 10, one decimal under, never 0 when it had uses', () => {
    expect(emotePerMinute(5616, 6)).toBe('936')
    expect(emotePerMinute(60, 6)).toBe('10')
    expect(emotePerMinute(59, 6)).toBe('9.8')
    expect(emotePerMinute(25, 6)).toBe('4.2')
    expect(emotePerMinute(100, 2190)).toBe('<0.1')
    expect(emotePerMinute(0, 6)).toBe('0')
  })
})

describe('who drove it (C1, 10-30)', () => {
  const clap = { e: { name: 'Clap', provider: 'seventv', count: 1 }, prov: 'seventv' }
  const row = (login: string, at: number, top: Array<[string, string | undefined, number]>): HubLivePulseMoment => ({
    offsetSeconds: 60,
    score: 1,
    label: 'Chat peak',
    login,
    displayName: login,
    at,
    topEmotes: top.map(([name, provider, count]) => ({ name, provider, count, sharePct: 0 })),
  })

  it('keeps streams with the emote in their top 3, by provider and name, most uses first, one row a channel', () => {
    const rows = [
      row('alpha', 1, [['Clap', 'seventv', 40], ['LUL', 'twitch', 30]]),
      row('bravo', 2, [['LUL', 'twitch', 90], ['KEKW', 'bttv', 80], ['OMEGALUL', 'seventv', 70], ['Clap', 'seventv', 60]]),
      row('charlie', 3, [['Clap', 'bttv', 99]]),
      row('delta', 4, [['Pog', 'twitch', 50], ['Clap', 'seventv', 55]]),
      row('Alpha', 5, [['Clap', 'seventv', 45]]),
      row('echo', 6, [['Clap', undefined, 20]]),
      row('', 7, [['Clap', 'seventv', 99]]),
    ]
    expect(emoteDrivers(rows, clap).map((x) => [x.m.login, x.uses])).toEqual([['delta', 55], ['Alpha', 45], ['echo', 20]])
  })

  it('lists at most 5, the newer first on a tie', () => {
    const many = Array.from({ length: 7 }, (_, i) => row(`s${i}`, i, [['Clap', 'seventv', 10]]))
    expect(emoteDrivers(many, clap).map((x) => x.m.login)).toEqual(['s6', 's5', 's4', 's3', 's2'])
    expect(emoteDrivers([row('x', 1, [['Clap', 'seventv', 0]])], clap)).toEqual([])
  })
})

describe('emoteMapHeight', () => {
  it('follows the width, within bounds, and taller is 1.8× up to 1000', () => {
    expect(emoteMapHeight(1000, false, false)).toBe(460)
    expect(emoteMapHeight(700, false, false)).toBe(350)
    expect(emoteMapHeight(400, false, false)).toBe(300)
    expect(emoteMapHeight(390, true, false)).toBe(351)
    expect(emoteMapHeight(1000, false, true)).toBe(828)
    expect(emoteMapHeight(400, false, true)).toBe(540)
  })
})

describe('tileSize', () => {
  it('hides what a tile is too small for', () => {
    expect(tileSize(120, 104)).toBe('xl')
    expect(tileSize(117, 104)).toBe('l')
    expect(tileSize(84, 92)).toBe('l')
    expect(tileSize(130, 40)).toBe('row')
    expect(tileSize(120, 80)).toBe('row')
    expect(tileSize(111, 80)).toBe('m')
    expect(tileSize(64, 68)).toBe('m')
    expect(tileSize(60, 40)).toBe('s')
    expect(tileSize(30, 30)).toBe('s')
    expect(tileSize(20, 40)).toBe('xs')
  })

  it('gives the picture its class size, a short row or a small tile what fits', () => {
    expect(tilePic('xl', 118, 104)).toBe(48)
    expect(tilePic('xl', 200, 200)).toBe(84)
    expect(tilePic('xl', 400, 300)).toBe(112)
    expect(tilePic('l', 90, 95)).toBe(36)
    expect(tilePic('row', 140, 36)).toBe(26)
    expect(tilePic('row', 140, 60)).toBe(30)
    expect(tilePic('m', 70, 70)).toBe(28)
    expect(tilePic('s', 30, 30)).toBe(24)
    expect(tilePic('s', 60, 60)).toBe(32)
    expect(tilePic('s', 21, 18)).toBe(12)
    expect(tilePic('xs', 10, 10)).toBe(0)
    expect(tilePic('xs', 20, 40)).toBe(16)
  })

  it('brings the name and share back as a tile grows on screen', () => {
    expect(tileFace(20, 40)).toEqual({ size: 'xs', pic: 16, name: false, val: false })
    expect(tileFace(60, 40)).toMatchObject({ size: 's', name: false, val: false })
    expect(tileFace(64, 68)).toMatchObject({ size: 'm', name: true, val: false })
    expect(tileFace(130, 40)).toMatchObject({ size: 'row', name: true, val: false })
    expect(tileFace(160, 40)).toMatchObject({ size: 'row', name: true, val: true })
    expect(tileFace(300, 300)).toEqual({ size: 'xl', pic: 112, name: true, val: true })
  })
})

describe('the map zoom', () => {
  const W = 800
  const H = 400

  it('stays within 1×–8×, the map always over the whole view', () => {
    expect(clampMapView({ k: 0.5, tx: 30, ty: 30 }, W, H)).toEqual(MAP_VIEW_1X)
    expect(clampMapView({ k: 12, tx: -9000, ty: 50 }, W, H)).toEqual({ k: EMOTE_ZOOM_MAX, tx: W - W * 8, ty: 0 })
  })

  it('zooms about the pointer, which keeps its spot on the map', () => {
    const v = zoomMapAt(MAP_VIEW_1X, 200, 100, 2, W, H)
    expect(v).toEqual({ k: 2, tx: -200, ty: -100 })
    const v2 = zoomMapAt(v, 600, 300, 4, W, H)
    expect((600 - v2.tx) / v2.k).toBeCloseTo((600 - v.tx) / v.k)
    expect((300 - v2.ty) / v2.k).toBeCloseTo((300 - v.ty) / v.k)
    expect(zoomMapAt(v, 0, 0, 0.2, W, H)).toEqual(MAP_VIEW_1X)
  })

  it('flies into a field: fitted, at least 2.5×, from its top-left when it overflows', () => {
    const small = { x: 600, y: 300, w: 100, h: 50 }
    const v = fieldMapView(small, W, H)
    expect(v.k).toBeCloseTo(7.84)
    expect(mapRectOnScreen(small, v, W, H)).toMatchObject({ cl: 0, ct: 0, cr: 0, cb: 0 })
    expect(mapRectOnScreen(small, v, W, H).x).toBeCloseTo(8)
    const big = fieldMapView({ x: 0, y: 0, w: 600, h: 400 }, W, H)
    expect(big.k).toBe(2.5)
    expect(big.tx).toBeCloseTo(0)
    expect(big.ty).toBeCloseTo(0)
  })

  it('moves only as far as it must to show a tile', () => {
    const v = { k: 2, tx: -200, ty: -100 }
    expect(mapViewShowing(v, { x: 150, y: 80, w: 20, h: 20 }, W, H)).toBe(v)
    const off = { x: 700, y: 350, w: 20, h: 20 }
    const moved = mapViewShowing(v, off, W, H)
    expect(moved.k).toBe(2)
    expect(mapRectOnScreen(off, moved, W, H)).toMatchObject({ cl: 0, ct: 0, cr: 0, cb: 0 })
  })

  it('says how much of a rect each edge of the view cuts off', () => {
    const v = { k: 2, tx: -50, ty: -20 }
    expect(mapRectOnScreen({ x: 0, y: 0, w: 100, h: 100 }, v, W, H)).toEqual({ x: -50, y: -20, w: 200, h: 200, cl: 50, ct: 20, cr: 0, cb: 0 })
    expect(mapRectOnScreen({ x: 350, y: 150, w: 100, h: 100 }, v, W, H)).toMatchObject({ cl: 0, ct: 0, cr: 50, cb: 80 })
  })

  const tile = (id: string, rank: number, x: number, y: number, w: number, h: number): MapTile => ({
    field: 'twitch', a: { id } as HubEmoteAgg, v: 1, rank, share: '1%', ...tileFace(w - 2, h - 2), x, y, w, h,
  })

  it('re-fits only the tiles near the view once it settles, a cut tile padded to the part on show (A, 10-31)', () => {
    const tiles = [tile('a', 1, 0, 0, 100, 100), tile('b', 2, 100, 0, 100, 100), tile('d', 4, 252, 0, 10, 10), tile('c', 3, 600, 300, 200, 100)]
    expect(tileFits(tiles, MAP_VIEW_1X, W, H)).toBe(NO_TILE_FITS)
    // 4×, showing map x 50–250: the view cuts 200 px off a's left
    const v = { k: 4, tx: -200, ty: 0 }
    const fits = tileFits(tiles, v, W, H)
    expect(fits.get('a')).toEqual({ face: tileFace(198, 398), pad: '8.0px 8.0px 8.0px 208.0px' })
    expect(fits.get('b')).toEqual({ face: tileFace(398, 398) })
    // d is just past the view's edge: fitted to its whole size, so a small pan shows it right
    expect(fits.get('d')).toEqual({ face: tileFace(38, 38) })
    expect(fits.has('c')).toBe(false)
    // an entry that comes out the same is the same object
    expect(tileFits(tiles, v, W, H, fits).get('a')).toBe(fits.get('a'))
    // panned away, a keeps the face it had
    const far = tileFits(tiles, { k: 4, tx: -2400, ty: -1200 }, W, H, fits)
    expect(far.get('a')).toBe(fits.get('a'))
    expect(far.get('c')).toEqual({ face: tileFace(798, 398) })
  })

  it('plays the 8 most used pictures on screen, from 28 px (A, 10-31)', () => {
    const grid = Array.from({ length: 12 }, (_, i) => tile(`t${i}`, i + 1, (i % 6) * 100, Math.floor(i / 6) * 100, 100, 100))
    expect([...playingTiles(grid, MAP_VIEW_1X, W, H)]).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    // 2×, showing map x 300–700
    expect([...playingTiles(grid, { k: 2, tx: -600, ty: 0 }, W, H)].sort()).toEqual(['t10', 't11', 't3', 't4', 't5', 't9'])
    const small = [tile('s', 1, 0, 0, 20, 20), tile('m', 2, 20, 0, 100, 100)]
    expect([...playingTiles(small, MAP_VIEW_1X, W, H)]).toEqual(['m'])
    // its face at the settled zoom says how big its picture is
    expect([...playingTiles(small, MAP_VIEW_1X, W, H, new Map([['s', { face: tileFace(80, 80) }]]))]).toEqual(['s', 'm'])
  })
})

describe('the glide spring (M1, 10-31)', () => {
  it('runs from 0 to 1, about 1.5% over on the way', () => {
    const c = springCurve()
    expect(c).toHaveLength(31)
    expect(c[0]).toBe(0)
    expect(c[30]).toBe(1)
    expect(Math.max(...c)).toBeGreaterThan(1.01)
    expect(Math.max(...c)).toBeLessThan(1.02)
  })
})

describe('paceHeat', () => {
  const heat = (pace: number, c24 = 100, c1h = 10) => paceHeat({ c24, c1h, pace })

  it('colours past a dead zone around its own pace, full by 2.75× either way', () => {
    expect(heat(1)).toBeNull()
    expect(heat(1.19)).toBeNull()
    expect(heat(0.84)).toBeNull()
    expect(heat(1.25)).toEqual({ dir: 'up', mix: 20 })
    expect(heat(0.5)).toEqual({ dir: 'dn', mix: 43 })
    expect(heat(2.75)).toEqual({ dir: 'up', mix: 58 })
    expect(heat(8)).toEqual({ dir: 'up', mix: 58 })
    expect(heat(1 / 8)).toEqual({ dir: 'dn', mix: 58 })
  })

  it('leaves a tile plain under 30 uses or with no top 10 this hour', () => {
    expect(heat(4, 29)).toBeNull()
    expect(heat(4, 30)).not.toBeNull()
    expect(heat(4, 100, 0)).toBeNull()
    expect(heat(0, 100, 5)).toBeNull()
  })
})

describe('emoteMomentRows', () => {
  const lul = { e: { name: 'LUL', provider: 'twitch', count: 1 }, prov: 'twitch' }
  const row = (name: string, provider: string, cmp: { x: number } | { why: string }, at: number, series: 'chat' | 'emotes' = 'emotes') => ({ series, topEmote: { name, provider }, cmp, at })

  it('keeps emote spikes led by the same provider and name, biggest × first', () => {
    const rows = [
      row('LUL', 'twitch', { x: 3.1 }, 1),
      row('LUL', 'seventv', { x: 9 }, 2),
      row('LUL', 'twitch', { why: 'new stream' }, 5),
      row('LUL', 'twitch', { x: 6.4 }, 3),
      row('LUL', 'twitch', { x: 12 }, 4, 'chat'),
      { series: 'emotes' as const, topEmote: null, cmp: { x: 20 }, at: 6 },
    ]
    expect(emoteMomentRows(rows, lul).map((r) => r.at)).toEqual([3, 1, 5])
    expect(emoteMomentRows(rows, lul, 1)).toHaveLength(1)
  })
})

describe('nearestTile', () => {
  it('moves to the nearest centre in the arrow direction', () => {
    const tl = { x: 0, y: 0, w: 10, h: 10 }
    const tr = { x: 10, y: 0, w: 10, h: 10 }
    const bl = { x: 0, y: 10, w: 10, h: 10 }
    const br = { x: 10, y: 10, w: 10, h: 10 }
    const tiles = [tl, tr, bl, br]
    expect(nearestTile(tiles, tl, 1, 0)).toBe(tr)
    expect(nearestTile(tiles, tl, 0, 1)).toBe(bl)
    expect(nearestTile(tiles, tl, -1, 0)).toBeNull()
    expect(nearestTile(tiles, br, 0, -1)).toBe(tr)
  })
})

describe('the conveyor', () => {
  it('takes the most used emotes with a picture, weighted uses^0.6', () => {
    const pts = [
      point(0, 6, [em('EmA', 'twitch', 30), em('EmB', 'twitch', 10), { name: 'NoPic', provider: 'twitch', count: 99 }]),
      point(1, 6, [em('EmA', 'twitch', 34), em('EmC', 'bttv', 50)]),
      point(2, 6, [em('EmB', 'twitch', 999)], { bucketComplete: false }),
    ]
    const list = conveyorEmotes(pts)
    expect(list.map((e) => e.url)).toEqual(['https://img.test/twitch/EmA.png', 'https://img.test/bttv/EmC.png', 'https://img.test/twitch/EmB.png'])
    expect(list[0]!.w).toBeCloseTo(64 ** 0.6)
    expect(conveyorEmotes(pts, 2)).toHaveLength(2)
  })

  it('lands the same way on every load', () => {
    const a = conveyorRng(825)
    const b = conveyorRng(825)
    const xs = Array.from({ length: 20 }, () => a())
    expect(Array.from({ length: 20 }, () => b())).toEqual(xs)
    for (const v of xs) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(conveyorRng(0)()).toBe(conveyorRng(1)())
  })
})
