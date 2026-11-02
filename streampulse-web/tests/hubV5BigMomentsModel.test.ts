import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { normalizePublicHub } from '../src/lib/publicHub'
import {
  BIG_CARDS,
  bigCardPos,
  bigIntoStream,
  bigMeter,
  bigMomentCards,
  bigSlideLabel,
  bigStillEmote,
  bigViewers,
  bigWatchHref,
} from '../src/ui/components/hub/v5/hubV5BigMomentsModel'
import { hubTopRows, topFeedRows, type TopRowData } from '../src/ui/components/hub/v5/hubV5TopModel'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
// The hub answer of 2026-10-30 07:19Z, trimmed: its rows are aldo_geo, e11ysa, findjeremiah and supertf.
const capture = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_live_pulse_20261030.json'), 'utf8')))

const row = (login: string, id = login): TopRowData => ({
  id, login, name: login, streamId: `s-${login}`, offsetSeconds: 600, avatar: null, kind: 'emotes', x: 3, at: 0, game: null, art: null,
  emote: null, emotes: [], rate: 90, usual: 30, viewers: null, live: true, href: `/analytics/moments?m=${id}`, also: [], checked: null,
})
const logins = (rows: readonly { row: TopRowData }[]) => rows.map((c) => c.row.login)

describe('Chat’s big moments: its cards (C1, 11-01)', () => {
  it('keeps the list’s order with one card per channel; a channel’s later rows only add to its "+N more"', () => {
    const cards = bigMomentCards([row('a', 'a1'), row('b', 'b1'), row('a', 'a2'), row('c', 'c1'), row('b', 'b2'), row('a', 'a3')])
    expect(logins(cards)).toEqual(['a', 'b', 'c'])
    expect(cards.map((c) => [c.row.id, c.more])).toEqual([['a1', 2], ['b1', 1], ['c1', 0]])
    expect(bigMomentCards([])).toEqual([])
  })

  it('stops at ten cards; a carded channel’s later rows still count, a new channel’s are left out', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`ch${i}`))
    rows.push(row('ch0', 'ch0-late'))
    const cards = bigMomentCards(rows)
    expect(BIG_CARDS).toBe(10)
    expect(logins(cards)).toEqual(rows.slice(0, 10).map((r) => r.login))
    expect(cards[0]!.more).toBe(1)
    expect(bigMomentCards(rows, 3).map((c) => c.row.login)).toEqual(['ch0', 'ch1', 'ch2'])
  })

  it('takes Top moments today’s rows as they come, from the Moments list and from the hub', () => {
    for (const rows of [topFeedRows(fixture), hubTopRows(capture)]) {
      expect(rows.length).toBeGreaterThan(0)
      const cards = bigMomentCards(rows)
      const firsts = [...new Set(rows.map((r) => r.login))].slice(0, BIG_CARDS)
      expect(logins(cards)).toEqual(firsts)
      // each card is its channel's first row, and its "+N more" its other rows
      for (const c of cards) {
        const mine = rows.filter((r) => r.login === c.row.login)
        expect(c.row).toBe(mine[0])
        expect(c.more).toBe(mine.length - 1)
      }
    }
    expect(['aldo_geo', 'e11ysa', 'findjeremiah', 'supertf']).toEqual(expect.arrayContaining(logins(bigMomentCards(hubTopRows(capture)))))
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
