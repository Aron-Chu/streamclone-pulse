/** The hero conveyor's Mix (round 4 board, 11-22): live spikes in colour, and the card's real numbers. */
import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubBucketEmote, HubEmote, HubLivePulseMoment } from '../src/lib/publicHub'
import {
  CONVEYOR_SEP,
  CONVEYOR_SPIKE_MS,
  conveyorCardWords,
  conveyorEmotes,
  conveyorPicKey,
  conveyorShares,
  conveyorSpikes,
  emoteMapData,
  emoteMapId,
} from '../src/ui/components/hub/v5/hubV5EmoteMapModel'

const NOW = Date.UTC(2026, 10, 22, 18, 0)
const MIN = 60_000
const tw = (id: string, size = '1.0') => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${size}`
const em = (name: string, provider: string, count: number, imageUrl = tw(name)): HubBucketEmote => ({ name, provider, count, imageUrl })
const point = (i: number, top: HubBucketEmote[]): HubActivityPoint =>
  ({ t: NOW - 3 * 60 * MIN + i * 30 * MIN, chat: 0, seventv: 0, viewers: 0, emotes: 100, topEmotes: top }) as HubActivityPoint
/** A moment's emote: the same fields, plus the share its row carries. */
const me = (name: string, provider: string, count: number, imageUrl = tw(name)): HubEmote => ({ ...em(name, provider, count, imageUrl), sharePct: 0 }) as HubEmote
const moment = (over: Partial<HubLivePulseMoment>): HubLivePulseMoment =>
  ({ kind: 'emote_spike', login: 'ohnepixel', displayName: 'ohnePixel', at: NOW - MIN, emotesPerMin: 400, topEmotes: [], ...over }) as HubLivePulseMoment
const words = (w: ReturnType<typeof conveyorCardWords>) => w.map((x) => x.text).join('')

describe('the conveyor carries what its card needs', () => {
  it('each emote keeps its name, provider and the emote map id', () => {
    const e = em('LUL', 'twitch', 30)
    const [first] = conveyorEmotes([point(0, [e]), point(1, [e])])
    expect(first).toMatchObject({ url: e.imageUrl, name: 'LUL', provider: 'twitch', id: emoteMapId(e) })
    expect(first!.w).toBeCloseTo(60 ** 0.6)
  })
})

describe('conveyorPicKey', () => {
  it('is one key per picture whatever size the URL asks for', () => {
    expect(conveyorPicKey(tw('abc', '1.0'))).toBe(conveyorPicKey(tw('abc', '3.0')))
    expect(conveyorPicKey('https://cdn.7tv.app/emote/01H/1x.webp')).toBe(conveyorPicKey('https://cdn.7tv.app/emote/01H/4x.avif'))
    expect(conveyorPicKey(tw('abc'))).not.toBe(conveyorPicKey(tw('abd')))
    expect(conveyorPicKey('https://example.test/x.png')).toBe('https://example.test/x.png')
  })
})

describe('conveyorSpikes: the colour means a live emote spike, nothing else', () => {
  const live = [{ login: 'ohnePixel' }, { login: 'jerma985' }]
  const spike = moment({ topEmotes: [me('DinoDance', 'seventv', 115, tw('dino')), me('EDM', 'twitch', 40), me('LUL', 'twitch', 30), me('KEKW', 'bttv', 20)] })

  it('lends its top 3 emotes, keyed by picture, with the channel and the count', () => {
    const got = conveyorSpikes([spike], live, NOW)
    expect([...got.values()].map((k) => k.name)).toEqual(['DinoDance', 'EDM', 'LUL'])
    expect(got.get(conveyorPicKey(tw('dino', '2.0')))).toEqual({ name: 'DinoDance', channel: 'ohnePixel', uses: 115, at: NOW - MIN })
  })

  it('leaves out a chat spike, a spike over 5 minutes old, and a channel no longer live', () => {
    expect(conveyorSpikes([moment({ ...spike, kind: 'chat_spike' })], live, NOW).size).toBe(0)
    expect(conveyorSpikes([moment({ ...spike, at: NOW - CONVEYOR_SPIKE_MS - 1 })], live, NOW).size).toBe(0)
    expect(conveyorSpikes([moment({ ...spike, at: NOW - CONVEYOR_SPIKE_MS })], live, NOW).size).toBe(3)
    expect(conveyorSpikes([spike], [{ login: 'jerma985' }], NOW).size).toBe(0)
    expect(conveyorSpikes(undefined, live, NOW).size).toBe(0)
  })

  it('takes the newest spike when two lend the same emote, and drops a picture the allowlist rejects', () => {
    const older = moment({ login: 'jerma985', displayName: 'Jerma985', at: NOW - 3 * MIN, topEmotes: [me('LUL', 'twitch', 90)] })
    const odd = moment({ at: NOW - 2 * MIN, topEmotes: [me('Odd', 'other', 50, 'http://evil.test/odd.png')] })
    const got = conveyorSpikes([older, spike, odd], live, NOW)
    expect(got.get(conveyorPicKey(tw('LUL')))?.channel).toBe('ohnePixel')
    expect([...got.values()].some((k) => k.name === 'Odd')).toBe(false)
  })
})

describe('conveyorShares: the card reads the emote map’s own share', () => {
  it('is each emote over every use the map counts, over the map’s window', () => {
    const pts = [point(0, [em('LUL', 'twitch', 21), em('KEKW', 'bttv', 79)]), point(1, [em('KEKW', 'bttv', 0)])]
    const data = emoteMapData(pts, 30)
    const sh = conveyorShares(data)!
    expect(sh.byId.get(emoteMapId(em('LUL', 'twitch', 0)))).toBe('21%')
    expect(sh.byId.get(emoteMapId(em('KEKW', 'bttv', 0)))).toBe('79%')
    expect(sh.window).toBe(data!.windowLabel)
    expect(conveyorShares(null)).toBeNull()
  })
})

describe('conveyorCardWords', () => {
  const e = { name: 'LUL', id: 'twitch|u|LUL', provider: 'twitch' }
  const shares = { byId: new Map([['twitch|u|LUL', '21%']]), window: '24 h' }

  it('says its share, its window and its provider', () => {
    expect(words(conveyorCardWords(e, undefined, shares))).toBe('LUL · 21% of emote uses, last 24 h · Twitch')
  })

  it('says its live spike instead, in the moment’s own numbers', () => {
    const k = { name: 'LUL', channel: 'ohnePixel', uses: 1150, at: NOW }
    const w = conveyorCardWords(e, k, shares)
    expect(words(w)).toBe('LUL · spiking in ohnePixel’s chat now · 1,150 uses in the spike')
    expect(w.filter((x) => x.kind).map((x) => x.text)).toEqual(['LUL', '1,150'])
    expect(words(conveyorCardWords(e, { ...k, uses: 1 }, shares))).toBe('LUL · spiking in ohnePixel’s chat now · 1 use in the spike')
  })

  it('gives each separator a word of its own, so the card can wrap whole parts', () => {
    const k = { name: 'LUL', channel: 'ohnePixel', uses: 1150, at: NOW }
    for (const w of [conveyorCardWords(e, k, shares), conveyorCardWords(e, undefined, shares)]) {
      expect(w.filter((x) => x.text === CONVEYOR_SEP)).toHaveLength(2)
      expect(w.filter((x) => x.text !== CONVEYOR_SEP).some((x) => x.text.includes('·'))).toBe(false)
    }
  })

  it('says only what it knows: no share, no provider it cannot name', () => {
    expect(words(conveyorCardWords(e, undefined, null))).toBe('LUL · Twitch')
    expect(words(conveyorCardWords({ ...e, provider: 'other' }, undefined, null))).toBe('LUL')
  })
})
