import { describe, expect, it } from 'vitest'
import { minuteSeriesFromMinutes, seriesAfterOffset } from '../src/lib/momentMinuteSeries'
import { SERIES_BEFORE } from '../src/lib/momentsChecked'
import { vodEmbedSrc, vodSeconds } from '../src/lib/momentsFeedVod'

const startedAt = '2026-10-16T10:00:00Z'
const moment = { login: 'xqc', streamId: 's1', offsetSeconds: 3600, minuteStart: Date.parse('2026-10-16T11:00:00Z') }
const row = (min: number, extra: Record<string, unknown> = {}) => ({ offsetSeconds: min * 60, chatCount: 100 + min, totalEmoteCount: 10, viewerAvg: 5000, ...extra })

describe('opened moment minute series', () => {
  it('reads from one minute before the window', () => {
    expect(seriesAfterOffset(3600)).toBe(3600 - 33 * 60)
    expect(seriesAfterOffset(120)).toBe(0)
  })

  it('places each minute against the moment', () => {
    const s = minuteSeriesFromMinutes(moment, { streamId: 's1', channel: 'xQc', startedAt, minutes: [row(28), row(59), row(60), row(76), row(77)] })!
    expect(s.fromSpark).toBe(false)
    expect(s.c[SERIES_BEFORE]).toBe(160)
    expect(s.c[SERIES_BEFORE - 1]).toBe(159)
    expect(s.c[0]).toBe(128)
    expect(s.c[SERIES_BEFORE + 16]).toBe(176)
    expect(s.c.filter(v => v != null)).toHaveLength(4) // minute 77 is past the window
  })

  it('keeps a missing minute empty, not zero', () => {
    const s = minuteSeriesFromMinutes(moment, { streamId: 's1', startedAt, minutes: [row(60), row(59, { missing: true }), { offsetSeconds: 58 * 60, viewerAvg: 10 }] })!
    expect(s.c[SERIES_BEFORE - 1]).toBeNull()
    expect(s.c[SERIES_BEFORE - 2]).toBeNull()
    expect(s.e[SERIES_BEFORE - 2]).toBeNull()
    expect(s.v[SERIES_BEFORE - 2]).toBe(10)
  })

  it('sorts a minute’s emotes by count (the API sends them in no order)', () => {
    const s = minuteSeriesFromMinutes(moment, { streamId: 's1', startedAt, minutes: [row(60, { topEmotes: [{ name: 'a', count: 1 }, { name: 'b', count: 9 }, { name: 'c', count: 4 }, { name: 'd', count: 7 }] })] })!
    expect(s.t3[SERIES_BEFORE]?.map(e => e.name)).toEqual(['b', 'd', 'c'])
  })

  it('refuses another broadcast and an empty window', () => {
    expect(minuteSeriesFromMinutes(moment, { streamId: 's2', startedAt, minutes: [row(60)] })).toBeNull()
    expect(minuteSeriesFromMinutes(moment, { streamId: 's1', channel: 'other', startedAt, minutes: [row(60)] })).toBeNull()
    expect(minuteSeriesFromMinutes(moment, { streamId: 's1', startedAt, minutes: [row(5)] })).toBeNull()
  })
})

describe('opened moment VOD', () => {
  it('starts Play ten seconds before the minute, in the VOD', () => {
    expect(vodSeconds({ vodId: '9', alignSeconds: 42 }, 3600, 10)).toBe(3632)
    expect(vodSeconds({ vodId: '9', alignSeconds: -30 }, 5, 10)).toBe(0)
    const src = new URL(vodEmbedSrc('9', 3632, 'streampulse.stream'))
    expect(src.origin).toBe('https://player.twitch.tv')
    expect(Object.fromEntries(src.searchParams)).toEqual({ video: 'v9', time: '1h0m32s', parent: 'streampulse.stream', autoplay: 'true' })
  })
})
