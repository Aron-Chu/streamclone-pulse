/**
 * What the hub's Top moments today rail (HubV5TopMoments) shares with the rest
 * of the page: the Picking up row, the age line and the × words. Pure
 * functions over the hub payload; every time and figure is one the backend
 * sent, nothing is estimated.
 *
 * - Picking up: live channels whose chat over the last 5 minutes ran at least
 *   1.5× their own average, at least 30 a minute and 20 more than usual,
 *   ranked by how many more messages a minute.
 */
import type { HubLiveChannel, PublicHub } from '../../../../lib/publicHub'
import { screenerMetricMultiplier } from '../../../../lib/channelScreenerContract'
import { formatHubInt, hasFullChatWindow, hubClock, hubClockRange } from './hubV5Model'

export const FEED_UP_MIN = 1.5
export const FEED_NOW_MIN = 30
export const FEED_ADD_MIN = 20
export const FEED_UP_LIST = 5
/** The dot greys once the data is older than this. */
export const FEED_STALE_MS = 3 * 60_000

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

interface GateMetric {
  state?: string
  multiplier?: number | null
  baselineMeasuredMinutes?: number | null
}
/** The comparison gate (Q4): ready, at least 10 measured minutes behind it, and a number. */
function q4(m: GateMetric | null | undefined): m is GateMetric & { multiplier: number } {
  return !!m && m.state === 'ready' && finite(m.baselineMeasuredMinutes) && m.baselineMeasuredMinutes >= 10 && finite(m.multiplier)
}

/** A channel whose last 5 minutes of chat ran 1.5×+ its own average, 30+ a minute and 20+ more than usual. */
export function screenerHot(c: HubLiveChannel | null | undefined): boolean {
  const s = c?.screenerV1?.chat
  return !!c && !!s && hasFullChatWindow(c) && q4(s) && screenerMetricMultiplier(c.screenerV1, 'chat') != null
    && s.multiplier! >= FEED_UP_MIN && s.currentPerMin >= FEED_NOW_MIN && finite(s.absoluteDeltaPerMin) && s.absoluteDeltaPerMin >= FEED_ADD_MIN
}

/** "4:25 PM", to the minute and never rounded up (the "as of" line). */
export function feedClockFloor(t: number): string {
  return new Date(Math.floor(t / 60_000) * 60_000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "just now", "12 min ago", else the clock time. */
export function feedAgo(at: number, nowMs: number): string {
  const m = Math.max(0, Math.floor((nowMs - at) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : hubClock(at)
}

/** The header's age line: "as of 4:25 PM", and how old once that is a minute or more ("3 min old"; from an hour, "17 h old"). */
export function feedFreshText(asOf: number | null, nowMs: number): string {
  if (asOf == null) return ''
  const m = Math.floor(Math.round((nowMs - asOf) / 1000) / 60)
  return `as of ${feedClockFloor(asOf)}${m >= 1 ? ` · ${m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`} old` : ''}`
}

/** The data is over 3 minutes old: the dot greys. */
export const feedStale = (asOf: number | null, nowMs: number): boolean => asOf != null && nowMs - asOf > FEED_STALE_MS

export const feedMore = (n: number) => formatHubInt(Math.round(n))

export interface FeedUpRow {
  login: string
  name: string
  cat: string | null
  streamId: string
  avatar: string | null
  x: number
  add: number
}

export interface FeedUp {
  up: FeedUpRow[]
  /** The 5-minute window most Picking up channels share, as sent ("4:20–4:25 PM"). */
  upWindow: string
}

function commonWindow(rows: readonly HubLiveChannel[]): string {
  const tally = new Map<string, { a: number; b: number; n: number }>()
  for (const c of rows) {
    const w = c.screenerV1?.currentWindow
    if (!w || !finite(w.start) || !finite(w.end)) continue
    const k = `${w.start}|${w.end}`
    const t = tally.get(k) ?? { a: w.start, b: w.end, n: 0 }
    t.n += 1
    tally.set(k, t)
  }
  const top = [...tally.values()].sort((x, y) => y.n - x.n)[0]
  return top ? hubClockRange(top.a, top.b) : ''
}

/** Picking up: chat 1.5×+ usual with the floors above, most more messages a minute first. */
export function feedUp(hub: Pick<PublicHub, 'liveChannels'> | null | undefined): FeedUp {
  const hot = (hub?.liveChannels ?? []).filter((c) => screenerHot(c))
    .sort((a, b) => b.screenerV1!.chat!.absoluteDeltaPerMin! - a.screenerV1!.chat!.absoluteDeltaPerMin!)
  return {
    up: hot.map((c) => ({
      login: c.login.toLowerCase(), name: c.displayName || c.login, cat: c.category || null, streamId: c.streamId || '', avatar: c.profileImageUrl || null,
      x: c.screenerV1!.chat!.multiplier!, add: c.screenerV1!.chat!.absoluteDeltaPerMin!,
    })),
    upWindow: commonWindow(hot),
  }
}

export function feedUpAria({ up, upWindow }: FeedUp): string {
  const n = up.length
  const top = up[0]
  return `Picking up: ${n} ${n === 1 ? 'channel' : 'channels'} whose chat${upWindow ? ` over ${upWindow}` : ''} ran at least ${FEED_UP_MIN} times usual, at least ${FEED_NOW_MIN} a minute and ${FEED_ADD_MIN} more than usual.`
    + (top ? ` Most added: ${top.name}, ${feedMore(top.add)} more a minute.` : '') + ' Show them.'
}
