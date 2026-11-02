import { describe, expect, it } from 'vitest'
import type { HubActivityPoint, HubLivePulseMoment } from '../src/lib/publicHub'
import { buildHubV5BarCard, hubV5BarChats, hubV5ChartMoments, hubV5LiveEdge, type HubV5BarCardInput } from '../src/ui/components/hub/v5/hubV5BarCardModel'

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
    bucketComplete: true,
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

describe('buildHubV5BarCard (L1, bar-lock board 11-01)', () => {
  it('names the bar by its time, day and size; the readout holds its numbers', () => {
    const m = card()!
    expect(m.gap).toBe(false)
    expect(m.minutes).toBe(6)
    expect(m.title).toMatch(/^12:00–12:06\sPM$/)
    expect(m.range).toMatch(/^12:00 to 12:06\sPM$/)
    expect(m.day).toBe('Oct 19')
    expect(m.notes).toEqual([])
    expect(m.reason).toBeNull()
    expect(m).not.toHaveProperty('figs')
  })

  it('keeps the slot size the chart reports where the window cuts the bar short', () => {
    expect(card({ endT: T0 + 18 * MIN, barMinutes: 30 })!.minutes).toBe(30)
    expect(card({ endT: T0 + 12 * MIN })!.minutes).toBe(12)
  })

  it('keys the bar by its slot, so a bar a poll grows or trims keeps its key (review 11-01)', () => {
    const points = [point(0), point(1), point(2), point(3)]
    const grown = (endT: number) => card({ points, t: T0 + 12 * MIN, endT, barMinutes: 12 })!.key
    const trimmed = (t: number) => card({ points, t, endT: T0 + 12 * MIN, barMinutes: 12 })!.key
    expect(grown(T0 + 18 * MIN)).toBe(grown(T0 + 24 * MIN))
    expect(trimmed(T0 + 6 * MIN)).toBe(trimmed(T0))
    expect(grown(T0 + 24 * MIN)).not.toBe(trimmed(T0))
  })

  it('says a bar that reaches the closed buckets is the newest, and one whose slot runs past them is so far', () => {
    expect(card()).toMatchObject({ newest: false, soFar: false })
    expect(card({ t: T0 + 12 * MIN, endT: T0 + 18 * MIN })).toMatchObject({ newest: true, soFar: false })
    // A 30-min slot whose buckets end at 18 min.
    expect(card({ endT: T0 + 18 * MIN, barMinutes: 30 })).toMatchObject({ newest: true, soFar: true })
    // An open newest bucket ends the closed ones at its start.
    const open = [point(0), point(1), point(2, { bucketComplete: false })]
    expect(card({ points: open, t: T0 + 6 * MIN, endT: T0 + 12 * MIN })).toMatchObject({ newest: true, soFar: false })
    expect(card({ points: open, t: T0 + 12 * MIN, endT: T0 + 18 * MIN })).toMatchObject({ newest: true, soFar: true })
  })

  it('never reads a missing bucket as zero', () => {
    const m = card({ points: [point(0)], endT: T0 + 12 * MIN })!
    expect(m.gap).toBe(false)
    expect(m.notes).toEqual(['Some minutes in this bar were not measured. Gaps are not zero.'])
  })

  it('is a gap when the bar has no chat or emote counts, with no list and no note', () => {
    const m = card({ points: [point(0, { hasChatRollup: false })] })!
    expect(m.gap).toBe(true)
    expect(m.reason).toBe('No chat or emote counts for this bar.')
    expect(m.notes).toEqual([])
    expect(m.topEmotes).toEqual([])
    expect(m.providers).toBeNull()
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
    expect(m.topEmotes[0].title).toBe('KEKW: 48 uses in this bar, 4 a minute')
    expect(m.topEmotes[1].title).toBe('LUL: at least 12 uses in this bar, ≥1 a minute')
  })

  it('says the names are not in this update unless the bar counted zero emotes (pick 12A)', () => {
    expect(card()!.topEmotesNote).toBeNull()
    expect(card({ points: [point(0, { topEmotes: undefined })] })!.topEmotesNote).toBe('names not in this update')
    expect(card({ points: [point(0, { emotes: 0, seventv: 0, topEmotes: undefined })] })!.topEmotesNote).toBe('none named in this bucket')
    // Chat counted, emotes not: the reply still sent no names, so it never claims chat named none.
    expect(card({ points: [point(0, { emotes: undefined, topEmotes: [] })] })!.topEmotesNote).toBe('names not in this update')
  })

  it('marks the channels of the hub’s own moments inside the bar', () => {
    const m = card({
      moments: [
        moment(),
        moment({ login: 'Soda', streamId: 's2', at: T0 + 5 * MIN }),
        moment({ login: 'ninja', streamId: 's3', at: T0 + 9 * MIN }),
        moment({ login: undefined, at: T0 + 3 * MIN }),
      ],
    })!
    expect([...m.hubMoments].sort()).toEqual(['soda', 'xqc'])
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

  it('has no lock for a bar without points or with a bad range', () => {
    expect(card({ t: T0 + 60 * MIN, endT: T0 + 66 * MIN })).toBeNull()
    expect(card({ endT: T0 })).toBeNull()
  })
})

describe('hubV5LiveEdge', () => {
  it('ends the closed buckets after the newest closed one, or at the open one’s start', () => {
    expect(hubV5LiveEdge([point(1), point(0)], 6)).toBe(T0 + 12 * MIN)
    expect(hubV5LiveEdge([point(0), point(1, { bucketComplete: undefined })], 6)).toBe(T0 + 6 * MIN)
    expect(hubV5LiveEdge([], 6)).toBeNull()
  })
})

describe('hubV5BarChats', () => {
  const row = (login: string | undefined, chatPerMin: number, at = T0): HubLivePulseMoment => ({ offsetSeconds: 0, score: 1, label: '', login, chatPerMin, at })

  it('lists each channel once at its busiest minute, busiest chat first, at most six', () => {
    const rows = [
      row('a', 100), row('b', 300), row('A', 250), row(undefined, 999), row('c', 50),
      row('d', 400), row('e', 10), row('f', 20), row('g', 30),
    ]
    expect(hubV5BarChats(rows).map((r) => [r.login, r.chatPerMin])).toEqual([
      ['d', 400], ['b', 300], ['A', 250], ['c', 50], ['g', 30], ['f', 20],
    ])
  })

  it('breaks a tie by the earlier minute', () => {
    expect(hubV5BarChats([row('late', 50, T0 + MIN), row('early', 50, T0)]).map((r) => r.login)).toEqual(['early', 'late'])
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
