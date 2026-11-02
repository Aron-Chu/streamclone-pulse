import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { normalizePublicHub } from '../src/lib/publicHub'
import {
  BIG_CARDS,
  BIG_WHEEL_PX,
  BIG_WHEEL_QUIET_MS,
  bigCardPos,
  BIG_LIVE_PICTURE_MS,
  bigDragPx,
  bigFigure,
  bigIntoStream,
  bigLabel,
  bigLivePicture,
  bigMeter,
  bigMomentCards,
  bigSlideLabel,
  bigStillEmote,
  bigViewers,
  bigWatchHref,
  bigWheel,
  bigWheelTurn,
  bigWhen,
} from '../src/ui/components/hub/v5/hubV5BigMomentsModel'
import { hubTopRows, topFeedRows, type TopRowData } from '../src/ui/components/hub/v5/hubV5TopModel'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
// The hub answer of 2026-10-30 07:19Z, trimmed: its rows are aldo_geo, e11ysa, findjeremiah and supertf.
const capture = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_live_pulse_20261030.json'), 'utf8')))

const row = (login: string, id = login): TopRowData => ({
  id, login, name: login, streamId: `s-${login}`, offsetSeconds: 600, avatar: null, kind: 'emotes', x: 3, plain: null, at: 0, game: null, art: null,
  emote: null, emotes: [], rate: 90, usual: 30, viewers: null, live: true, href: `/analytics/moments?m=${id}`, also: [], checked: null,
})
const logins = (rows: readonly { row: TopRowData }[]) => rows.map((c) => c.row.login)

describe('Top moments today: its cards (C1 11-01; one per moment since 11-02)', () => {
  it('makes one card per moment in the list’s order, a channel’s later moments too', () => {
    const cards = bigMomentCards([row('a', 'a1'), row('b', 'b1'), row('a', 'a2'), row('c', 'c1')])
    expect(cards.map((c) => c.row.id)).toEqual(['a1', 'b1', 'a2', 'c1'])
    expect(bigMomentCards([])).toEqual([])
  })

  it('stops at ten cards', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`ch${i % 4}`, `m${i}`))
    expect(BIG_CARDS).toBe(10)
    expect(bigMomentCards(rows).map((c) => c.row.id)).toEqual(rows.slice(0, 10).map((r) => r.id))
    expect(bigMomentCards(rows, 3).map((c) => c.row.id)).toEqual(['m0', 'm1', 'm2'])
  })

  it('takes Top moments today’s rows as they come, from the Moments list and from the hub', () => {
    for (const rows of [topFeedRows(fixture), hubTopRows(capture)]) {
      expect(rows.length).toBeGreaterThan(0)
      expect(bigMomentCards(rows).map((c) => c.row)).toEqual(rows.slice(0, BIG_CARDS))
    }
    expect(['aldo_geo', 'e11ysa', 'findjeremiah', 'supertf', 'jinnytty']).toEqual(expect.arrayContaining(logins(bigMomentCards(hubTopRows(capture)))))
  })
})

describe('Top moments today: a sideways wheel and a drag (11-02)', () => {
  it('turns one page a wheel gesture, once its deltas reach 50 px either way', () => {
    const w = bigWheel()
    expect(bigWheelTurn(w, 20, 0)).toBe(0)
    expect(bigWheelTurn(w, 20, 16)).toBe(0)
    expect(bigWheelTurn(w, 20, 32)).toBe(1)
    // the rest of that gesture, its glide included, turns nothing more
    for (let t = 48; t < 1000; t += 16) expect(bigWheelTurn(w, 30, t)).toBe(0)
    // a rest of 180 ms ends it; the next one turns back
    expect(bigWheelTurn(w, -60, 1000 + BIG_WHEEL_QUIET_MS + 1)).toBe(-1)
    expect(BIG_WHEEL_PX).toBe(50)
  })

  it('turns one page a wheel notch, a notch at a time', () => {
    const w = bigWheel()
    expect(bigWheelTurn(w, 100, 0)).toBe(1)
    expect(bigWheelTurn(w, 100, 300)).toBe(1)
    expect(bigWheelTurn(w, 100, 350)).toBe(0)
  })

  it('lets the cards follow a drag at most half the stage either way', () => {
    expect(bigDragPx(-80, 600)).toBe(-80)
    expect(bigDragPx(900, 600)).toBe(300)
    expect(bigDragPx(-900, 600)).toBe(-300)
  })
})

describe('Chat’s big moments: where each card sits', () => {
  const at = (front: number, n: number) => Array.from({ length: n }, (_, k) => bigCardPos(k, front, n))

  it('puts the front card at 0 and its neighbours the short way round', () => {
    expect(at(0, 1)).toEqual([0])
    expect(at(0, 2)).toEqual([0, 1])
    expect(at(1, 2)).toEqual([1, 0])
    expect(at(0, 3)).toEqual([0, 1, -1])
    expect(at(2, 3)).toEqual([1, -1, 0])
    expect(at(0, 5)).toEqual([0, 1, 2, -2, -1])
    expect(at(4, 5)).toEqual([1, 2, -2, -1, 0])
  })

  it('sends cards past two steps far away', () => {
    expect(at(0, 10)).toEqual([0, 1, 2, 'far', 'far', 'far', 'far', 'far', -2, -1])
  })
})

describe('Chat’s big moments: the card’s words and pictures', () => {
  it('says how far into the stream, from a minute in', () => {
    expect(bigIntoStream(null)).toBeNull()
    expect(bigIntoStream(undefined)).toBeNull()
    expect(bigIntoStream(Number.NaN)).toBeNull()
    expect(bigIntoStream(20)).toBeNull()
    expect(bigIntoStream(30)).toBe('1 min into the stream')
    expect(bigIntoStream(42 * 60)).toBe('42 min into the stream')
    expect(bigIntoStream(125 * 60)).toBe('2 h 5 min into the stream')
  })

  it('measures now against the usual, the larger as the full bar, and only with both', () => {
    expect(bigMeter({ rate: 120, usual: 40 })).toEqual({ now: 120, usual: 40, nowPct: 100, usualPct: 33.3 })
    expect(bigMeter({ rate: 30, usual: 60 })).toEqual({ now: 30, usual: 60, nowPct: 50, usualPct: 100 })
    expect(bigMeter({ rate: null, usual: 40 })).toBeNull()
    expect(bigMeter({ rate: 120, usual: null })).toBeNull()
    expect(bigMeter({ rate: 0, usual: 40 })).toBeNull()
    expect(bigMeter({ rate: Number.POSITIVE_INFINITY, usual: 40 })).toBeNull()
  })

  it('holds a Twitch emote still with its /static/ file and leaves every other picture as it is', () => {
    const twitch = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7d75dd841ab0413c97032582c6af9849/default/dark/2.0'
    expect(bigStillEmote(twitch)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7d75dd841ab0413c97032582c6af9849/static/dark/2.0')
    expect(bigStillEmote('https://static-cdn.jtvnw.net/emoticons/v2/301696583/default/dark/2.0')).toBe('https://static-cdn.jtvnw.net/emoticons/v2/301696583/static/dark/2.0')
    // a still 7TV emote has no _static file, so its plain file stays
    expect(bigStillEmote('https://cdn.7tv.app/emote/01GB4CK01800090V9B3D8CGEEX/2x.webp')).toBe('https://cdn.7tv.app/emote/01GB4CK01800090V9B3D8CGEEX/2x.webp')
    expect(bigStillEmote(undefined)).toBeUndefined()
  })

  it('names each slide, counts viewers short and links the channel', () => {
    expect(bigSlideLabel({ name: 'Aldo_Geo', kind: 'emotes', x: 5.24 }, 0, 3)).toBe('1 of 3: Aldo_Geo, emote spike, 5.2 times usual emotes')
    expect(bigSlideLabel({ name: 'supertf', kind: 'chat', x: 12.4 }, 2, 3)).toBe('3 of 3: supertf, chat spike, 12 times usual chat')
    expect(bigViewers(5600)).toBe('5.6K')
    expect(bigViewers(940)).toBe('940')
    expect(bigWatchHref('aldo_geo')).toBe('https://www.twitch.tv/aldo_geo')
  })
})

describe('Top moments today: cards with no × (board 2A, 11-02)', () => {
  it('says why a card has no × and shows its rate instead', () => {
    expect(bigLabel({ kind: 'emotes', plain: null })).toBe('Emote spike')
    expect(bigLabel({ kind: 'chat', plain: 'busiest' })).toBe('Busiest minute')
    expect(bigLabel({ kind: 'emotes', plain: 'early' })).toBe('Early in the stream')
    expect(bigLabel({ kind: 'emotes', plain: 'unmatched' })).toBe('Emote spike · not compared')
    expect(bigFigure({ x: 2.43, rate: 900 })).toBe('2.4×')
    expect(bigFigure({ x: null, rate: 1204 })).toBe('1,204')
    expect(bigSlideLabel({ name: 'kaicenat', kind: 'chat', x: null, plain: 'busiest', rate: 1204 }, 3, 10)).toBe('4 of 10: kaicenat, Busiest minute, 1,204 chat a minute')
    expect(bigSlideLabel({ name: 'jinnytty', kind: 'emotes', x: null, plain: 'early', rate: 181 }, 0, 2)).toBe('1 of 2: jinnytty, Early in the stream, 181 emotes a minute')
  })
})

describe('Top moments today: today and a live picture (HUB-6, 11-02)', () => {
  const now = new Date(2026, 10, 2, 0, 44).getTime()
  it('says how long ago a moment before midnight was, never "Yesterday"', () => {
    expect(bigWhen(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(bigWhen(new Date(2026, 10, 1, 19, 44).getTime(), now)).toBe('5 h ago')
    expect(bigWhen(new Date(2026, 10, 1, 0, 50).getTime(), now)).toBe('23 h ago')
    const noon = new Date(2026, 10, 2, 14, 0).getTime()
    expect(bigWhen(new Date(2026, 10, 2, 9, 5).getTime(), noon)).toMatch(/^9:05\sAM$/)
  })

  it('shows a stream’s live picture only behind a moment under 10 minutes old', () => {
    expect(BIG_LIVE_PICTURE_MS).toBe(10 * 60_000)
    expect(bigLivePicture(now - 9 * 60_000, now)).toBe(true)
    expect(bigLivePicture(now - 10 * 60_000, now)).toBe(false)
    expect(bigLivePicture(now - 84 * 60_000, now)).toBe(false)
  })
})
