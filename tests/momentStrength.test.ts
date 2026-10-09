import { describe, expect, it } from 'vitest'
import type { ExtensionRollup, PulseCoverage, PulseCoverageRange } from '../src/shared/messages.ts'
import { momentStrength } from '../src/ui/momentStrength.ts'

const chatSpike = { offsetSeconds: 0, dominantSignal: 'chat_spike', reasonLabel: 'Chat spike' }
const emoteSpike = { offsetSeconds: 0, dominantSignal: 'seventv_spike', reasonLabel: 'Emote spike' }

function minute(index: number, chatCount: number, extra: Partial<ExtensionRollup> = {}): ExtensionRollup {
  return { offsetSeconds: index * 60, chatCount, sevenTvEmoteCount: 0, ...extra }
}

/** `count` measured minutes of `chat` each, then the moment minute. */
function steady(count: number, chat: number, momentChat: number): ExtensionRollup[] {
  return [...Array.from({ length: count }, (_, i) => minute(i, chat)), minute(count, momentChat)]
}

const at = (index: number, moment = chatSpike) => ({ ...moment, offsetSeconds: index * 60 })

describe('momentStrength (Method A: mean of up to 30 measured minutes before the moment)', () => {
  it('divides the moment minute by the mean of the 30 measured minutes before it', () => {
    const strength = momentStrength(steady(30, 20, 84), at(30))
    expect(strength).toMatchObject({ ratio: 4.2, label: '4.2×', level: 3, value: 84, mean: 20, minutes: 30, emotes: false })
  })

  it('uses only the 30 minutes immediately before, not the whole stream', () => {
    const rollups = [
      ...Array.from({ length: 60 }, (_, i) => minute(i, 500)),
      ...Array.from({ length: 30 }, (_, i) => minute(60 + i, 40)),
      minute(90, 120),
    ]
    expect(momentStrength(rollups, at(90))).toMatchObject({ ratio: 3, label: '3.0×', mean: 40, minutes: 30 })
  })

  it('reads the moment minute from the rollups, not the peak counts', () => {
    const strength = momentStrength(steady(20, 30, 90), { ...at(20), chatCount: 900, emoteCount: 468 } as never)
    expect(strength?.value).toBe(90)
    expect(strength?.ratio).toBe(3)
  })

  it('never counts the moment minute or later minutes in the usual', () => {
    const rollups = [...steady(12, 10, 50), minute(13, 900), minute(14, 900)]
    expect(momentStrength(rollups, at(12))).toMatchObject({ mean: 10, minutes: 12, ratio: 5 })
  })

  it('finds the minute containing a moment that is not on a minute boundary', () => {
    // Minutes start 13 s into the clock minute, like a stream that began at :47.
    const rollups = steady(15, 20, 100).map(rollup => ({ ...rollup, offsetSeconds: rollup.offsetSeconds + 13 }))
    rollups[14] = { ...rollups[14]!, chatCount: 60 }
    expect(momentStrength(rollups, { ...chatSpike, offsetSeconds: 15 * 60 + 13 })?.value).toBe(100)
    expect(momentStrength(rollups, { ...chatSpike, offsetSeconds: 15 * 60 + 13 + 59 })?.value).toBe(100)
    // A refined onset inside the previous minute belongs to that minute.
    expect(momentStrength(rollups, { ...chatSpike, offsetSeconds: 15 * 60 + 12 })?.value).toBe(60)
  })

  describe('gaps', () => {
    it('skips missing minutes instead of counting them as zero chat', () => {
      const rollups = [
        ...Array.from({ length: 12 }, (_, i) => minute(i, 20)),
        minute(12, 0, { missing: true }),
        minute(13, 0, { missing: true }),
        minute(14, 60),
      ]
      expect(momentStrength(rollups, at(14))).toMatchObject({ mean: 20, minutes: 12, ratio: 3 })
    })

    it('skips minutes absent from the history and reaches past the gap for measured ones', () => {
      const rollups = [
        ...Array.from({ length: 20 }, (_, i) => minute(i, 30)),
        // A two-hour tracking hole: no rollups at all.
        ...Array.from({ length: 20 }, (_, i) => minute(140 + i, 10)),
        minute(160, 60),
      ]
      // 20 measured minutes at 10 right before, then 10 more at 30 from before the hole.
      expect(momentStrength(rollups, at(160))).toMatchObject({ minutes: 30, ratio: 3.6 })
      expect(momentStrength(rollups, at(160))?.mean).toBeCloseTo(50 / 3, 6)
    })

    it('counts a measured quiet minute (zero chat) as a measured minute', () => {
      const rollups = [...Array.from({ length: 10 }, (_, i) => minute(i, i < 5 ? 0 : 20)), minute(10, 30)]
      expect(momentStrength(rollups, at(10))).toMatchObject({ mean: 10, minutes: 10, ratio: 3 })
    })

    it('shows nothing when the moment minute itself is missing or not loaded', () => {
      const rollups = steady(20, 20, 100)
      rollups[20] = { ...rollups[20]!, missing: true }
      expect(momentStrength(rollups, at(20))).toBeNull()
      expect(momentStrength(steady(20, 20, 100), at(25))).toBeNull()
    })
  })

  describe('missing chat coverage (viewer-only rows)', () => {
    /** A row the backend sends for a minute it sampled viewers but captured no chat. */
    const viewerOnly = (index: number, offsetSeconds = index * 60): ExtensionRollup =>
      ({ offsetSeconds, chatCount: 0, sevenTvEmoteCount: 0, totalEmoteCount: 0, viewerCount: 4200, viewerSamples: 3 })

    /** Live coverage as the backend builds it: ranges in minute starts, `to` inclusive. */
    function coverage(missingRanges: PulseCoverageRange[] | undefined, extra: Partial<PulseCoverage> = {}): PulseCoverage {
      return {
        state: 'waiting_for_vod',
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: 0,
        hasFullStreamCoverage: false,
        trackedFromStart: false,
        hasGaps: Boolean(missingRanges?.length),
        missingRanges,
        canBackfill: false,
        message: 'VOD chat not available yet',
        ...extra,
      }
    }

    // Chat joined at 00:20 (missing first 20 minutes); viewers sampled from 00:00.
    const lateJoin = [
      ...Array.from({ length: 20 }, (_, i) => viewerOnly(i)),
      ...Array.from({ length: 5 }, (_, i) => minute(20 + i, 60)),
      minute(25, 140),
    ]
    const lateJoinCoverage = coverage([{ fromOffsetSeconds: 0, toOffsetSeconds: 19 * 60 }], {
      coverageStartOffsetSeconds: 20 * 60,
      coverageEndOffsetSeconds: 25 * 60,
    })

    it('does not count a viewer-only prefix before chat began toward the usual or the minimum', () => {
      // Without the coverage the 20 empty rows read as quiet minutes: 140 over 12.
      expect(momentStrength(lateJoin, at(25))).toMatchObject({ label: '10×+', mean: 12, minutes: 25 })
      // Only 5 minutes had chat before the moment, under the 10-minute minimum.
      expect(momentStrength(lateJoin, at(25), lateJoinCoverage)).toBeNull()
    })

    it('averages only the chat minutes once enough follow a late join', () => {
      const rollups = [...lateJoin.slice(0, 25), ...Array.from({ length: 10 }, (_, i) => minute(25 + i, 60)), minute(35, 150)]
      expect(momentStrength(rollups, at(35), lateJoinCoverage)).toMatchObject({ label: '2.5×', mean: 60, minutes: 15 })
    })

    it('treats a legacy late join with only a coverage start as a missing prefix', () => {
      const legacy = coverage(undefined, { state: 'partial_tracking', coverageStartOffsetSeconds: 20 * 60, hasGaps: false })
      expect(momentStrength(lateJoin, at(25), legacy)).toBeNull()
    })

    // Chat 00:00-00:09, a 20-minute IRC outage 00:10-00:29 with viewers still
    // sampled, then the moment at 00:30. The backend's range is 00:10 to 00:29.
    const outage = [
      ...Array.from({ length: 10 }, (_, i) => minute(i, 60)),
      ...Array.from({ length: 20 }, (_, i) => viewerOnly(10 + i)),
      minute(30, 140),
    ]
    const outageCoverage = coverage([{ fromOffsetSeconds: 10 * 60, toOffsetSeconds: 29 * 60 }], {
      state: 'missing_ranges_detected',
      coverageEndOffsetSeconds: 30 * 60,
    })

    it('skips a mid-stream viewer-only hole instead of averaging it in as zero chat', () => {
      expect(momentStrength(outage, at(30))).toMatchObject({ label: '7.0×', mean: 20, minutes: 30 })
      expect(momentStrength(outage, at(30), outageCoverage)).toMatchObject({ label: '2.3×', mean: 60, minutes: 10 })
    })

    it('treats the range end as the last missing minute, not one past it', () => {
      // An exclusive end would let the 00:29 row in: 11 minutes, 54.5 a minute, 2.6×.
      const strength = momentStrength(outage, at(30), outageCoverage)
      expect(strength?.minutes).toBe(10)
      expect(strength?.ratio).toBe(2.3)
    })

    it('matches rollup minutes that start up to 59 s before the clock minute the range uses', () => {
      // Stream began at :39, so rollups sit 39 s before the coverage minutes
      // (00:00, 00:21, 01:21, ...). Chat resumes at 00:30, the moment is 00:35.
      const shift = (rollup: ExtensionRollup): ExtensionRollup => ({ ...rollup, offsetSeconds: Math.max(0, rollup.offsetSeconds - 39) })
      const rollups = [
        ...outage.slice(0, 30),
        ...Array.from({ length: 5 }, (_, i) => minute(30 + i, 60)),
        minute(35, 150),
      ].map(shift)
      const strength = momentStrength(rollups, { ...chatSpike, offsetSeconds: 35 * 60 - 39 }, outageCoverage)
      // The 00:10 row (09:21) is in the hole; the 00:30 chat row (29:21) overlaps
      // the range end but has chat, so it still counts.
      expect(strength).toMatchObject({ label: '2.5×', mean: 60, minutes: 15 })
    })

    it('still counts a quiet minute that the coverage does not report missing', () => {
      const rollups = [...Array.from({ length: 10 }, (_, i) => minute(i, i < 5 ? 0 : 20)), minute(10, 30)]
      const tracked = coverage([], { state: 'full_stream_tracked', hasFullStreamCoverage: true, trackedFromStart: true })
      expect(momentStrength(rollups, at(10), tracked)).toMatchObject({ mean: 10, minutes: 10, ratio: 3 })
      expect(momentStrength(rollups, at(10), outageCoverage)).toMatchObject({ mean: 10, minutes: 10, ratio: 3 })
    })

    it('keeps an emote-only row inside a reported range', () => {
      const rollups = [...outage.slice(0, 30), minute(30, 140)]
      rollups[12] = { ...viewerOnly(12), totalEmoteCount: 3 }
      expect(momentStrength(rollups, at(30), outageCoverage)?.minutes).toBe(11)
    })
  })

  describe('minimum history', () => {
    it('needs at least 10 measured minutes before the moment', () => {
      expect(momentStrength(steady(9, 20, 100), at(9))).toBeNull()
      expect(momentStrength(steady(10, 20, 100), at(10))).toMatchObject({ minutes: 10, ratio: 5 })
    })

    it('does not let missing minutes count toward the minimum', () => {
      const rollups = [
        ...Array.from({ length: 9 }, (_, i) => minute(i, 20)),
        ...Array.from({ length: 6 }, (_, i) => minute(9 + i, 0, { missing: true })),
        minute(15, 100),
      ]
      expect(momentStrength(rollups, at(15))).toBeNull()
    })
  })

  describe('floor', () => {
    it('floors the usual at 5 a minute', () => {
      expect(momentStrength(steady(30, 1, 20), at(30))).toMatchObject({ ratio: 4, label: '4.0×', mean: 1 })
      expect(momentStrength(steady(30, 0, 12), at(30))).toMatchObject({ ratio: 2.4, mean: 0 })
    })

    it('leaves a usual above 5 alone', () => {
      expect(momentStrength(steady(30, 6, 12), at(30))?.ratio).toBe(2)
    })
  })

  describe('emote vs chat spikes', () => {
    const rollups = [
      ...Array.from({ length: 30 }, (_, i) => minute(i, 100, { totalEmoteCount: 30, sevenTvEmoteCount: 12 })),
      minute(30, 120, { totalEmoteCount: 369, sevenTvEmoteCount: 200 }),
    ]

    it('measures an emote spike by emotes on both sides', () => {
      expect(momentStrength(rollups, at(30, emoteSpike))).toMatchObject({ emotes: true, value: 369, mean: 30, ratio: 12.3, label: '10×+', level: 5 })
    })

    it('measures a chat spike by chat on the same minutes', () => {
      expect(momentStrength(rollups, at(30))).toMatchObject({ emotes: false, value: 120, mean: 100, label: '1.2×' })
    })

    it('treats every emote spike code and label as emotes', () => {
      for (const dominantSignal of ['emote_spike', 'seventv_spike', 'twitch_emote_spike', 'ffz_spike']) {
        expect(momentStrength(rollups, at(30, { ...emoteSpike, dominantSignal }))?.emotes).toBe(true)
      }
      expect(momentStrength(rollups, at(30, { offsetSeconds: 0, dominantSignal: 'manual', reasonLabel: 'Emote spike' }))?.emotes).toBe(true)
    })

    it('falls back to 7TV emotes when a minute has no total', () => {
      const sevenTvOnly = [
        ...Array.from({ length: 10 }, (_, i) => minute(i, 0, { sevenTvEmoteCount: 10 })),
        minute(10, 0, { sevenTvEmoteCount: 45 }),
      ]
      expect(momentStrength(sevenTvOnly, at(10, emoteSpike))).toMatchObject({ value: 45, mean: 10, ratio: 4.5 })
    })
  })

  describe('display', () => {
    const ratio = (momentChat: number) => momentStrength(steady(30, 100, momentChat), at(30))

    it('shows one decimal under 10 and caps at 10×+', () => {
      expect(ratio(990)?.label).toBe('9.9×')
      expect(ratio(996)?.label).toBe('10×+')
      expect(ratio(1000)?.label).toBe('10×+')
      expect(ratio(1400)).toMatchObject({ ratio: 14, label: '10×+', level: 5 })
    })

    it('tints from 2×, 3×, 5× and 8×, neutral below 2×', () => {
      expect(ratio(194)?.level).toBe(1)
      expect(ratio(196)).toMatchObject({ label: '2.0×', level: 2 })
      expect(ratio(299)?.level).toBe(3)
      expect(ratio(499)?.level).toBe(4)
      expect(ratio(799)?.level).toBe(5)
      expect(ratio(794)?.level).toBe(4)
    })

    it('hides a moment that is not meaningfully above usual', () => {
      expect(ratio(114)).toBeNull()
      expect(ratio(80)).toBeNull()
      expect(ratio(116)).toMatchObject({ label: '1.2×', level: 1 })
    })
  })

  it('handles a long 33h history with gaps, out of order', () => {
    const rollups: ExtensionRollup[] = []
    for (let i = 0; i < 33 * 60; i += 1) {
      // A missing minute every 7th, an absent 20-minute hole every 5 hours.
      if (i % 300 >= 280) continue
      rollups.push(minute(i, 40 + (i % 3), i % 7 === 0 ? { missing: true } : {}))
    }
    const momentIndex = 33 * 60 - 45
    const momentRollup = rollups.find(rollup => rollup.offsetSeconds === momentIndex * 60)!
    momentRollup.chatCount = 900
    rollups.reverse()

    const started = performance.now()
    const strength = momentStrength(rollups, at(momentIndex))
    expect(performance.now() - started).toBeLessThan(100)

    const expected = rollups
      .filter(rollup => !rollup.missing && rollup.offsetSeconds < momentIndex * 60)
      .sort((a, b) => b.offsetSeconds - a.offsetSeconds)
      .slice(0, 30)
    const mean = expected.reduce((sum, rollup) => sum + rollup.chatCount, 0) / 30
    expect(strength).toMatchObject({ minutes: 30, value: 900, label: '10×+', level: 5 })
    expect(strength?.mean).toBeCloseTo(mean, 6)
    expect(strength?.ratio).toBe(Math.round((900 / mean) * 10) / 10)
  })
})
