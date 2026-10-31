import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubLivePulseMoment } from '../src/lib/publicHub'
import { buildHubV5BarCard, hubV5ChartMoments, type HubV5BarCardInput } from '../src/ui/components/hub/v5/hubV5BarCardModel'

const FORMAT = { locale: 'en-US', timeZone: 'UTC' }
const MIN = 60_000
const T0 = Date.UTC(2026, 9, 19, 12, 0)

function point(i: number, over: Partial<HubActivityPoint> = {}): HubActivityPoint {
  return {
    t: T0 + i * 6 * MIN,
    chat: 600,
    emotes: 120,
    seventv: 60,
    viewers: 40_000,
    viewerCoverage: 'complete',
    hasChatRollup: true,
    hasViewerRollup: true,
    topEmotes: [
      { name: 'KEKW', provider: 'twitch', imageUrl: 'https://img.test/kekw', count: 30 },
      { name: 'OMEGALUL', provider: 'bttv', imageUrl: 'https://img.test/omega', count: 20 },
    ],
    ...over,
  }
}

function moment(over: Partial<HubLivePulseMoment> = {}): HubLivePulseMoment {
  return {
    offsetSeconds: 120,
    score: 1,
    label: 'Emote spike',
    login: 'xqc',
    displayName: 'xQc',
    streamId: 's1',
    at: T0 + 2 * MIN,
    topEmotes: [{ name: 'KEKW', count: 44, sharePct: 10, imageUrl: 'https://img.test/kekw' }],
    ...over,
  }
}

function card(over: Partial<HubV5BarCardInput> = {}) {
  return buildHubV5BarCard({
    points: [point(0), point(1), point(2)],
    bucketMinutes: 6,
    t: T0,
    endT: T0 + 6 * MIN,
    moments: [],
    format: FORMAT,
    ...over,
  })
}

describe('buildHubV5BarCard (R5-8 option A)', () => {
  it('reads one bucket as per-minute rates and a viewer sample', () => {
    const m = card()!
    expect(m.gap).toBe(false)
    expect(m.minutes).toBe(6)
    expect(m.stateLabel).toBe('Bucket selected · 6 min')
    expect(m.title).toMatch(/^12:00–12:06\sPM$/)
    expect(m.when).toBe('Oct 19 local time')
    expect(m.figs.map((f) => [f.key, f.label, f.valueText, f.third])).toEqual([
      ['chat', 'chat/min', '100', null],
      ['emotes', 'emotes/min', '20', null],
      ['viewers', 'viewers (sample)', '40,000', null],
    ])
    expect(m.notes).toEqual([])
  })

  it('averages a merged bar over its measured minutes and puts the busiest bucket on the third line', () => {
    const m = card({
      points: [point(0, { chat: 600, viewers: 30_000 }), point(1, { chat: 1_200, viewers: 50_000 })],
      endT: T0 + 12 * MIN,
    })!
    expect(m.stateLabel).toBe('Bucket selected · 12 min')
    expect(m.figs[0]).toMatchObject({ valueText: '150', third: 'peak 200' })
    expect(m.figs[0].title).toMatch(/^Peak 200 \/min at 12:06\sPM$/)
    expect(m.figs[2]).toMatchObject({ valueText: '40,000', third: 'peak 50K' })
    expect(m.figs[2].title).toMatch(/^Peak 50,000 viewers at 12:06\sPM$/)
  })

  it('shortens a five-digit peak so it fits a phone tile', () => {
    const m = card({
      points: [point(0, { chat: 60_000 }), point(1, { chat: 74_100 })],
      endT: T0 + 12 * MIN,
    })!
    expect(m.figs[0].third).toBe('peak 12.4K')
  })

  it('never reads a missing bucket as zero', () => {
    const m = card({ points: [point(0)], endT: T0 + 12 * MIN })!
    expect(m.figs[0].valueText).toBe('100')
    expect(m.figs[2].third).toBe('1 of 2 buckets sampled')
    expect(m.notes).toEqual(['Some minutes in this bar were not measured. Gaps are not zero.'])
  })

  it('says a bar with no viewer sample is not a full sample', () => {
    const m = card({ points: [point(0, { viewerCoverage: undefined })] })!
    expect(m.figs[2]).toMatchObject({ value: null, valueText: '—', third: 'not a full sample' })
  })

  it('is a gap card when the bar has no chat or emote counts', () => {
    const m = card({ points: [point(0, { hasChatRollup: false })] })!
    expect(m.gap).toBe(true)
    expect(m.stateLabel).toBe('Bucket selected')
    expect(m.reason).toBe('No chat or emote counts for this bar.')
    expect(m.summary).toMatch(/^Bucket selected, 12:00 to 12:06\sPM\. Not measured\.$/)
  })

  it('ranks the top three emotes per minute and marks a minimum with ≥', () => {
    const m = card({
      points: [
        point(0, { topEmotes: [{ name: 'KEKW', provider: 'twitch', count: 30 }, { name: 'LUL', provider: 'twitch', count: 12 }, { name: 'Pog', provider: 'twitch', count: 6 }, { name: 'Kappa', provider: 'twitch', count: 3 }] }),
        point(1, { topEmotes: [{ name: 'KEKW', provider: 'twitch', count: 18 }, { name: 'Pog', provider: 'twitch', count: 6 }] }),
      ],
      endT: T0 + 12 * MIN,
    })!
    expect(m.topEmotes.map((e) => [e.name, e.rateText, e.lowerBound])).toEqual([
      ['KEKW', '4', false],
      ['LUL', '≥1', true],
      ['Pog', '1', false],
    ])
    expect(m.topEmotesExact).toBe(false)
    expect(m.topEmotes[0].title).toBe('KEKW: at least 48 uses in this bucket, ≥4/min')
  })

  it('says the names are not in this update unless the bar counted zero emotes (pick 12A)', () => {
    expect(card()!.topEmotesNote).toBeNull()
    expect(card({ points: [point(0, { topEmotes: undefined })] })!.topEmotesNote).toBe('names not in this update')
    expect(card({ points: [point(0, { emotes: 0, seventv: 0, topEmotes: undefined })] })!.topEmotesNote).toBe('none named in this bucket')
    // Chat counted, emotes not: the reply still sent no names, so it never claims chat named none.
    expect(card({ points: [point(0, { emotes: undefined, topEmotes: [] })] })!.topEmotesNote).toBe('names not in this update')
  })

  it('lists the detected moments inside the bar, oldest first, as Moments links', () => {
    const inside = moment()
    const later = moment({ login: 'soda', displayName: 'Sodapoppin', streamId: 's2', offsetSeconds: 300, at: T0 + 5 * MIN, label: '' })
    const outside = moment({ login: 'ninja', streamId: 's3', at: T0 + 9 * MIN })
    const m = card({ moments: [later, outside, inside], avatars: new Map([['soda', 'https://img.test/soda']]) })!
    expect(m.moments.total).toBe(2)
    expect(m.moments.note).toBeNull()
    expect(m.moments.items.map((i) => [i.channel, i.href, i.label, i.avatar])).toEqual([
      ['xQc', '/analytics/moments?login=xqc&stream=s1&offset=120', 'Emote spike', null],
      ['Sodapoppin', '/analytics/moments?login=soda&stream=s2&offset=300', 'Detected moment', 'https://img.test/soda'],
    ])
    expect(m.moments.items[0].aria).toMatch(/^xQc at 12:02\sPM, Emote spike\. Opens in Moments$/)
    expect(m.moments.items[0].topEmote).toEqual({ name: 'KEKW', count: 44, imageUrl: 'https://img.test/kekw' })
    expect(m.summary).toMatch(/2 moments\.$/)
  })

  it('says how many of the hub’s moments the chart holds when none is in the bar', () => {
    const m = card({ moments: [moment({ at: T0 + 9 * MIN }), moment({ login: undefined, at: T0 + 10 * MIN })] })!
    expect(m.moments.items).toEqual([])
    expect(m.moments.note).toBe('none of the hub’s 1')
  })

  it('shows 7TV and other only when every bucket certifies complete provider counts', () => {
    const certified = { providerCountsComplete: true, seventv: 60, twitch: 40, bttv: 10, ffz: 10 }
    const ok = card({ points: [point(0, certified), point(1, certified)], endT: T0 + 12 * MIN })!
    expect(ok.providers).toEqual({ sevenTv: 10, other: 10 })
    const one = card({ points: [point(0, certified), point(1)], endT: T0 + 12 * MIN })!
    expect(one.providers).toBeNull()
    const over = card({ points: [point(0, { ...certified, twitch: 100 })] })!
    expect(over.providers).toBeNull()
  })

  it('has no card for a bar without points or with a bad range', () => {
    expect(card({ t: T0 + 60 * MIN, endT: T0 + 66 * MIN })).toBeNull()
    expect(card({ endT: T0 })).toBeNull()
  })
})

describe('hubV5ChartMoments', () => {
  it('keeps the moments inside the chart span with a channel, oldest first', () => {
    const points = [point(0), point(1)]
    const list = hubV5ChartMoments(points, 6, [
      moment({ at: T0 + 11 * MIN, streamId: 'b' }),
      moment({ at: T0 - MIN, streamId: 'early' }),
      moment({ at: T0 + 13 * MIN, streamId: 'late' }),
      moment({ at: T0 + 3 * MIN, streamId: 'a' }),
      moment({ at: T0 + 4 * MIN, login: '' }),
    ])
    expect(list.map((m) => m.streamId)).toEqual(['a', 'b'])
  })
})
