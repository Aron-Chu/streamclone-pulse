import { describe, expect, it } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import type { HubChannelScreenerV1, HubScreenerMetric } from '../src/lib/channelScreenerContract'
import {
  FEED_STALE_MS,
  feedAgo,
  feedClockFloor,
  feedFreshText,
  feedStale,
  feedUp,
  feedUpAria,
  screenerHot,
} from '../src/ui/components/hub/v5/hubV5FeedModel'

const W0 = Date.UTC(2026, 9, 19, 17, 45)
const W1 = W0 + 5 * 60_000
const MIN = 60_000

function metric(over: Partial<HubScreenerMetric> = {}): HubScreenerMetric {
  return {
    state: 'ready',
    currentPerMin: 120,
    baselinePerMin: 60,
    absoluteDeltaPerMin: 60,
    changePct: 100,
    multiplier: 2,
    currentMeasuredMinutes: 5,
    currentExpectedMinutes: 5,
    baselineMeasuredMinutes: 40,
    baselineExpectedMinutes: 40,
    baselineCoveragePct: 100,
    ...over,
  }
}

function screener(chat: Partial<HubScreenerMetric> | null): HubChannelScreenerV1 {
  return {
    version: 1,
    measuredAt: W1,
    baselineKind: 'current_stream_measured_average',
    state: 'ready',
    currentWindow: { start: W0, end: W1, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
    baselineWindow: null,
    baselineMeasuredMinutes: 40,
    evidence: null,
    chat: chat ? metric(chat) : null,
    emotes: null,
  }
}

function channel(login: string, over: Partial<HubLiveChannel> = {}, chat: Partial<HubScreenerMetric> | null = {}): HubLiveChannel {
  return {
    login,
    displayName: login.toUpperCase(),
    category: 'Just Chatting',
    streamId: `s-${login}`,
    viewers: 1000,
    chatPerMin: 0,
    seventvPerMin: 0,
    coverageState: 'synced',
    trendPct: 0,
    screenerV1: screener(chat),
    ...over,
  } as HubLiveChannel
}

describe('screenerHot', () => {
  it('needs 1.5×+, 30+ a minute and 20+ more than usual over a full window', () => {
    expect(screenerHot(channel('alpha'))).toBe(true)
    expect(screenerHot(channel('beta', {}, { multiplier: 1.4 }))).toBe(false)
    expect(screenerHot(channel('gamma', {}, { currentPerMin: 25 }))).toBe(false)
    expect(screenerHot(channel('delta', {}, { absoluteDeltaPerMin: 10 }))).toBe(false)
    expect(screenerHot(channel('eps', {}, { baselineMeasuredMinutes: 4 }))).toBe(false)
    expect(screenerHot(channel('zeta', { coverageState: 'pending' } as Partial<HubLiveChannel>))).toBe(false)
    expect(screenerHot(channel('eta', {}, null))).toBe(false)
    expect(screenerHot(null)).toBe(false)
  })
})

describe('Picking up', () => {
  const up = feedUp({
    liveChannels: [
      channel('alpha'),
      channel('bravo', { category: 'Chess' }, { multiplier: 1.6, absoluteDeltaPerMin: 30 }),
      channel('charlie', {}, { multiplier: 3, absoluteDeltaPerMin: 90 }),
      channel('delta', {}, { multiplier: 1.3 }),
    ],
  })

  it('ranks the hot channels by messages a minute over usual', () => {
    expect(up.up.map((r) => r.login)).toEqual(['charlie', 'alpha', 'bravo'])
    expect(up.up[0]).toMatchObject({ name: 'CHARLIE', x: 3, add: 90, cat: 'Just Chatting', streamId: 's-charlie' })
    expect(up.upWindow).not.toBe('')
    expect(feedUp(null)).toEqual({ up: [], upWindow: '' })
  })

  it('says the bar and the channel that added most', () => {
    expect(feedUpAria(up)).toMatch(/^Picking up: 3 channels whose chat over .+ ran at least 1\.5 times usual, at least 30 a minute and 20 more than usual\. Most added: CHARLIE, 90 more a minute\. Show them\.$/)
  })
})

describe('feed formatting', () => {
  it('says how long ago', () => {
    expect(feedAgo(W1 - 30_000, W1)).toBe('just now')
    expect(feedAgo(W1 - 12 * MIN, W1)).toBe('12 min ago')
  })

  it('says how old the data is on its own clock, floored to the minute', () => {
    const at = feedClockFloor(W1)
    expect(feedFreshText(null, W1)).toBe('')
    expect(feedFreshText(W1, W1 + 30_000)).toBe(`as of ${at}`)
    expect(feedFreshText(W1 + 59_000, W1 + 4 * MIN)).toBe(`as of ${at} · 3 min old`)
    expect(feedFreshText(W1, W1 + 59 * MIN + 59_000)).toBe(`as of ${at} · 59 min old`)
    expect(feedFreshText(W1, W1 + 60 * MIN)).toBe(`as of ${at} · 1 h old`)
    expect(feedFreshText(W1, W1 + 1042 * MIN)).toBe(`as of ${at} · 17 h old`)
  })

  it('greys the dot once the data is over 3 minutes old', () => {
    expect(feedStale(W1, W1 + FEED_STALE_MS)).toBe(false)
    expect(feedStale(W1, W1 + FEED_STALE_MS + 1)).toBe(true)
    expect(feedStale(null, W1 + 60 * MIN)).toBe(false)
  })
})
