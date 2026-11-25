import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubLiveChannel, HubLivePulseMoment } from '../src/lib/publicHub'
import { emoteDeck, findHeroEmote, HERO_EMOTES, heroEmoteUrl, isWideEmote } from '../src/ui/components/landing/heroEmotes'
import { chatSources, heroMoments, MADE_UP_CHAT, perLine, ridgeRows, RIDGE_MIN_MINUTES } from '../src/ui/components/landing/heroBackdropModel'
import { meshPerGap } from '../src/ui/components/landing/heroBackdrop/ridge'

const T0 = Date.parse('2026-11-22T18:00:00Z')
const MIN = 60_000

function point(i: number, over: Partial<HubActivityPoint> = {}): HubActivityPoint {
  return { t: T0 + i * MIN, chat: 1000 + i * 10, emotes: 400 + i, seventv: 300 + i, twitch: 80, viewers: 50_000 + i * 100, hasChatRollup: true, hasViewerRollup: true, ...over }
}

function channel(login: string, chatPerMin: number, over: Partial<HubLiveChannel> = {}): HubLiveChannel {
  return { login, viewers: 1000, chatPerMin, seventvPerMin: 0, coverageState: 'live', trendPct: 0, ...over } as HubLiveChannel
}

const ready = (multiplier: number) => ({ state: 'ready', multiplier, currentPerMin: 900, baselineMeasuredMinutes: 20 })

describe('hero emotes', () => {
  it('stores 20-40 emotes, mostly 7TV, with Kappa as Twitch emote 25', () => {
    expect(HERO_EMOTES.length).toBeGreaterThanOrEqual(20)
    expect(HERO_EMOTES.length).toBeLessThanOrEqual(40)
    expect(HERO_EMOTES.filter((e) => e.provider === '7tv').length).toBeGreaterThan(HERO_EMOTES.length / 2)
    expect(new Set(HERO_EMOTES.map((e) => e.name)).size).toBe(HERO_EMOTES.length)
    expect(findHeroEmote('Kappa')?.id).toBe('25')
  })

  it('loads the smallest files: 7TV 1x (animated AVIF, still WebP) and Twitch 1.0', () => {
    for (const e of HERO_EMOTES) {
      const url = heroEmoteUrl(e)
      if (e.provider === 'twitch') expect(url).toMatch(/^https:\/\/static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/1\.0$/)
      else expect(url).toBe(`https://cdn.7tv.app/emote/${e.id}/1x.${e.animated ? 'avif' : 'webp'}`)
    }
  })

  it('marks the wide emotes as wide', () => {
    expect(HERO_EMOTES.filter(isWideEmote).map((e) => e.name).sort()).toEqual(['wideReacting', 'wideSpeedLaugh', 'xdd'])
  })

  it('deals every emote once before any repeats, and skips what the caller passes over', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const deal = emoteDeck(HERO_EMOTES, rand)
    const first = HERO_EMOTES.map(() => deal()?.name)
    expect(new Set(first).size).toBe(HERO_EMOTES.length)
    const noWide = emoteDeck(HERO_EMOTES, rand)
    for (let i = 0; i < 100; i++) expect(isWideEmote(noWide(isWideEmote)!)).toBe(false)
    expect(emoteDeck(HERO_EMOTES, rand)(() => true)).toBeUndefined()
  })
})

describe('chat columns', () => {
  it('takes the busiest measured chats by public name, with each one\'s emote share', () => {
    const sources = chatSources([
      channel('quiet', 0),
      channel('mid', 300, { displayName: 'Mid', emotesPerMin: 150 }),
      channel('busy', 900, { emotesPerMin: 2000 }),
      channel('nan', Number.NaN),
    ])
    expect(sources.map((s) => s.name)).toEqual(['busy', 'Mid'])
    expect(sources[0].emoteShare).toBe(1)
    expect(sources[1].emoteShare).toBe(0.5)
  })

  it('picks a round batch size that keeps each column at about a line a second or slower', () => {
    expect(perLine(0)).toBe(50)
    expect(perLine(6000)).toBe(50)
    expect(perLine(60_000)).toBe(500)
    expect(perLine(200_000)).toBe(2500)
    for (const total of [1, 999, 12_345, 250_000, 3_000_000]) expect(total / perLine(total) / 120).toBeLessThanOrEqual(1)
  })

  it('writes made-up lines no Twitch account could have written, short and about nothing real', () => {
    // More than two full columns hold at 1440 x 900 (38), so no line need show twice at once.
    expect(MADE_UP_CHAT.length).toBeGreaterThanOrEqual(40)
    expect(new Set(MADE_UP_CHAT.map((l) => l.user)).size).toBe(MADE_UP_CHAT.length)
    for (const { user, text } of MADE_UP_CHAT) {
      // A Twitch login is letters, digits and underscores only.
      expect(user).toMatch(/[.-]/)
      expect(user.length).toBeLessThanOrEqual(14)
      expect(text.length).toBeLessThanOrEqual(24)
      expect(`${user} ${text}`).not.toMatch(/pulse|extension|brainchat|kappa|pog/i)
    }
    expect(MADE_UP_CHAT.filter((l) => l.text).length).toBeGreaterThan(MADE_UP_CHAT.length * 0.8)
  })
})

describe('ridge', () => {
  const generatedAt = new Date(T0 + 30 * MIN + 20_000).toISOString()

  it('draws only complete minutes, leaving out the open one', () => {
    const points = Array.from({ length: 31 }, (_, i) => point(i))
    const data = ridgeRows(points, generatedAt, 1)
    expect(data.times).toHaveLength(30)
    expect(data.times.at(-1)).toBe(T0 + 29 * MIN)
    expect(ridgeRows(points.map((p, i) => (i === 3 ? { ...p, bucketComplete: false } : p)), generatedAt, 1).times).toHaveLength(29)
  })

  it('keeps an unrecorded minute as a gap, never a zero', () => {
    const points = Array.from({ length: 30 }, (_, i) => point(i, i === 5 ? { hasChatRollup: false } : i === 6 ? { gapKind: 'outage' as HubActivityPoint['gapKind'] } : {}))
    const chat = ridgeRows(points, generatedAt, 1).rows.find((r) => r.key === 'chat')!
    expect(chat.values[5]).toBeNull()
    expect(chat.values[6]).toBeNull()
    expect(chat.heights[5]).toBeNull()
    expect(chat.values[7]).toBe(1070)
  })

  it('draws a series only with enough recorded minutes, and orders rows far to near with chat nearest', () => {
    const points = Array.from({ length: 30 }, (_, i) => point(i, { bttv: i < RIDGE_MIN_MINUTES - 1 ? 5 : undefined }))
    const keys = ridgeRows(points, generatedAt, 1).rows.map((r) => r.key)
    expect(keys).not.toContain('bttv')
    expect(keys).not.toContain('ffz')
    expect(keys.at(-1)).toBe('chat')
    expect(keys).toEqual(['viewers', 'twitch', 'seventv', 'emotes', 'chat'])
  })

  it('scales each row to itself and says when a provider count is only a lower bound', () => {
    const points = Array.from({ length: 30 }, (_, i) => point(i, { providerCountsLowerBound: i === 2 }))
    const data = ridgeRows(points, generatedAt, 1)
    for (const row of data.rows) for (const h of row.heights) expect(h!).toBeGreaterThanOrEqual(0.1 - 1e-9)
    const chat = data.rows.find((r) => r.key === 'chat')!
    expect(Math.max(...(chat.heights as number[]))).toBeCloseTo(0.7)
    expect(chat.atLeast[2]).toBe(false)
    expect(data.rows.find((r) => r.key === 'seventv')!.atLeast[2]).toBe(true)
    expect(data.rows.find((r) => r.key === 'viewers')!.unit).toBe('watching')
  })

  it('draws nothing without points', () => {
    expect(ridgeRows([], generatedAt, 1).rows).toEqual([])
    expect(ridgeRows(undefined).rows).toEqual([])
  })
})

describe('moments', () => {
  const moment = (login: string, at: number, comparison: unknown, over: Partial<HubLivePulseMoment> = {}) =>
    ({ login, at, kind: 'chat_spike', label: 'Chat spike', offsetSeconds: 0, score: 1, comparison, ...over }) as HubLivePulseMoment

  it('keeps ready moments that rose, newest first and one per channel, in the hub\'s own words', () => {
    const now = T0 + 40 * MIN
    const out = heroMoments([
      moment('a', T0 + 10 * MIN, { chat: ready(3.2) }, { displayName: 'Alpha', topEmoteCode: 'KEKW' }),
      moment('a', T0 + 20 * MIN, { chat: ready(2.1) }, { displayName: 'Alpha' }),
      moment('b', T0 + 15 * MIN, { chat: { state: 'warming', currentPerMin: 100 } }),
      moment('c', T0 + 16 * MIN, { chat: { state: 'new_activity', currentPerMin: 100 } }),
      moment('d', T0 + 17 * MIN, { chat: ready(0.5) }),
      moment('e', T0 + 18 * MIN, { emotes: ready(6.2) }, { kind: 'emote_spike', topEmoteCode: 'NotInTheSet' }),
    ], now)
    expect(out.map((m) => m.login)).toEqual(['a', 'e'])
    expect(out[0]).toMatchObject({ name: 'Alpha', label: 'Chat', series: 'chat', emote: null })
    expect(out[0].short).toMatch(/^2\.1×$/)
    expect(out[1]).toMatchObject({ label: 'Emotes', series: 'emotes', emote: null })
  })

  it('names a moment\'s emote only when it is one of the stored set', () => {
    const out = heroMoments([moment('a', T0, { chat: ready(3) }, { topEmoteCode: 'KEKW' })], T0 + MIN)
    expect(out[0].emote).toBe('KEKW')
  })
})

describe('meshPerGap', () => {
  it('fills the field to about as many lines as the board drew', () => {
    // 7 series, 15 wanted: one surface line in each of the 6 gaps, 13 in all.
    expect(meshPerGap(7, 15)).toBe(1)
    expect(meshPerGap(4, 15)).toBe(4)
    expect(meshPerGap(2, 9)).toBe(7)
  })

  it('draws no surface lines for a single series or a full field', () => {
    expect(meshPerGap(1, 15)).toBe(0)
    expect(meshPerGap(0, 15)).toBe(0)
    expect(meshPerGap(20, 15)).toBe(0)
  })
})
