import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubBucketEmote } from '../src/lib/publicHub'
import {
  EMOTE_FOLD_SHARE,
  conveyorEmotes,
  conveyorRng,
  emoteChange,
  emoteImageAt,
  emoteMapData,
  emoteMapHeight,
  emoteMapLayout,
  emoteMapMeta,
  emoteMomentRows,
  emotePaceText,
  emoteSharePct,
  fieldOf,
  nearestTile,
  squarify,
  tilePic,
  tileSize,
} from '../src/ui/components/hub/v5/hubV5EmoteMapModel'

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
})

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

  it('keeps every emote, as a tile or in its field\'s "+N" tile', () => {
    expect(lay.count).toBe(80)
    expect(lay.mores.length).toBeGreaterThan(0)
    expect(lay.tiles.length + lay.mores.reduce((s, m) => s + m.n, 0)).toBe(80)
    expect(lay.fields.map((f) => f.field).sort()).toEqual(['seventv', 'twitch'])
    for (const m of lay.mores) for (const a of m.emotes) expect(fieldOf(a.prov)).toBe(m.field)
  })

  it('folds emotes under 0.9% of the map', () => {
    for (const t of lay.tiles) expect(t.v / lay.total).toBeGreaterThanOrEqual(EMOTE_FOLD_SHARE)
    for (const m of lay.mores) expect(m.n).toBeGreaterThan(1)
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
      expect(t.pic === 0).toBe(t.size === 'xs')
    }
    expect(lay.tiles.find((t) => t.rank === 1)!.size).toBe('xl')
    expect(lay.ranked.map((x) => x.v)).toEqual(lay.ranked.map((x) => x.v).slice().sort((a, b) => b - a))
  })

  it('shows only emotes from the last hour in the hour view', () => {
    const hour = emoteMapLayout(d, '1h', W, H)
    expect(hour.count).toBe(d.emotes.filter((a) => a.c1h > 0).length)
    const none = emoteMapLayout(d, 'all', 0, H)
    expect(none.tiles).toEqual([])
    expect(none.ranked).toHaveLength(80)
  })

  it('says what the map holds', () => {
    expect(emoteMapMeta(d, lay, 'all')).toBe('80 emotes · sized by uses · last 36 min')
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
    expect(tilePic('xl', 200, 200)).toBe(48)
    expect(tilePic('l', 90, 95)).toBe(36)
    expect(tilePic('row', 140, 36)).toBe(26)
    expect(tilePic('row', 140, 60)).toBe(30)
    expect(tilePic('m', 70, 70)).toBe(28)
    expect(tilePic('s', 30, 30)).toBe(19)
    expect(tilePic('s', 60, 60)).toBe(32)
    expect(tilePic('s', 21, 18)).toBe(12)
    expect(tilePic('xs', 10, 10)).toBe(0)
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
