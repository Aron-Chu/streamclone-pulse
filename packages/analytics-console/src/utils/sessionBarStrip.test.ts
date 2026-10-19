import { describe, expect, it } from 'vitest'
import type { AnalyticsMinuteRollup, PulseRecapMoment } from '../apiTypes.ts'
import type { VodLinkState } from './twitchVodUrl.ts'
import {
  barMomentLabel,
  bestMomentInSpan,
  buildSessionBarStrip,
  formatStripClock,
  momentPlayAt,
  momentsInBar,
  resolveBarSpan,
  stripClockRange,
  stripRate,
} from './sessionBarStrip.ts'

// xqc 2026-10-14: stream went live 12:31:30 PM PDT; moment 0 at 0:50:54, VOD alignment -5 s
const STARTED = '2026-10-14T19:31:30.000Z'
const START_MS = Date.parse(STARTED)
const TZ = 'America/Los_Angeles'
const at = (off: number) => new Date(START_MS + off * 1000).toISOString()
const LINKED: VodLinkState = { status: 'linked', vodId: '2899924626', label: 'Jump to VOD', detail: '' }

function minute(off: number, extra: Partial<AnalyticsMinuteRollup> = {}): AnalyticsMinuteRollup {
  return {
    minuteTs: at(off),
    viewerAvg: 19455,
    viewerMax: 19600,
    chatCount: 299,
    totalEmoteCount: 250,
    seventvEmoteCount: 218,
    emotes: { 'seventv:01HUH:HUH': 56, 'seventv:01LOL:LOL': 44, 'seventv:01LO:LO': 29, 'twitch:25:Kappa': 2 },
    ...extra,
  }
}

const moment = (offsetSeconds: number, score: number, reasons = ['emote_spike']): PulseRecapMoment =>
  ({ offsetSeconds, score, reasons } as PulseRecapMoment)

describe('formatting', () => {
  it('uses the unpadded stream clock and the card rate rule', () => {
    expect(formatStripClock(3054)).toBe('0:50:54')
    expect(formatStripClock(5 * 3600 + 52 * 60 + 7)).toBe('5:52:07')
    expect(stripRate(56)).toBe('56')
    expect(stripRate(4.36)).toBe('4.4')
    expect(stripRate(0.04)).toBe('<0.1')
  })

  it('shares the day period across a clock range', () => {
    expect(stripClockRange(START_MS + 3054_000, START_MS + 3114_000, TZ)).toBe('1:22–1:23 PM')
  })
})

describe('resolveBarSpan', () => {
  it("takes the chart's bar when given, else the selected minute", () => {
    const rollup = minute(3054)
    expect(resolveBarSpan({ rollup, startedAt: STARTED })).toEqual({ startSec: 3054, endSec: 3114, levelMinutes: 1 })
    expect(resolveBarSpan({
      rollup, startedAt: STARTED,
      barSpan: { startMs: START_MS + 3000_000, endMs: START_MS + 3300_000, levelMinutes: 5 },
    })).toEqual({ startSec: 3000, endSec: 3300, levelMinutes: 5 })
  })
})

describe('moments in a bar', () => {
  const ranked = [moment(3054, 56), moment(9000, 50), moment(3120, 40), moment(3200, 30)]

  it("keeps the Moments list's rank for those whose minute overlaps the bar", () => {
    expect(momentsInBar(ranked, { startSec: 3000, endSec: 3300 }).map((m) => m.rank)).toEqual([1, 3, 4])
    expect(momentsInBar(ranked, { startSec: 3060, endSec: 3120 }).map((m) => m.rank)).toEqual([1])
  })

  it('locks the best-ranked one; without scores, the earliest', () => {
    expect(bestMomentInSpan(ranked, { startSec: 3115, endSec: 3300 })?.offsetSeconds).toBe(3120)
    const unscored = [
      { offsetSeconds: 3200, reasons: [] } as unknown as PulseRecapMoment,
      { offsetSeconds: 3120, reasons: [] } as unknown as PulseRecapMoment,
    ]
    expect(bestMomentInSpan(unscored, { startSec: 3100, endSec: 3300 })?.offsetSeconds).toBe(3120)
    expect(bestMomentInSpan(ranked, { startSec: 6000, endSec: 6060 })).toBeNull()
  })

  it("labels a moment with the backend's reason and score", () => {
    expect(barMomentLabel(moment(3054, 56))).toBe('Emote spike · score 56')
    expect(barMomentLabel({ ...moment(3054, 56, ['chat_spike']), reactionScore: 61.4 })).toBe('Chat spike · score 61')
  })
})

describe('buildSessionBarStrip', () => {
  const base = {
    startedAt: STARTED,
    timeZone: TZ,
    vodLinkState: LINKED,
    vodAlignSeconds: -5,
    vodDurationSeconds: 20000,
    games: [{ gameName: 'Grand Theft Auto V', categoryId: '32982', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-144x192.jpg', offsetSeconds: 0, durationSeconds: 20000 }],
  }

  it("builds the mockup's 1-min strip for the bar that holds moment 1", () => {
    const rows = [minute(2994), minute(3054), minute(3114)]
    const m = buildSessionBarStrip({
      ...base,
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 },
      rollups: rows,
      moments: [{ rank: 1, moment: moment(3054, 56) }],
      lockedMomentOffsetSeconds: 3054,
    })
    expect(m.title).toBe('0:50:54')
    expect(m.clockLabel).toBe('1:22–1:23 PM')
    expect(m.zone).toBe('PDT')
    expect(m.figures.map((f) => [f.label, f.value, f.third])).toEqual([
      ['viewers', 19455, null],
      ['chat/min', 299, null],
      ['emotes/min', 250, null],
    ])
    expect(m.topEmotes.slice(0, 3).map((e) => [e.code, e.perMin])).toEqual([['HUH', 56], ['LOL', 44], ['LO', 29]])
    expect(m.topEmotesExact).toBe(true)
    expect(m.providers).toEqual({ sevenTv: 218, other: 32 })
    expect(m.category).toEqual({ name: 'Grand Theft Auto V', artUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-144x192.jpg' })
    expect(m.moments.map((x) => [x.rank, x.offsetLabel, x.label, x.locked])).toEqual([[1, '0:50:54', 'Emote spike · score 56', true]])
    expect(m.moments[0]!.topEmote).toMatchObject({ code: 'HUH', count: 56 })
    // 0:50:54 on the stream = 0:50:49 on the VOD, minus the 10 s lead-in
    expect(m.vod).toMatchObject({
      vodId: '2899924626',
      playAt: 3039,
      playVerb: 'Play VOD from',
      open: { href: 'https://www.twitch.tv/videos/2899924626?t=50m39s', label: 'Open VOD at 0:50:39' },
      leadCaption: { leadSeconds: 10, alignSeconds: -5 },
      message: null,
      subject: 'moment',
      subjectVodStart: 3049,
      frameVodOffset: 3079,
    })
    expect(JSON.stringify(m)).not.toMatch(/usual/)
  })

  it('a bar without a moment plays from its own start, without lead-in', () => {
    const m = buildSessionBarStrip({ ...base, span: { startSec: 2994, endSec: 3054, levelMinutes: 1 }, rollups: [minute(2994)] })
    expect(m.lockedMoment).toBeNull()
    expect(m.vod).toMatchObject({ playAt: 2989, playVerb: 'Play from', leadCaption: null, subject: 'minute', open: { label: 'Open VOD at 0:49:49' } })
  })

  it('a wider bar: range title, viewer peak, summed emotes are minimums, partial coverage', () => {
    const rows = [
      minute(3000, { viewerAvg: 19000, viewerMax: 19100, emotes: { 'seventv:01HUH:HUH': 10 } }),
      minute(3060, { viewerAvg: 19500, viewerMax: 19800, emotes: { 'seventv:01HUH:HUH': 30, 'seventv:01LOL:LOL': 5 } }),
      minute(3120, { missing: true }),
    ]
    const m = buildSessionBarStrip({ ...base, span: { startSec: 3000, endSec: 3300, levelMinutes: 5 }, rollups: rows })
    expect(m.title).toBe('0:50:00–0:55:00')
    expect(m.figures[0]).toMatchObject({ value: 19250, third: 'peak 19,800', tip: 'Peak 19,800 at 0:51:00' })
    expect(m.topEmotesExact).toBe(false)
    expect(m.topEmotes[0]).toMatchObject({ code: 'HUH', count: 40, perMin: 20 })
    expect(m.coverage).toEqual({ measured: 2, total: 5, partial: true, label: '2 of 5 min measured' })
    expect(m.vod.subject).toBe('bar')
  })

  it('says how much of the emote total the names cover when that is under 25%', () => {
    const m = buildSessionBarStrip({
      ...base, span: { startSec: 3054, endSec: 3114, levelMinutes: 1 },
      rollups: [minute(3054, { totalEmoteCount: 448, emotes: { 'seventv:01HUH:HUH': 4 } })],
    })
    expect(m.namedNote).toBe('Names for <1% of emote uses')
  })

  it('reads a category switch in time order', () => {
    const m = buildSessionBarStrip({
      ...base,
      games: [
        { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 2911 },
        { gameName: 'Minecraft', offsetSeconds: 2911, durationSeconds: 9000 },
      ],
      span: { startSec: 2700, endSec: 3000, levelMinutes: 5 },
      rollups: [minute(2700), minute(2760)],
    })
    expect(m.category?.name).toBe('Just Chatting')
    expect(m.categorySwitch).toBe('Just Chatting → Minecraft at 0:48:31')
  })

  it('names the game from the selected minute when no segments are passed', () => {
    const m = buildSessionBarStrip({
      ...base, games: undefined, gameName: 'Grand Theft Auto V',
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 }, rollups: [minute(3054)],
    })
    expect(m.category?.name).toBe('Grand Theft Auto V')
    expect(m.category?.artUrl).toMatch(/^https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\//)
  })

  it('no timed Play without verified alignment: prod\'s "Open full VOD"', () => {
    const m = buildSessionBarStrip({
      ...base, vodAlignSeconds: null,
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 }, rollups: [minute(3054)],
      moments: [{ rank: 1, moment: moment(3054, 56) }], lockedMomentOffsetSeconds: 3054,
    })
    expect(m.vod).toMatchObject({
      playAt: null, leadCaption: null, message: 'Timestamp alignment is not verified.',
      open: { href: 'https://www.twitch.tv/videos/2899924626', label: 'Open full VOD' },
    })
    expect(momentPlayAt(moment(3054, 56), null, null)).toBeNull()
  })

  it('no VOD: no Play, no link, the reason', () => {
    const live = buildSessionBarStrip({
      ...base, vodLinkState: { status: 'live', label: 'Live — no VOD yet', detail: '' },
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 }, rollups: [minute(3054)],
    })
    expect(live.vod).toMatchObject({ vodId: null, playAt: null, open: null, message: 'No VOD for this stream yet.' })
    const gone = buildSessionBarStrip({
      ...base, vodLinkState: { status: 'unavailable', label: 'VOD unavailable', detail: '' },
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 }, rollups: [minute(3054)],
    })
    expect(gone.vod.message).toBe('VOD unavailable')
  })

  it("a minute past the VOD's end isn't in the VOD", () => {
    const m = buildSessionBarStrip({
      ...base, vodDurationSeconds: 3000,
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 }, rollups: [minute(3054)],
    })
    expect(m.vod).toMatchObject({ playAt: null, message: "This minute isn't in the VOD yet.", open: { label: 'Open full VOD' } })
  })

  it('a bar with no measured minute is a gap', () => {
    const m = buildSessionBarStrip({ ...base, span: { startSec: 60, endSec: 120, levelMinutes: 1 }, rollups: [minute(60, { missing: true })] })
    expect(m.gap).toBe(true)
    expect(m.figures.every((f) => f.value == null)).toBe(true)
  })
})
