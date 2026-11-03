import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { checkMoment, topBursts } from '../src/lib/momentsChecked'
import { normalizePublicHub, type HubLiveChannel, type HubLivePulseMoment, type PublicHub } from '../src/lib/publicHub'
import {
  TOP_DAY_MS, TOP_ROWS, hubTopRows, topCount, topDayParse, topDayRows, topFeedRows, topFrom, topGames, topMomentsHref, topRowAria, type TopRowData,
} from '../src/ui/components/hub/v5/hubV5TopModel'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const NOW = fixture.generatedAt
const MIN = 60_000

describe('Top moments today window', () => {
  it('reads the last 24 hours from a start floored to 10 minutes, so readers in those 10 minutes share the URL', () => {
    const t = Date.UTC(2026, 9, 25, 12, 34, 41, 500)
    expect(topFrom(t)).toBe(Date.UTC(2026, 9, 24, 12, 30))
    expect(topFrom(t + 5 * MIN)).toBe(topFrom(t))
    expect(topFrom(t + 6 * MIN)).toBe(Date.UTC(2026, 9, 24, 12, 40))
  })
})

describe('Top moments today from the Moments list', () => {
  it('keeps the Moments page rule: moments that hold up and rose, one per burst, at most 20', () => {
    const rows = topFeedRows(fixture)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(TOP_ROWS)
    const want = topBursts(fixture.items.map((item) => checkMoment(item, NOW)).filter((m) => m.rowX != null)).slice(0, TOP_ROWS)
    expect(rows.map((r) => r.id)).toEqual(want.map((m) => m.item.id))
    for (const r of rows) expect([r.checked?.item.verdict, r.checked?.item.checks.rise?.code]).toEqual(['ok', 'rose'])
    expect(rows[0]!.href).toBe(`/analytics/moments?m=${encodeURIComponent(rows[0]!.id)}`)
  })

  it('counts the day as the moments that hold up, else the feed total', () => {
    expect(topCount({ total: 40, verdicts: { ok: 20, warn: 6, bad: 14 } })).toBe(20)
    expect(topCount({ total: 40, verdicts: null })).toBe(40)
  })

  it('lists the day’s games, keeping a picked game that a read left empty', () => {
    const cats = [
      { id: '1', name: 'Overwatch', moments: 8, liveChannels: 2 },
      { id: '2', name: 'Dota 2', moments: 0, liveChannels: 0 },
    ]
    expect(topGames(cats).map((g) => g.name)).toEqual(['Overwatch'])
    expect(topGames(cats, { id: '2', name: 'Dota 2', art: null, moments: 3 })).toEqual([
      expect.objectContaining({ name: 'Overwatch', moments: 8 }),
      { id: '2', name: 'Dota 2', art: null, moments: 0 },
    ])
    expect(topGames(null)).toEqual([])
  })

  it('sends "Every moment" to the Moments page’s Top, on the picked game', () => {
    expect(topMomentsHref(null)).toBe('/analytics/moments?view=top')
    expect(topMomentsHref('509672')).toBe('/analytics/moments?view=top&game=509672')
  })
})

/* The hub's own moments, when the list is off or does not answer. */

const T = Date.UTC(2026, 9, 30, 7, 0)

function pulse(login: string, x: number | null, over: Partial<HubLivePulseMoment> = {}): HubLivePulseMoment {
  return {
    login,
    displayName: login.toUpperCase(),
    streamId: `s-${login}`,
    offsetSeconds: 3600,
    at: T,
    score: 80,
    label: 'Emote spike',
    chatPerMin: 100,
    emotesPerMin: 300,
    topEmoteCode: 'KEKW',
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 240, sharePct: 0 }],
    category: 'Chess',
    comparison: x == null ? undefined : {
      emotes: { state: 'ready', currentPerMin: 300, baselinePerMin: Math.round(300 / x), multiplier: x, baselineMeasuredMinutes: 40 },
    },
    ...over,
  } as HubLivePulseMoment
}

const hubOf = (livePulseMoments: HubLivePulseMoment[], liveChannels: HubLiveChannel[] = [], generatedAt = new Date(T + 30 * MIN).toISOString()) =>
  ({ livePulseMoments, liveChannels, generatedAt }) as unknown as Pick<PublicHub, 'liveChannels' | 'livePulseMoments' | 'generatedAt'>

describe('Top moments today from the hub', () => {
  it('leaves out a stream’s first 20 minutes and anything under a ready 1.5×', () => {
    const rows = hubTopRows(hubOf([
      pulse('early', 6, { offsetSeconds: 19 * 60 + 59, topEmotes: [] }),
      pulse('low', 1.4, { topEmotes: [] }),
      pulse('warming', null, { comparison: { emotes: { state: 'warming' } } as HubLivePulseMoment['comparison'], topEmotes: [] }),
      pulse('none', null, { topEmotes: [] }),
      pulse('edge', 1.5, { offsetSeconds: 20 * 60, topEmotes: [] }),
    ]))
    expect(rows.map((r) => r.login)).toEqual(['edge'])
    expect(hubTopRows(null)).toEqual([])
  })

  it('keeps the last 24 hours by the answer’s clock: a long stream’s older peak drops out', () => {
    const asOf = T + 30 * MIN
    const rows = hubTopRows(hubOf([
      pulse('kept', 3, { at: asOf - TOP_DAY_MS + MIN, offsetSeconds: 30 * 3600, topEmotes: [] }),
      pulse('old', 9, { at: asOf - TOP_DAY_MS - MIN, offsetSeconds: 30 * 3600, topEmotes: [] }),
    ], [], new Date(asOf).toISOString()))
    expect(rows.map((r) => r.login)).toEqual(['kept'])
  })

  it('puts the strongest × first, the newer first on a tie', () => {
    const rows = hubTopRows(hubOf([
      pulse('alpha', 2, { topEmotes: [] }),
      pulse('bravo', 9, { topEmotes: [] }),
      pulse('charlie', 2, { at: T + 2 * MIN, topEmotes: [] }),
    ]))
    expect(rows.map((r) => r.login)).toEqual(['bravo', 'charlie', 'alpha'])
  })

  it('folds channels that counted the same emotes in the same minute into the stronger row', () => {
    const rows = hubTopRows(hubOf([
      pulse('alpha', 4, { at: T + 20_000 }),
      pulse('bravo', 12),
      pulse('charlie', 3, { at: T + 5 * MIN }),
    ]))
    expect(rows.map((r) => [r.login, r.also])).toEqual([['bravo', ['ALPHA']], ['charlie', []]])
  })

  it('keeps one row a burst: a stream’s strongest minute within 5 minutes', () => {
    const rows = hubTopRows(hubOf([
      pulse('alpha', 3, { topEmotes: [] }),
      pulse('alpha', 5, { at: T + 4 * MIN, offsetSeconds: 3840, topEmotes: [] }),
      pulse('alpha', 2, { at: T + 9 * MIN, offsetSeconds: 4140, topEmotes: [] }),
      pulse('alpha', 2.5, { at: T + 3 * MIN, streamId: 's-other', topEmotes: [] }),
    ]))
    expect(rows.map((r) => [r.x, r.streamId])).toEqual([[5, 's-alpha'], [2.5, 's-other'], [2, 's-alpha']])
  })

  it('fills a row from the moment and the live channels', () => {
    const live = { login: 'Alpha', displayName: 'ALPHA', streamId: 's-alpha', profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/a-300x300.png' } as HubLiveChannel
    const [row] = hubTopRows(hubOf([pulse('alpha', 4, { boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/743-52x72.jpg', viewers: 900 })], [live]))
    expect(row).toMatchObject({
      login: 'alpha', name: 'ALPHA', kind: 'emotes', x: 4, at: T, game: 'Chess', live: true, viewers: 900, rate: 300, usual: 75,
      avatar: live.profileImageUrl, art: 'https://static-cdn.jtvnw.net/ttv-boxart/743-52x72.jpg', checked: null,
      emote: { name: 'KEKW', count: 240 }, href: '/analytics/moments?login=alpha&stream=s-alpha&offset=3600',
    })
    const [rejected] = hubTopRows(hubOf([pulse('alpha', 4, { boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/743-52x72.jpg', categoryMetadataRejected: true })]))
    expect(rejected!.art).toBeNull()
    expect(rejected!.live).toBe(false)
  })

  it('shows at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => pulse(`c${i}`, 2 + i / 10, { topEmotes: [] }))
    expect(hubTopRows(hubOf(many))).toHaveLength(TOP_ROWS)
  })

  it('turns the 10-30 hub answer into its six standout moments', () => {
    // The hub answer of 2026-10-30 07:19Z, trimmed: 10 livePulseMoments and 6 of its live channels.
    const capture = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_live_pulse_20261030.json'), 'utf8')))
    const rows = hubTopRows(capture)
    expect(rows.map((r) => [r.login, r.x, r.game, r.also])).toEqual([
      ['findjeremiah', 68.1, 'IRL', []],
      ['e11ysa', 50.06, 'Just Chatting', ['findjeremiah']],
      ['e11ysa', 38.41, 'Just Chatting', ['findjeremiah']],
      ['aldo_geo', 14.08, 'QSMP', []],
      ['supertf', 2.97, 'Just Chatting', []],
      ['supertf', 2.47, 'Just Chatting', []],
    ])
    // a stream's first 20 minutes stays out
    expect(rows.some((r) => r.login === 'jinnytty')).toBe(false)
  })
})

describe('Top moments today: the day’s hub rows this browser kept (11-02)', () => {
  const T = Date.UTC(2026, 10, 2, 3, 0)
  const r = (id: string, over: Partial<TopRowData> = {}): TopRowData => ({
    id, login: id.split('-')[0]!, name: id, streamId: `s-${id.split('-')[0]}`, offsetSeconds: 1800, avatar: null, kind: 'chat', x: 2, at: T - 60 * MIN,
    game: null, art: null, emote: null, emotes: [], rate: 90, usual: 30, viewers: null, live: true, href: `/analytics/moments?m=${id}`, also: [], checked: null,
    ...over,
  })

  it('adds the kept rows to the hub’s, strongest × first, at most 20', () => {
    const rows = topDayRows([r('a-1', { x: 5 }), r('b-1', { x: 1.6, at: T - 300 * MIN })], [r('c-1', { x: 3 })], new Set(['c']), T)
    expect(rows.map((x) => x.id)).toEqual(['a-1', 'c-1', 'b-1'])
    expect(topDayRows(Array.from({ length: 30 }, (_, i) => r(`k${i}-1`, { x: 2 + i })), [], new Set(), T)).toHaveLength(TOP_ROWS)
  })

  it('lets the hub’s answer win: its own row by id, and its row in the same burst', () => {
    const rows = topDayRows([r('a-1', { x: 9, live: false }), r('a-2', { x: 8, at: T - 62 * MIN })], [r('a-1', { x: 4 })], new Set(['a']), T)
    expect(rows.map((x) => [x.id, x.x])).toEqual([['a-1', 4]])
  })

  it('drops kept rows older than 24 hours, and says a kept row is live only while its channel is', () => {
    const rows = topDayRows([r('a-1', { at: T - TOP_DAY_MS - MIN }), r('b-1', { live: true }), r('c-1', { live: false, x: 1.7 })], [], new Set(['c']), T)
    expect(rows.map((x) => [x.id, x.live])).toEqual([['b-1', false], ['c-1', true]])
  })

  it('reads back what it saved, field by field, and drops anything else', () => {
    const saved = JSON.parse(JSON.stringify([r('a-1', { emotes: [{ name: 'KEKW', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/2.0', count: 9 }] })]))
    const back = topDayParse(saved)
    expect(back).toEqual([{ ...r('a-1', { emotes: [{ name: 'KEKW', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/2.0', count: 9 }] }), live: false }])
    expect(topDayParse({ rows: [] })).toEqual([])
    expect(topDayParse([null, 3, { ...saved[0], x: '2' }, { ...saved[0], kind: 'bits' }, { ...saved[0], href: 'https://evil.example/' }, { ...saved[0], href: '//evil.example/analytics' }])).toEqual([])
  })
})

describe('Top moments today row words', () => {
  const now = T + 30 * MIN
  const [hubRow] = hubTopRows(hubOf([pulse('alpha', 12, { at: now - 13 * MIN })]))
  const feedRow = topFeedRows(fixture)[0]!

  it('says the rank, who, what rose, the game and when, then what a click does', () => {
    // the phone peek's rows bring their card to the front of the carousel below
    expect(topRowAria(hubRow!, 1, now)).toMatch(/^1\. ALPHA, KEKW, emotes 12 times usual, Chess, 13 min ago at .+\. Open it in Top moments below\.$/)
    expect(topRowAria(feedRow, 2, NOW)).toMatch(/^2\. .+ Open it in Top moments below\.$/)
  })

  it('names the channels folded into a row', () => {
    const [row] = hubTopRows(hubOf([pulse('alpha', 4), pulse('bravo', 12)]))
    expect(topRowAria(row!, 1, T + MIN)).toContain(', the same emotes on ALPHA,')
  })
})
