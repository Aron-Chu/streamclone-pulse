/**
 * Your follows (Show my Twitch follows, 11-01): the live channels of the hub's
 * pool that the viewer follows on Twitch, on Busiest now's tiles. A row has a
 * chat rate exactly when Busiest now would count it (the shared 5-minute
 * window, or the recent average while those counts are down), so a channel in
 * both rows shows the same number. Counted rows come first by chat/min, then
 * viewers, then login; the rest show viewers, by viewers. Pure functions over
 * the hub payload and the list this tab read from Twitch.
 */
import type { HubLiveChannel } from '../../../../lib/publicHub'
import type { TwitchFollows } from '../../../../lib/twitchFollows'
import {
  channelChat,
  channelHref,
  formatHubInt,
  formatHubRate,
  hubClock,
  hubClockRange,
  sharedChatWindow,
  type HubBusiestRow,
  type HubBusiestSet,
  type HubChatBasis,
} from './hubV5Model'

/** Tiles in the row: the busiest 60 of a heavy follower's live channels. */
export const HUB_FOLLOWS_COUNT = 60

export interface HubFollowsSet extends Pick<HubBusiestSet, 'windowStart' | 'windowEnd'> {
  rows: HubBusiestRow[]
  /** Followed channels live in the pool (the rows before the cap). */
  live: number
  /** Rows with a chat rate. */
  counted: number
  basis: HubChatBasis
}

const byLogin = (a: HubLiveChannel, b: HubLiveChannel) => (a.login < b.login ? -1 : a.login > b.login ? 1 : 0)

export function rankFollows(live: readonly HubLiveChannel[], logins: readonly string[], basis: HubChatBasis, n = HUB_FOLLOWS_COUNT): HubFollowsSet {
  const followed = new Set(logins)
  const [windowStart, windowEnd] = basis === 'avg_35' ? [NaN, NaN] : sharedChatWindow(live)
  const rateOf = (c: HubLiveChannel): number | null => {
    const rate = channelChat(c, basis)
    if (rate == null || basis === 'avg_35') return rate
    const w = c.screenerV1?.currentWindow
    return w?.start === windowStart && w?.end === windowEnd ? rate : null
  }
  const mine = live
    .filter((c) => followed.has(c.login.toLowerCase()))
    .map((c) => ({ c, rate: rateOf(c) }))
  const counted = mine.filter((m) => m.rate != null)
  const rows = [
    ...counted.sort((a, b) => b.rate! - a.rate! || (b.c.viewers || 0) - (a.c.viewers || 0) || byLogin(a.c, b.c)),
    ...mine.filter((m) => m.rate == null).sort((a, b) => (b.c.viewers || 0) - (a.c.viewers || 0) || byLogin(a.c, b.c)),
  ]
    .slice(0, n)
    .map(({ c, rate }, index): HubBusiestRow => ({
      rank: index + 1,
      login: c.login,
      displayName: c.displayName || c.login,
      category: c.category || '',
      streamId: c.streamId,
      viewers: c.viewers,
      perMin: rate ?? NaN,
      fig: rate != null ? formatHubRate(rate) : formatHubInt(c.viewers),
      href: channelHref(c),
      avatar: c.profileImageUrl || null,
      ...(rate != null && basis === 'avg_35' ? { basis } : {}),
      ...(rate == null ? { viewersOnly: true } : {}),
    }))
  return { rows, live: mine.length, counted: counted.length, windowStart, windowEnd, basis }
}

/** "3 of your 412 follows are live here", or why the row is empty. */
export function followsMeta(set: Pick<HubFollowsSet, 'live'>, follows: Pick<TwitchFollows, 'total'>): string {
  if (follows.total === 0) return 'Your Twitch account doesn’t follow any channels yet'
  const total = formatHubInt(follows.total)
  if (set.live === 0) return `None of your ${total} follows are live here right now`
  return `${formatHubInt(set.live)} of your ${total} follows ${set.live === 1 ? 'is' : 'are'} live here`
}

/** The (i): one paragraph per line. The follows are matched in the live pool, sized as Channels sizes it. */
export function followsTip(set: HubFollowsSet, follows: TwitchFollows, liveCount: number, poolSize: number): string {
  const pool = poolSize > 0 ? `${formatHubInt(liveCount)} of the ~${formatHubInt(poolSize)} we follow` : `${formatHubInt(liveCount)} channels`
  const lines = [
    `Channels you follow on Twitch that are in the live pool (${pool}). Your other follows can be live on Twitch too.`,
  ]
  if (set.basis === 'avg_35') {
    lines.push('Ranked like Busiest now: the 5-minute counts did not load, so by recent average chat per minute (up to the last 35 minutes). Channels without one show viewers and come after.')
  } else if (Number.isFinite(set.windowStart)) {
    lines.push(`Ranked like Busiest now: chat messages per minute in the last full 5-minute window (${hubClockRange(set.windowStart, set.windowEnd)}). Channels without that count show viewers and come after.`)
  } else {
    lines.push('No channel has a full 5-minute chat count right now, so these show viewers.')
  }
  if (set.live > set.rows.length) lines.push(`The busiest ${formatHubInt(set.rows.length)} are shown.`)
  const read = `Read from Twitch at ${hubClock(follows.at)} for ${follows.name}`
  lines.push(follows.total > follows.logins.length
    ? `${read}: Twitch lists ${formatHubInt(follows.total)} follows and the ${formatHubInt(follows.logins.length)} most recent are used.`
    : `${read}.`)
  lines.push('Only this tab keeps the list, and it is never sent to StreamPulse. Forget clears it.')
  return lines.join('\n')
}

/** The hero's (i) beside the button. */
export const FOLLOWS_START_TIP = 'Twitch asks you first. Then this tab reads which channels you follow and shows the ones live here, busiest first. Only this tab keeps the list, and it is never sent to StreamPulse.'
