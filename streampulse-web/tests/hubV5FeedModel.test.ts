import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { normalizePublicHub, type HubLiveChannel, type HubLivePulseMoment, type HubMoment } from '../src/lib/publicHub'
import type { HubChannelScreenerV1, HubScreenerMetric } from '../src/lib/channelScreenerContract'
import {
  FEED_BLIND,
  FEED_LOADING,
  FEED_STALE_MS,
  FEED_UNAVAILABLE,
  feedAgo,
  feedBlind,
  feedCap,
  feedClockFloor,
  feedColumnCap,
  feedForGame,
  feedFresh,
  feedGameId,
  feedGames,
  feedIsQuiet,
  feedMomentSer,
  feedMomentsHref,
  feedMultiplier,
  feedPeekQuietText,
  feedQuietText,
  feedRestTip,
  feedRowAria,
  feedShort,
  feedStale,
  feedWaitText,
  liveFeedModel,
  liveStartOf,
  screenerHot,
  type FeedEvent,
  type FeedMoment,
  type LiveFeedInput,
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

const spike = (login: string, at: number): HubMoment => ({ kind: 'chat_spike', login, displayName: login.toUpperCase(), label: 'Chat spike', at })

function hub(liveChannels: HubLiveChannel[], moments: HubMoment[] = [], asOf = W1): LiveFeedInput {
  return { generatedAt: new Date(asOf).toISOString(), liveChannels, moments, livePulseMoments: [] } as unknown as LiveFeedInput
}

describe('screenerHot', () => {
  it('needs 1.5×+, 30+ a minute and 20+ more than usual over a full window', () => {
    expect(screenerHot(channel('alpha'), 'chat')).toBe(true)
    expect(screenerHot(channel('beta', {}, { multiplier: 1.4 }), 'chat')).toBe(false)
    expect(screenerHot(channel('gamma', {}, { currentPerMin: 25 }), 'chat')).toBe(false)
    expect(screenerHot(channel('delta', {}, { absoluteDeltaPerMin: 10 }), 'chat')).toBe(false)
    expect(screenerHot(channel('eps', {}, { baselineMeasuredMinutes: 4 }), 'chat')).toBe(false)
    expect(screenerHot(channel('zeta', { coverageState: 'pending' } as Partial<HubLiveChannel>), 'chat')).toBe(false)
    expect(screenerHot(channel('eta', {}, null), 'chat')).toBe(false)
    expect(screenerHot(null, 'chat')).toBe(false)
  })
})

describe('liveStartOf', () => {
  it('prefers the start time Twitch sent, else the start of its own average', () => {
    expect(liveStartOf(channel('alpha', { startedAt: new Date(W0).toISOString() }))).toBe(W0)
    const c = channel('beta')
    c.screenerV1 = { ...c.screenerV1!, baselineWindow: { start: W0 - 30 * MIN, end: W0 } as HubChannelScreenerV1['baselineWindow'] }
    expect(liveStartOf(c)).toBe(W0 - 30 * MIN)
    expect(liveStartOf(channel('gamma'))).toBeNull()
  })
})

describe('liveFeedModel', () => {
  const live = [
    channel('alpha'), // hot, with a spike row
    channel('bravo', {}, { multiplier: 1.6, absoluteDeltaPerMin: 30 }), // hot, Picking up only
    channel('charlie', {}, { multiplier: 3, absoluteDeltaPerMin: 90 }), // hot, Picking up first
    channel('delta', {}, { multiplier: 1.3 }), // under 1.5×
    channel('echo', { startedAt: new Date(W1 - 10 * MIN).toISOString(), viewers: 8000 }, { multiplier: 1 }),
    channel('foxtrot', { startedAt: new Date(W1 - 20 * MIN).toISOString(), viewers: 200 }, { baselineMeasuredMinutes: 4 }),
    channel('golf', { startedAt: new Date(W1 - 40 * MIN).toISOString(), viewers: 300 }, { multiplier: 1 }),
    channel('hotel', { startedAt: new Date(W1 - 2 * 60 * MIN).toISOString(), viewers: 9000 }, { multiplier: 1 }),
  ]
  const moments = [spike('alpha', W1 - 3 * MIN), spike('delta', W1 - 4 * MIN), spike('foxtrot', W1 - 6 * MIN), spike('alpha', W1 - 2 * 60 * MIN)]
  const model = liveFeedModel(hub(live, moments))

  it('is empty before the first reply', () => {
    const empty = liveFeedModel(null)
    expect(empty.asOf).toBeNull()
    expect(empty.items).toEqual([])
    expect(feedIsQuiet(empty)).toBe(false)
  })

  it('keeps a spike only when the screener agrees, once per channel and only in the hour', () => {
    const spikes = model.events.filter((e) => e.kind === 'spike')
    expect(spikes.map((e) => e.login)).toEqual(['alpha'])
    expect(spikes[0]).toMatchObject({ ser: 'chat', x: 2, add: 60 })
    expect(model.left.spikeUnder).toEqual(['DELTA 1.3×'])
    // too new for its own average: its went-live row says chat jumped
    expect(model.left.spikeNew).toEqual(['FOXTROT'])
    const fox = model.events.find((e) => e.kind === 'live' && e.login === 'foxtrot')
    expect(fox && fox.kind === 'live' && fox.jump).toBe(true)
  })

  it('lists streams that started in the hour; 5,000+ viewers get their own row', () => {
    expect(model.liveCount).toBe(3)
    const lives = model.events.filter((e) => e.kind === 'live')
    expect(lives.map((e) => e.login)).toEqual(['echo', 'foxtrot', 'golf'])
    expect(lives.map((e) => e.kind === 'live' && e.small)).toEqual([false, true, true])
  })

  it('groups one row per channel, the small starts sharing one, newest first', () => {
    expect(model.items.map((it) => it.key)).toEqual(['g:alpha', 'g:echo', 'lives'])
    const shared = model.items[2]!
    expect('lives' in shared && shared.lives.map((e) => e.login)).toEqual(['foxtrot', 'golf'])
    expect(model.items.map((it) => it.old)).toEqual([false, false, false])
    expect(feedIsQuiet(model)).toBe(false)
  })

  it('ranks Picking up by messages a minute over usual, leaving out channels with a spike row', () => {
    expect(model.up.map((r) => r.login)).toEqual(['charlie', 'bravo'])
    expect(model.up[0]).toMatchObject({ x: 3, add: 90 })
    expect(model.upWindow).not.toBe('')
  })

  it('goes quiet when nothing happened in the last 15 minutes', () => {
    const quiet = liveFeedModel(hub([channel('golf', { startedAt: new Date(W1 - 40 * MIN).toISOString(), viewers: 300 }, { multiplier: 1 })]))
    expect(quiet.items).toHaveLength(1)
    expect(feedIsQuiet(quiet)).toBe(true)
    expect(quiet.items[0]!.old).toBe(true)
  })

  it('marks only the rows a newer poll brings as fresh', () => {
    const before = liveFeedModel(hub(live.slice(0, 4)))
    const fresh = feedFresh(before, model)
    expect([...fresh].sort()).toEqual(['k:alpha', 'l:echo', 'l:foxtrot', 'l:golf'])
    expect(feedFresh(liveFeedModel(null), model).size).toBe(0)
  })
})

describe('one game at a time (F2)', () => {
  const live = [
    channel('alpha', { category: 'Elden Ring' }), // spike row
    channel('bravo', { category: 'Chess' }, { multiplier: 1.6, absoluteDeltaPerMin: 30 }), // Picking up
    channel('charlie', { category: 'Elden Ring' }, { multiplier: 3, absoluteDeltaPerMin: 90 }), // Picking up
    channel('echo', { category: 'Chess', startedAt: new Date(W1 - 10 * MIN).toISOString(), viewers: 8000 }, { multiplier: 1 }),
    channel('foxtrot', { category: 'Chess', startedAt: new Date(W1 - 20 * MIN).toISOString(), viewers: 200 }, { multiplier: 1 }),
    channel('golf', { category: 'Elden Ring', startedAt: new Date(W1 - 40 * MIN).toISOString(), viewers: 300 }, { multiplier: 1 }),
    channel('india', { category: 'Elden Ring', startedAt: new Date(W1 - 5 * MIN).toISOString(), viewers: 6000 }, { multiplier: 1 }),
  ]
  const model = liveFeedModel(hub(live, [spike('alpha', W1 - 3 * MIN)]))

  it('lists the games the rows name, most rows first, keeping a picked game with none', () => {
    expect(feedGames(model).map((g) => [g.name, g.rows])).toEqual([['Elden Ring', 4], ['Chess', 3]])
    expect(feedGames(model, 'Minecraft').at(-1)).toMatchObject({ name: 'Minecraft', rows: 0 })
  })

  it('keeps only the game’s rows, its share of the went-live row and its Picking up channels', () => {
    const er = feedForGame(model, 'Elden Ring')
    expect(er.items.map((it) => it.key)).toEqual(['g:alpha', 'g:india', 'lives'])
    const shared = er.items[2]!
    expect('lives' in shared && shared.lives.map((e) => e.login)).toEqual(['golf'])
    expect(shared.old).toBe(true) // golf started 40 minutes ago
    expect(er.up.map((u) => u.login)).toEqual(['charlie'])
    expect(er.events.every((e) => e.cat === 'Elden Ring')).toBe(true)
    expect(feedForGame(model, 'Minecraft').items).toEqual([])
    expect(feedForGame(model, null)).toBe(model)
  })

  it('links the picked game to its Moments (B2’s ?game=), by the id its art names', () => {
    const art = new Map([['Elden Ring', 'https://static-cdn.jtvnw.net/ttv-boxart/512953_IGDB-52x72.jpg'], ['Chess', 'https://example.com/ttv-boxart/743-52x72.jpg']])
    const [er, chess] = feedGames({ ...model, art })
    expect(er).toMatchObject({ name: 'Elden Ring', id: '512953' })
    expect(chess).toMatchObject({ name: 'Chess', id: null })
    expect(feedMomentsHref(er)).toBe('/analytics/moments?game=512953')
    // no id (no art, or art not Twitch's): the whole page
    expect(feedMomentsHref(chess)).toBe('/analytics/moments')
    expect(feedMomentsHref(null)).toBe('/analytics/moments')
    expect(feedGameId('https://static-cdn.jtvnw.net/ttv-boxart/27471-144x192.jpg')).toBe('27471')
    expect(feedGameId('https://static-cdn.jtvnw.net/ttv-boxart/Minecraft-144x192.jpg')).toBeNull()
  })
})

describe('feed formatting', () => {
  it('caps rows by screen', () => {
    expect(feedCap(true, false, 900)).toBe(6)
    expect(feedCap(false, false, 900)).toBe(8)
    expect(feedCap(false, true, 1000)).toBe(12)
    expect(feedCap(false, true, 500)).toBe(6)
    // 1100–1535: what the column beside Top emotes gives, less the rule and Show more
    expect(feedColumnCap(794)).toBe(14)
    expect(feedColumnCap(120)).toBe(3)
  })

  it('says how long ago, and a big × as sent (E1 candidate, 10-30)', () => {
    expect(feedAgo(W1 - 30_000, W1)).toBe('just now')
    expect(feedAgo(W1 - 12 * MIN, W1)).toBe('12 min ago')
    // a row's time, on its right (L1, 10-22)
    expect([30_000, 12 * MIN, 125 * MIN].map(ago => feedShort(W1 - ago, W1))).toEqual(['now', '12m', '2h'])
    expect(feedMultiplier(12)).toBe('12×')
    expect(feedMultiplier(68.1)).toBe('68×')
    expect(feedMultiplier(2.04)).toBe('2.0×')
  })

  it('names the earlier events of a row', () => {
    const one = model1()
    expect(feedRestTip(one.slice(0, 1))).toBe('')
    expect(feedRestTip(one)).toMatch(/^Earlier: .+ went live$/)
  })
})

describe('the quiet line on old data (Q1, 10-28)', () => {
  const hour = feedClockFloor(W1)

  it('keeps the current words on fresh data', () => {
    expect(feedQuietText(null, W1, W1 + 30_000)).toBe('Quiet right now · nothing in the last hour')
    expect(feedQuietText('Chess', W1, W1 + 30_000)).toBe('Nothing from Chess in the last hour')
    expect(feedPeekQuietText(W1, W1 + 30_000)).toBe('Quiet right now.')
  })

  it('names the hour on the feed’s own clock once the data is over 3 minutes old', () => {
    expect(feedQuietText(null, W1, W1 + 4 * 60 * MIN)).toBe(`Nothing in the hour before ${hour}`)
    expect(feedQuietText('Chess', W1, W1 + 181_000)).toBe(`Nothing from Chess in the hour before ${hour}`)
    expect(feedPeekQuietText(W1, W1 + 4 * 60 * MIN)).toBe(`Nothing in the hour before ${hour}.`)
    // the "as of" time: floored, never rounded up
    expect(feedQuietText(null, W1 + 59_000, W1 + 4 * 60 * MIN)).toBe(`Nothing in the hour before ${hour}`)
  })

  it('turns at 3 minutes, the same check that greys the dot', () => {
    expect(feedStale(W1, W1 + FEED_STALE_MS)).toBe(false)
    expect(feedStale(W1, W1 + FEED_STALE_MS + 1)).toBe(true)
    expect(feedStale(null, W1 + 60 * MIN)).toBe(false)
    expect(feedQuietText(null, W1, W1 + FEED_STALE_MS)).toBe('Quiet right now · nothing in the last hour')
    expect(feedQuietText(null, W1, W1 + FEED_STALE_MS + 1)).toBe(`Nothing in the hour before ${hour}`)
  })

  it('names the hour on a saved copy whatever the viewer’s clock says', () => {
    // a clock behind the server's makes old data look new
    expect(feedQuietText(null, W1, W1 - 10 * MIN, true)).toBe(`Nothing in the hour before ${hour}`)
    expect(feedPeekQuietText(W1, W1, true)).toBe(`Nothing in the hour before ${hour}.`)
  })
})

describe('the feed’s line with no hub answer behind it (10-28)', () => {
  const none = liveFeedModel(null)
  const quiet = liveFeedModel(hub([]))
  const busy = liveFeedModel(hub([channel('echo', { startedAt: new Date(W1 - 10 * MIN).toISOString(), viewers: 8000 }, { multiplier: 1 })]))

  it('says it is loading while the hub read runs (totals only, or nothing yet)', () => {
    expect(feedWaitText(none, 'loading')).toBe(FEED_LOADING)
    expect(FEED_LOADING).toBe('Loading live feed…')
  })

  it('says unavailable once the read gave up, and never shows an empty feed as a quiet hour', () => {
    expect(feedWaitText(none, 'unavailable')).toBe(FEED_UNAVAILABLE)
    expect(FEED_UNAVAILABLE).toBe('Unavailable right now.')
    // nothing at all and nothing coming (was "No live data yet.")
    expect(feedWaitText(none, null)).toBe(FEED_UNAVAILABLE)
    // the first reply, or a feed not built yet, is still coming
    expect(feedWaitText(none, null, true)).toBe(FEED_LOADING)
  })

  it('waits on a saved copy with no rows, and shows a saved copy’s rows as they are', () => {
    expect(feedWaitText(quiet, 'loading')).toBe(FEED_LOADING)
    expect(feedWaitText(busy, 'loading')).toBeNull()
    expect(feedWaitText(busy, 'unavailable')).toBeNull()
  })

  it('leaves a hub answer’s quiet hour to the quiet line', () => {
    expect(feedWaitText(quiet, null)).toBeNull()
    expect(feedWaitText(quiet, null, true)).toBeNull()
  })
})

function model1() {
  const m = liveFeedModel(hub(
    [channel('alpha', { startedAt: new Date(W1 - 9 * MIN).toISOString(), viewers: 7000 })],
    [spike('alpha', W1 - 2 * MIN)],
  ))
  const item = m.items[0]!
  return 'group' in item ? item.group : []
}

/* ---------- L1: the moment rows from the Moments list ---------- */

const feedFixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { items: MomentsFeedItem[] }
const pick = (test: (item: MomentsFeedItem) => boolean) => {
  const found = feedFixture.items.find(test)
  if (!found) throw new Error('fixture lacks the case')
  return found
}
const holds = pick((item) => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)
const partly = pick((item) => item.verdict === 'warn')
const fails = pick((item) => item.verdict === 'bad')
const at = (item: MomentsFeedItem, login: string, minuteStart: number): MomentsFeedItem =>
  ({ ...item, id: `pulse-${login}-s-${login}-${item.offsetSeconds}`, login, displayName: login.toUpperCase(), streamId: `s-${login}`, minuteStart })

describe('liveFeedModel with the Moments list', () => {
  const live = [channel('alpha'), channel('kilo', {}, { multiplier: 1 }), channel('lima', {}, { multiplier: 1 })]
  const hubMoment = {
    login: 'mike', displayName: 'MIKE', streamId: 's-mike', at: W1 - 4 * MIN, offsetSeconds: 3600, score: 9, label: 'Chat spike', kind: 'chat_spike', chatPerMin: 90,
    comparison: { chat: { state: 'ready', multiplier: 3, currentPerMin: 90, baselinePerMin: 30, baselineMeasuredMinutes: 40 } },
  } as unknown as HubLivePulseMoment
  const items = [
    at(holds, 'kilo', W1 - 2 * MIN),
    at(partly, 'lima', W1 - 40 * MIN),
    at(fails, 'november', W1 - 5 * MIN),
    at(holds, 'oscar', W1 - 3 * 60 * MIN), // before the hour
  ]
  const withHub = { ...hub(live, [spike('alpha', W1 - 1 * MIN)]), livePulseMoments: [hubMoment] } as LiveFeedInput
  const model = liveFeedModel(withHub, { items, generatedAt: W1 + 30_000 })

  it('takes its moment rows from the list in the hour, leaving out what does not hold up, and keeps the hub spikes', () => {
    expect(model.list).toBe(true)
    expect(model.asOf).toBe(W1 + 30_000)
    expect(model.events.map((e) => `${e.kind}:${e.login}`)).toEqual(['spike:alpha', 'moment:kilo', 'moment:lima'])
  })

  it('shows the list’s own × for a moment that holds up, and why for one that partly does', () => {
    const [kilo, lima] = model.events.filter((e) => e.kind === 'moment')
    if (kilo?.kind !== 'moment' || lima?.kind !== 'moment') throw new Error('no moments')
    expect(kilo.x).toBe(holds[holds.label.kind].x)
    expect(kilo.list).toBe(true)
    expect(kilo.row.href).toBe(`/analytics/moments?m=pulse-kilo-s-kilo-${holds.offsetSeconds}`)
    expect(kilo.row.cmp).toMatchObject({ x: holds[holds.label.kind].x, over: 'the 15 minutes before' })
    expect(lima.x).toBeNull()
    expect(lima.why).toBeTruthy()
    expect('why' in lima.row.cmp && lima.row.cmp.why).toBe(lima.why)
    // the × says what it counts, as on Moments (X1, 10-22)
    expect(feedMomentSer(kilo)).toBe(holds.label.kind)
    expect(feedRowAria([kilo], W1 + 30_000)).toContain(`, ${holds.label.kind} ${String(holds[holds.label.kind].x).replace(/\.0$/, '')}`)
  })

  it('says a big list × to screen readers as the row prints it, never "at least 10"', () => {
    const kilo = model.events.find((e): e is FeedMoment => e.kind === 'moment' && e.login === 'kilo')!
    const aria = feedRowAria([{ ...kilo, x: 23.7 }], W1 + 30_000)
    expect(aria).toContain(`${feedMomentSer(kilo)} 24 times usual`)
    expect(aria).not.toContain('at least')
  })

  it('without the list, keeps the hub’s own moment rows', () => {
    const hubOnly = liveFeedModel(withHub)
    expect(hubOnly.list).toBe(false)
    expect(hubOnly.top).toEqual([])
    const moments = hubOnly.events.filter((e) => e.kind === 'moment')
    expect(moments.map((e) => e.login)).toEqual(['mike'])
    if (moments[0]?.kind !== 'moment') throw new Error('no moment')
    expect(feedMomentSer(moments[0])).toBe('chat')
    expect(feedRowAria(moments, W1 + 30_000)).toBe('MIKE chat burst, 4 min ago: 60 more chat a minute than usual, chat 3.0 times usual. Opens in Moments.')
  })

  it('keeps the day’s top moments from before the hour for a quiet hour, one a channel, none from a channel in the hour', () => {
    const early = [
      at(holds, 'oscar', W1 - 3 * 60 * MIN),
      { ...at(holds, 'papa', W1 - 2 * 60 * MIN), [holds.label.kind]: { ...holds[holds.label.kind], x: 9 } } as MomentsFeedItem,
      at(holds, 'kilo', W1 - 4 * 60 * MIN), // kilo has a row in the hour
      at(partly, 'quebec', W1 - 2 * 60 * MIN), // no ×: not a top moment
    ]
    const m = liveFeedModel(withHub, { items: [...items, ...early], generatedAt: W1 })
    expect(m.top.map((it) => it.key)).toEqual(['t:papa', 't:oscar'])
    expect(m.top.every((it) => it.old)).toBe(true)
  })
})

describe('earlier on streams live now (E1 candidate, 10-30)', () => {
  // The hub answer of 2026-10-30 07:19Z, trimmed: 10 livePulseMoments, the pool wire and 6 of its live channels.
  const capture: LiveFeedInput = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_live_pulse_20261030.json'), 'utf8')))
  const m = liveFeedModel(capture)

  it('keeps the hour as it was and lists the other moments under it, newest first, same-minute twins folded', () => {
    expect(m.events.filter((e) => e.kind === 'moment').map((e) => e.login)).toEqual(['aldo_geo'])
    const rows = m.earlier.map((it) => ('group' in it ? it.group[0]! : null)).filter((e): e is FeedMoment => e?.kind === 'moment')
    expect(rows.map((e) => e.login)).toEqual(['e11ysa', 'findjeremiah', 'supertf', 'supertf', 'e11ysa'])
    expect(rows.every((e, i) => i === 0 || rows[i - 1]!.at >= e.at)).toBe(true)
    // the 04:29Z and 00:05Z minutes: both channels counted the same emotes, one row each naming the other
    expect(rows[0]!.also).toEqual(['findjeremiah'])
    expect(rows[4]!.also).toEqual(['findjeremiah'])
    // a stream's first 20 minutes, and a moment with no ready ×, stay out as in the hour
    expect(rows.some((e) => e.login === 'jinnytty')).toBe(false)
    expect(m.earlier.every((it) => it.old)).toBe(true)
  })

  it('counts the earlier rows in the game strip and keeps only the picked game’s', () => {
    // findjeremiah (IRL) shares two minutes with e11ysa (Just Chatting): both count for IRL, and picking IRL shows them
    expect(feedGames(m).find((g) => g.name === 'IRL')?.rows).toBe(4)
    const irl = feedForGame(m, 'IRL')
    const lead = (it: (typeof irl.earlier)[number]) => ('group' in it ? it.group[0]! : null)
    expect(irl.earlier.map((it) => lead(it)?.login)).toEqual(['findjeremiah', 'findjeremiah', 'findjeremiah'])
    expect(irl.earlier.map((it) => it.at)).toEqual([...irl.earlier.map((it) => it.at)].sort((a, b) => b - a))
    expect(new Set(irl.earlier.map((it) => it.key)).size).toBe(3)
    // under Just Chatting the e11ysa rows no longer name the IRL channel
    const jc = feedForGame(m, 'Just Chatting')
    expect(jc.earlier.flatMap((it) => (lead(it)?.kind === 'moment' ? (lead(it) as FeedMoment).also ?? [] : []))).toEqual([])
  })

  it('names a folded channel to screen readers too', () => {
    const shared = m.earlier.map((it) => ('group' in it ? it.group[0]! : null)).find((e): e is FeedMoment => e?.kind === 'moment' && !!e.also?.length)!
    expect(feedRowAria([shared], Date.parse('2026-10-30T07:19:35Z'))).toContain('with findjeremiah in the same minute')
  })

  it('prints a big × as sent, and says the same number to screen readers', () => {
    const big = m.earlier.flatMap((it) => ('group' in it ? it.group : [])).find((e: FeedEvent): e is FeedMoment => e.kind === 'moment' && e.x != null && e.x > 30)
    expect(big?.login).toBe('e11ysa')
    expect(feedMultiplier(big!.x!)).toBe('38×')
    expect(feedRowAria([big!], Date.parse('2026-10-30T07:19:35Z'))).toContain('emotes 38 times usual')
  })

  it('takes a went-live time from the pool wire when the channel sends none', () => {
    const astana = capture.liveChannels.find((c) => c.login.toLowerCase() === 'astana666santa')!
    const attach = capture.moments.find((x) => x.kind === 'live_attach' && x.login?.toLowerCase() === 'astana666santa')!
    expect(liveStartOf({ ...astana, startedAt: undefined } as HubLiveChannel, attach.at)).toBe(attach.at)
  })

  it('says chat vs usual is missing when no channel’s came, instead of calling the hour quiet', () => {
    const down = liveFeedModel({
      ...capture,
      liveChannels: capture.liveChannels.map((c) => ({ ...c, screenerV1: c.screenerV1 && { ...c.screenerV1, state: 'unavailable', currentWindow: { ...c.screenerV1.currentWindow, measuredMinutes: 0 } } } as HubLiveChannel)),
    })
    expect(down.screenerReady).toBe(0)
    expect(down.up).toEqual([])
    expect(feedBlind(down)).toBe(true)
    expect(feedBlind(m)).toBe(false)
    expect(FEED_BLIND).toBe('Chat vs usual isn’t in this update, so chat spikes and Picking up can’t show.')
    expect(feedQuietText(null, down.asOf!, down.asOf! + 1000, false, feedBlind(down))).toBe('No new moments in the last hour')
    expect(m.screenerReady).toBeGreaterThan(0)
  })
})
