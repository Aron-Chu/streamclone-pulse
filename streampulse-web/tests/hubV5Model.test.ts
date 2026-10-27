import { describe, expect, it } from 'vitest'
import type { HubLiveChannel, HubLivePulseMoment } from '../src/lib/publicHub'
import type { HubChannelScreenerV1, HubScreenerMetric } from '../src/lib/channelScreenerContract'
import {
  busiestCue,
  busiestTip,
  channelRows,
  channelVs,
  formatHubMultiplier,
  formatHubRate,
  hubAvatarTone,
  hubMonogram,
  isLowMultiplier,
  measuredFacts,
  momentHref,
  momentReasonLabel,
  momentRowsV5,
  multiplierWords,
  rankBusiest,
  searchChannels,
  topEmoteRows,
  typedLogin,
  whereChatIs,
} from '../src/ui/components/hub/v5/hubV5Model'

const W0 = Date.UTC(2026, 9, 19, 17, 45)
const W1 = W0 + 5 * 60_000

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

function screener(chat: Partial<HubScreenerMetric> | null, window: { start?: number; end?: number; measured?: number } = {}): HubChannelScreenerV1 {
  return {
    version: 1,
    measuredAt: W1,
    baselineKind: 'current_stream_measured_average',
    state: 'ready',
    currentWindow: { start: window.start ?? W0, end: window.end ?? W1, expectedMinutes: 5, measuredMinutes: window.measured ?? 5, coveragePct: 100 },
    baselineWindow: null,
    baselineMeasuredMinutes: 40,
    evidence: null,
    chat: chat ? metric(chat) : null,
    emotes: null,
  }
}

function channel(login: string, over: Partial<HubLiveChannel> = {}, chat: Partial<HubScreenerMetric> | null = {}, window = {}): HubLiveChannel {
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
    screenerV1: screener(chat, window),
    ...over,
  } as HubLiveChannel
}

describe('hub v5 formatting', () => {
  it('formats rates, multipliers and words like the mockup', () => {
    expect(formatHubRate(4.26)).toBe('4.3')
    expect(formatHubRate(1234.4)).toBe('1,234')
    expect(formatHubRate(null)).toBe('—')
    expect(formatHubMultiplier(1.66)).toBe('1.7×')
    expect(formatHubMultiplier(12)).toBe('10×+')
    expect(isLowMultiplier(0.94)).toBe(true)
    expect(isLowMultiplier(0.96)).toBe(false)
    expect(multiplierWords(14)).toBe('at least 10')
  })

  it('gives every login a stable tone and a two-letter monogram', () => {
    expect(hubAvatarTone('xqc')).toBe(hubAvatarTone('xqc'))
    expect(hubMonogram('Kai Cenat', 'kaicenat')).toBe('KA')
    expect(hubMonogram(undefined, '__')).toBe('?')
  })
})

describe('Busiest now', () => {
  it('ranks the shared 5-minute window by chat, then viewers, then login, and leaves out other windows', () => {
    const live = [
      channel('b', { viewers: 10 }, { currentPerMin: 300 }),
      channel('a', { viewers: 10 }, { currentPerMin: 300 }),
      channel('c', { viewers: 99 }, { currentPerMin: 300 }),
      channel('d', {}, { currentPerMin: 900 }, { start: W0 - 60_000, end: W1 - 60_000 }),
      channel('e', {}, { currentPerMin: 100 }, { measured: 4 }),
      channel('f', { coverageState: 'viewers_only' as HubLiveChannel['coverageState'] }, null),
    ]
    const set = rankBusiest(live)
    expect(set.rows.map((r) => r.login)).toEqual(['c', 'a', 'b'])
    expect(set.eligible).toBe(4)
    expect(set.synced).toBe(5)
    expect(set.noWindow).toBe(1)
    expect(set.otherWindow).toBe(1)
    expect(set.rows[0]!.href).toBe('/analytics/c/s-c')
    expect(busiestCue(set, W1 + 60_000)).toBe('live')
    expect(busiestCue(set, W1 + 10 * 60_000)).toBe('stale')
    expect(busiestTip(set, 'stale')).toMatch(/^Not updated since /)
    expect(busiestTip(set, 'live')).toContain('1 channel reported a different window and is left out.')
  })

  it('is empty with no full window', () => {
    const set = rankBusiest([channel('a', {}, {}, { measured: 3 })])
    expect(set.rows).toEqual([])
    expect(Number.isNaN(set.windowEnd)).toBe(true)
    expect(busiestCue(set, W1)).toBe('stale')
  })
})

describe('Where chat is', () => {
  it('sums chat per game from chat-counted rows only', () => {
    const live = [
      channel('a', { category: 'Fortnite' }, { currentPerMin: 300 }),
      channel('b', { category: 'Fortnite' }, { currentPerMin: 100 }),
      channel('c', { category: '' }, { currentPerMin: 100 }),
      channel('d', { category: 'Chess' }, { currentPerMin: 999 }, { measured: 2 }),
    ]
    const games = whereChatIs(live)
    expect(games.top.map((g) => g.name)).toEqual(['Fortnite', 'No category'])
    expect(games.top[0]!.chatShare).toBeCloseTo(80)
    expect(games.top[0]!.rows.map((c) => c.login)).toEqual(['a', 'b'])
    expect(games.counted).toBe(3)
    expect(games.noWindow).toBe(1)
  })
})

describe('Channels', () => {
  const live = [
    channel('big', { viewers: 9000 }, { currentPerMin: 50, multiplier: 1.2 }),
    channel('hot', { viewers: 100, category: 'Chess' }, { currentPerMin: 400, multiplier: 3.1 }),
    channel('young', { viewers: 500 }, { currentPerMin: 80, multiplier: 4, baselineMeasuredMinutes: 6 }),
    channel('quiet', { viewers: 300 }, { currentPerMin: 3, multiplier: 0.5 }),
    channel('viewersonly', { viewers: 700, coverageState: 'viewers_only' as HubLiveChannel['coverageState'] }, null),
  ]

  it('gates vs own avg on ready, the 5/min floor and 10 measured minutes', () => {
    expect(channelVs(live[0]!)).toEqual({ x: 1.2 })
    expect(channelVs(live[2]!)).toEqual({ why: 'no comparison' })
    expect(channelVs(live[3]!)).toEqual({ why: 'no comparison' })
    expect(channelVs(live[4]!)).toEqual({ why: 'viewers only' })
    expect(channelVs(channel('w', {}, { state: 'warming', reason: 'baseline_warming', multiplier: null }))).toEqual({ why: 'avg warming up' })
  })

  it('sorts with nulls last and filters by text and game', () => {
    const q = { q: '', game: null, sort: 'viewers' as const, dir: -1 as const }
    expect(channelRows(live, q).map((c) => c.login)).toEqual(['big', 'viewersonly', 'young', 'quiet', 'hot'])
    expect(channelRows(live, { ...q, sort: 'vs' }).map((c) => c.login)).toEqual(['hot', 'big', 'viewersonly', 'young', 'quiet'])
    expect(channelRows(live, { ...q, sort: 'vs', dir: 1 }).map((c) => c.login).slice(0, 2)).toEqual(['big', 'hot'])
    expect(channelRows(live, { ...q, q: 'chess' }).map((c) => c.login)).toEqual(['hot'])
    expect(channelRows(live, { ...q, game: 'Just Chatting' }).map((c) => c.login)).toEqual(['big', 'young', 'quiet'])
  })
})

describe('Moments', () => {
  const comparison = (chat: object, emotes: object = { state: 'unavailable' }) =>
    ({ baselineWindow: { start: 0, end: 0, expectedMinutes: 20, measuredMinutes: 20, coveragePct: 100 }, chat, emotes }) as HubLivePulseMoment['comparison']

  it('labels reasons in prod wording', () => {
    expect(momentReasonLabel('chat', 'Chat spike')).toBe('Chat spike')
    expect(momentReasonLabel('seventv', '')).toBe('Emote spike')
    expect(momentReasonLabel('emote_spike', '')).toBe('Emote spike')
    expect(momentReasonLabel('', 'Big minute')).toBe('Big minute')
  })

  it('orders newest first, gates the comparison and names the top emote only above 25%', () => {
    const rows = momentRowsV5([
      { login: 'old', at: 1, offsetSeconds: 600, score: 1, label: 'Chat spike', kind: 'chat', chatPerMin: 200, comparison: comparison({ state: 'ready', currentPerMin: 200, baselinePerMin: 50, multiplier: 4, baselineMeasuredMinutes: 20 }) },
      { login: 'new', at: 2, offsetSeconds: 125.7, score: 1, label: 'Emote spike', kind: 'seventv', emotesPerMin: 100, topEmoteCode: 'KEKW', topEmotes: [{ name: 'KEKW', count: 30, sharePct: 30 }], comparison: comparison({ state: 'unavailable' }, { state: 'warming', reason: 'baseline_warming' }) },
      { login: 'odd', at: 0, offsetSeconds: 60, score: 1, label: 'Chat spike', kind: 'chat', chatPerMin: 150, comparison: comparison({ state: 'ready', currentPerMin: 151, multiplier: 2, baselineMeasuredMinutes: 20 }) },
      { at: 3, offsetSeconds: 1, score: 1, label: 'x' },
    ] as HubLivePulseMoment[])
    expect(rows.map((r) => r.login)).toEqual(['new', 'old', 'odd'])
    expect(rows[0]!.cmp).toEqual({ why: 'new stream', long: 'Too early to compare: the stream had been live about 2 min, too soon for its own average.' })
    expect(rows[0]!.topEmoteName).toBe('KEKW')
    expect(rows[0]!.href).toBe('/analytics/moments?login=new&stream=&offset=125')
    expect(rows[1]!.cmp).toEqual({ x: 4, avg: 50, mins: 20 })
    expect('why' in rows[2]!.cmp && rows[2]!.cmp.why).toBe('not compared')
  })

  it('builds the Moments deep link', () => {
    expect(momentHref({ login: 'a', streamId: '9', offsetSeconds: 61.9 })).toBe('/analytics/moments?login=a&stream=9&offset=61')
  })
})

describe('Top emotes and search', () => {
  it('scales bars against the top emote', () => {
    const rows = topEmoteRows([{ name: 'A', count: 10, sharePct: 20 }, { name: 'B', count: 1, sharePct: 0.1 }])
    expect(rows.map((r) => [r.share, r.width])).toEqual([['20.0%', 100], ['0.1%', 2]])
  })

  it('reads a login from what was typed and offers the open row', () => {
    expect(typedLogin('  https://www.twitch.tv/XQC/videos ')).toBe('xqc')
    expect(typedLogin('@Shroud')).toBe('shroud')
    const live = [channel('xqc', { viewers: 5 }), channel('xqcow', { viewers: 9 })]
    const hit = searchChannels(live.slice().sort((a, b) => b.viewers - a.viewers), 'xqc')
    expect(hit.channels.map((c) => c.login)).toEqual(['xqcow', 'xqc'])
    expect(hit.openLogin).toBeNull()
    expect(searchChannels(live, 'someone_else').openLogin).toBe('someone_else')
    expect(searchChannels(live, 'a b').empty).toBe(true)
    expect(searchChannels(live, '').heading).toBe('Busiest live channels')
  })
})

describe('How this is measured', () => {
  it('counts lower-bound intervals and the viewer roster', () => {
    const facts = measuredFacts({
      poolSize: 2000,
      activity: { points: [{ t: 1, providerCountsLowerBound: true, viewerExpectedContributors: 50 }, { t: 2 }] },
    } as never)
    expect(facts).toEqual({ poolSize: 2000, lowerBoundBuckets: 1, buckets: 2, roster: 50 })
  })
})
