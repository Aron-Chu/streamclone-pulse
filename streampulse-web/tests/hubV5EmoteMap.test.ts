import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubBucketEmote } from '../src/lib/publicHub'
import {
  conveyorEmotes,
  conveyorRng,
  emoteImageAt,
  emoteMapData,
  emoteMapHeight,
  emoteMapLayout,
  emoteMapMeta,
  emotePaceText,
  emoteSharePct,
  emoteTone,
  nearestTile,
  squarify,
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
    expect(emoteTone(a)).toBe(3)
    expect(b.isNew).toBe(true)
    expect(b.pace).toBeCloseTo(4)
    expect(emoteTone(b)).toBe(5)
    expect(emotePaceText(b)).toBe('new this hour: no top 10 before it')
    expect(c.c1h).toBe(0)
    expect(emoteTone(c)).toBe(0)
    expect(emotePaceText(c)).toBe('no top 10 in the last hour')
    expect(emotePaceText(a, d.windowLabel)).toBe('1.0× its 4 h pace')
  })

  it('cannot compare the last hour when it is the whole window or the intervals are long', () => {
    expect(emoteMapData(fourHours().slice(6, 8), 30)!.paceOk).toBe(false)
    expect(emoteMapData(fourHours().map((p, i) => ({ ...p, t: T0 + i * 60 * MIN })), 60)!.paceOk).toBe(false)
    expect(emoteMapData([], 6)).toBeNull()
  })

  it('maps pace to seven tones', () => {
    expect([0.3, 0.6, 1, 1.5, 3, 5].map((pace) => emoteTone({ c1h: 1, pace }))).toEqual([1, 2, 3, 4, 5, 6])
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
  const lay = emoteMapLayout(d, 'all', W, H, false)

  it('keeps every emote, as a tile or a cell of a "more" block', () => {
    expect(lay.count).toBe(80)
    expect(lay.mores.length).toBeGreaterThan(0)
    expect(lay.tiles.length + lay.mores.reduce((s, m) => s + m.n, 0)).toBe(80)
    expect(lay.segs.map((s) => s.prov).sort()).toEqual(['seventv', 'twitch'])
  })

  it('stays inside the map and follows the tile rules', () => {
    for (const t of lay.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(W + 1e-6)
      expect(t.y + t.h).toBeLessThanOrEqual(H + 1e-6)
      expect(t.cap).toBe(t.w - 2 >= 110 && t.h - 2 >= 104)
      if (t.cap) expect(t.name || t.val).toBe(false)
      expect(t.chip).toBe(t.rank <= 3 && t.w - 2 >= 44 && t.h - 2 >= 44)
      expect(t.img === 0 || t.img >= 14).toBe(true)
    }
    const top = lay.tiles.find((t) => t.rank === 1)!
    expect(top.cap).toBe(true)
    expect(top.chip).toBe(true)
  })

  it('shows only emotes from the last hour in the hour view', () => {
    const hour = emoteMapLayout(d, '1h', W, H, false)
    expect(hour.count).toBe(d.emotes.filter((a) => a.c1h > 0).length)
    expect(emoteMapLayout(d, 'all', 0, H, false).tiles).toEqual([])
  })

  it('says what the map holds', () => {
    expect(emoteMapMeta(d, lay, 'all')).toMatch(/^80 emotes · sized by uses · last 36 min · \d+ pictured$/)
  })
})

describe('emoteMapHeight', () => {
  it('follows the width, within bounds, and taller is 1.8× up to 1000', () => {
    expect(emoteMapHeight(1000, false, false)).toBe(620)
    expect(emoteMapHeight(400, false, false)).toBe(360)
    expect(emoteMapHeight(390, true, false)).toBe(410)
    expect(emoteMapHeight(1000, false, true)).toBe(1000)
    expect(emoteMapHeight(400, false, true)).toBe(648)
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
