/**
 * Your follows (11-01): the followed channels live in the pool, counted exactly as Busiest now counts them, and
 * the words around the row.
 */
import { describe, expect, it } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import type { TwitchFollows } from '../src/lib/twitchFollows'
import { HUB_FOLLOWS_COUNT, followsMeta, followsTip, rankFollows } from '../src/ui/components/hub/v5/hubV5FollowsModel'
import { channelHref, hubClock, hubClockRange, rankBusiest } from '../src/ui/components/hub/v5/hubV5Model'

const MIN = 60_000
const END = Date.UTC(2026, 10, 1, 18, 0)

/** A synced channel; `rate` gives it a full 5-minute window ending at `end`. */
function chan(login: string, opts: { rate?: number; viewers?: number; end?: number; avg?: number } = {}): HubLiveChannel {
  const { rate, viewers = 100, end = END, avg = 0 } = opts
  return {
    login,
    displayName: login.toUpperCase(),
    category: 'Just Chatting',
    streamId: `s-${login}`,
    viewers,
    chatPerMin: avg,
    seventvPerMin: 0,
    coverageState: 'synced',
    trendPct: 0,
    profileImageUrl: `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`,
    ...(rate == null ? {} : {
      screenerV1: {
        version: 1,
        measuredAt: end,
        baselineKind: 'current_stream_measured_average',
        state: 'ready',
        currentWindow: { start: end - 5 * MIN, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
        baselineWindow: null,
        baselineMeasuredMinutes: 40,
        evidence: null,
        chat: { state: 'ready', currentPerMin: rate, baselinePerMin: rate, multiplier: 1, baselineMeasuredMinutes: 40 },
        emotes: null,
      },
    }),
  } as HubLiveChannel
}

const follows = (logins: string[], over: Partial<TwitchFollows> = {}): TwitchFollows =>
  ({ login: 'viewer', name: 'Viewer', logins, total: logins.length, at: END, ...over })

describe('rankFollows', () => {
  it('keeps only followed channels, matched without case', () => {
    const set = rankFollows([chan('xqc', { rate: 50 }), chan('Shroud', { rate: 40 }), chan('other', { rate: 90 })], ['xqc', 'shroud'], 'five_min')
    expect(set.rows.map((r) => r.login)).toEqual(['xqc', 'Shroud'])
    expect(set).toMatchObject({ live: 2, counted: 2, windowStart: END - 5 * MIN, windowEnd: END, basis: 'five_min' })
  })

  it('puts counted channels first by chat/min, then viewers, then name; the rest by viewers, showing viewers', () => {
    const live = [
      chan('quiet', { viewers: 9_000 }),
      chan('b', { rate: 30, viewers: 500 }),
      chan('a', { rate: 30, viewers: 500 }),
      chan('big', { rate: 30, viewers: 900 }),
      chan('fast', { rate: 80, viewers: 10 }),
      chan('quieter', { viewers: 12_345 }),
    ]
    const set = rankFollows(live, live.map((c) => c.login), 'five_min')
    expect(set.rows.map((r) => r.login)).toEqual(['fast', 'big', 'a', 'b', 'quieter', 'quiet'])
    expect(set.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6])
    expect(set.counted).toBe(4)
    const [fast] = set.rows
    expect(fast).toMatchObject({ fig: '80', perMin: 80, href: channelHref(live[4]!), avatar: live[4]!.profileImageUrl })
    expect(fast!.viewersOnly).toBeUndefined()
    const quieter = set.rows[4]!
    expect(quieter).toMatchObject({ viewersOnly: true, fig: '12,345', viewers: 12_345 })
    expect(quieter.perMin).toBeNaN()
  })

  it('counts a channel only in the pool’s shared window, so it shows Busiest now’s number', () => {
    const others = Array.from({ length: 5 }, (_, i) => chan(`pool${i}`, { rate: 10 + i }))
    const late = chan('late', { rate: 99, end: END - 5 * MIN })
    const live = [...others, late, chan('mine', { rate: 20 })]
    const set = rankFollows(live, ['late', 'mine'], 'five_min')
    expect(set.rows.map((r) => [r.login, r.fig])).toEqual([['mine', '20'], ['late', '100']])
    expect(set.rows[1]!.viewersOnly).toBe(true)
    const busiest = rankBusiest(live)
    expect(busiest.rows.find((r) => r.login === 'mine')!.fig).toBe('20')
    expect(busiest.rows.some((r) => r.login === 'late')).toBe(false)
  })

  it('shows viewers for every row when no channel has a full window', () => {
    const set = rankFollows([chan('a', { viewers: 5 }), chan('b', { viewers: 50 })], ['a', 'b'], 'five_min')
    expect(set.rows.map((r) => r.login)).toEqual(['b', 'a'])
    expect(set.counted).toBe(0)
    expect(set.windowEnd).toBeNaN()
  })

  it('on the recent average, counts the average and marks the rows', () => {
    const set = rankFollows([chan('a', { avg: 12.34 }), chan('b', { avg: 0, viewers: 7 })], ['a', 'b'], 'avg_35')
    expect(set.rows.map((r) => [r.login, r.fig, r.basis, r.viewersOnly])).toEqual([['a', '12', 'avg_35', undefined], ['b', '7', undefined, true]])
    expect(set.windowStart).toBeNaN()
  })

  it(`shows the busiest ${HUB_FOLLOWS_COUNT} of more`, () => {
    const live = Array.from({ length: 70 }, (_, i) => chan(`c${i}`, { rate: i + 1 }))
    const set = rankFollows(live, live.map((c) => c.login), 'five_min')
    expect(set.rows).toHaveLength(HUB_FOLLOWS_COUNT)
    expect(set.live).toBe(70)
    expect(set.rows[0]!.login).toBe('c69')
  })
})

describe('followsMeta', () => {
  it('says how many follows are live here, or why none are', () => {
    expect(followsMeta({ live: 0 }, { total: 0 })).toBe('Your Twitch account doesn’t follow any channels yet')
    expect(followsMeta({ live: 0 }, { total: 1_234 })).toBe('None of your 1,234 follows are live here right now')
    expect(followsMeta({ live: 1 }, { total: 3 })).toBe('1 of your 3 follows is live here')
    expect(followsMeta({ live: 5 }, { total: 412 })).toBe('5 of your 412 follows are live here')
  })
})

describe('followsTip', () => {
  it('explains the pool, the ranking, the cap, the read and where the list lives', () => {
    const live = Array.from({ length: 62 }, (_, i) => chan(`c${i}`, { rate: i + 1 }))
    const set = rankFollows(live, live.map((c) => c.login), 'five_min')
    const mine = follows(live.map((c) => c.login), { total: 3_200, at: END + 2 * MIN })
    expect(followsTip(set, mine, 480, 1_000).split('\n')).toEqual([
      'Channels you follow on Twitch that are in the live pool (480 of the ~1,000 we follow). Your other follows can be live on Twitch too.',
      `Ranked like Busiest now: chat messages per minute in the last full 5-minute window (${hubClockRange(END - 5 * MIN, END)}). Channels without that count show viewers and come after.`,
      'The busiest 60 are shown.',
      `Read from Twitch at ${hubClock(END + 2 * MIN)} for Viewer: Twitch lists 3,200 follows and the 62 most recent are used.`,
      'Only this tab keeps the list, and it is never sent to StreamPulse. Forget clears it.',
    ])
  })

  it('says when the counts are the recent average, or missing', () => {
    const avg = rankFollows([chan('a', { avg: 5 })], ['a'], 'avg_35')
    expect(followsTip(avg, follows(['a']), 3, 0).split('\n').slice(0, 2)).toEqual([
      'Channels you follow on Twitch that are in the live pool (3 channels). Your other follows can be live on Twitch too.',
      'Ranked like Busiest now: the 5-minute counts did not load, so by recent average chat per minute (up to the last 35 minutes). Channels without one show viewers and come after.',
    ])
    const none = rankFollows([chan('a')], ['a'], 'five_min')
    expect(followsTip(none, follows(['a']), 3, 1_000).split('\n')[1]).toBe('No channel has a full 5-minute chat count right now, so these show viewers.')
    expect(followsTip(none, follows(['a']), 3, 1_000).split('\n')[2]).toBe(`Read from Twitch at ${hubClock(END)} for Viewer.`)
  })
})
