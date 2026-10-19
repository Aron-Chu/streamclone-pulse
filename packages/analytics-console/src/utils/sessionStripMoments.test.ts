import { describe, expect, it, vi } from 'vitest'
import { recapMomentAnalyticalOffset } from '@streampulse/pulse-core'
import {
  getStripPinHover,
  SESSION_PIN_COUNT,
  sessionStripMoments,
  setStripPinHover,
  stripHasReactionCoverage,
  stripMomentEmotes,
  subscribeStripPinHover,
} from './sessionStripMoments.ts'
import {
  STRIP_HEATMAP,
  STRIP_RECAP,
  STRIP_ROLLUPS,
  STRIP_STARTED_AT,
  STRIP_TOP_EMOTES,
} from '../components/analytics/__fixtures__/sessionStripFixture.ts'

const list = () =>
  sessionStripMoments({
    recap: STRIP_RECAP,
    hasReactionCoverage: stripHasReactionCoverage(STRIP_RECAP),
    heatmapPoints: STRIP_HEATMAP,
    streamStartedAt: STRIP_STARTED_AT,
    topEmotesCatalog: STRIP_TOP_EMOTES,
  })

describe('sessionStripMoments', () => {
  it('reports reaction coverage from moment counts or total messages', () => {
    expect(stripHasReactionCoverage(STRIP_RECAP)).toBe(true)
    expect(stripHasReactionCoverage({ streamId: 's', topMoments: [{ offsetSeconds: 60, score: 10, chatCount: 0, emoteCount: 0 }] })).toBe(false)
    expect(stripHasReactionCoverage({ streamId: 's', totalMessages: 3 })).toBe(true)
  })

  it('ranks the strip list by score with the top moment first', () => {
    const moments = list()
    expect(moments.length).toBeGreaterThan(SESSION_PIN_COUNT)
    expect(recapMomentAnalyticalOffset(moments[0]!)).toBe(4_518)
    const scores = moments.map((moment) => moment.score)
    expect(scores.slice(0, 5)).toEqual([...scores.slice(0, 5)].sort((a, b) => b - a))
  })

  it('is a pure function of its inputs (pins and strip share one list)', () => {
    expect(list().map(recapMomentAnalyticalOffset)).toEqual(list().map(recapMomentAnalyticalOffset))
  })

  it('takes a moment\'s emotes from its measured minute, else from the recap snapshot', () => {
    const aligned = { offsetSeconds: 4_500, score: 90, reasons: ['emote_spike'], chatCount: 10, emoteCount: 10, topEmotes: [{ code: 'KEKW', count: 9 }] }
    const exact = stripMomentEmotes({ moment: aligned, rollups: STRIP_ROLLUPS, streamStartedAt: STRIP_STARTED_AT, topEmotesCatalog: STRIP_TOP_EMOTES })
    expect(exact.exact).toBe(true)
    expect(exact.emotes[0]?.name).toBe('OMEGALUL')
    const snapshot = stripMomentEmotes({ moment: aligned, rollups: [], streamStartedAt: STRIP_STARTED_AT, topEmotesCatalog: STRIP_TOP_EMOTES })
    expect(snapshot.exact).toBe(false)
    expect(snapshot.emotes[0]?.name).toBe('KEKW')
  })

  it('notifies pin hover listeners once per change', () => {
    const listener = vi.fn()
    const off = subscribeStripPinHover(listener)
    setStripPinHover(4_518)
    setStripPinHover(4_518)
    expect(getStripPinHover()).toBe(4_518)
    setStripPinHover(null)
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })
})
