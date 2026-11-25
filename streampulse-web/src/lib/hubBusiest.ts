/**
 * Busiest now's ranking (R5-1) and the hub's number words it uses, with no UI
 * code: the hub's model (hubV5Model, which re-exports all of it) and the saved
 * hub copy (publicHubCache, which keeps Busiest now's rows when it trims a
 * copy) share it, so the early cache path does not load the hub's UI model.
 */
import type { HubLiveChannel } from './publicHub'
import { buildAnalyticsHref } from './analyticsLinks'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/* ---------- numbers (mockup fmt / int) ---------- */

// One formatter, made once: toLocaleString builds a new one on every call, which the hub's first draw paid for on a
// phone (S1, 11-19). Same output.
let intFormat: Intl.NumberFormat | null = null
const formatInt = (value: number) => (intFormat ??= new Intl.NumberFormat('en-US')).format(Math.round(value))

/** A rate: one decimal under 10, else a whole number with separators. */
export function formatHubRate(value: number | null | undefined): string {
  if (!finite(value)) return '—'
  return Math.abs(value) < 10 ? (Math.round(value * 10) / 10).toFixed(1) : formatInt(value)
}

export function formatHubInt(value: number | null | undefined): string {
  return finite(value) ? formatInt(value) : '—'
}

/* ---------- a channel row ---------- */

export function channelHref(channel: Pick<HubLiveChannel, 'login' | 'streamId'>): string {
  return buildAnalyticsHref({ login: channel.login, streamId: channel.streamId })
}

/** A row's name: its display name, else its login. */
export const hubChannelName = (c: Pick<HubLiveChannel, 'login' | 'displayName'>) => c.displayName || c.login

/* ---------- Busiest now (R5-1) ---------- */

/** Synced, with a full 5-minute window and a chat rate: the one rule for Busiest, Where chat is and Chat/min. */
export function hasFullChatWindow(c: HubLiveChannel): boolean {
  const s = c.screenerV1
  return c.coverageState === 'synced' && s?.currentWindow?.measuredMinutes === 5 && s.chat != null && finite(s.chat.currentPerMin)
}

/** A row's 5-minute chat rate; only for a row with a full window (hasFullChatWindow). */
export const hubChatNow = (c: HubLiveChannel) => c.screenerV1!.chat!.currentPerMin

/** A synced row with a chat average above zero (candidate, 10-30). */
export const hasChatAverage = (c: HubLiveChannel) => c.coverageState === 'synced' && finite(c.chatPerMin) && c.chatPerMin > 0

/**
 * Which chat rate the lists rank by (HUB-1, candidate, 10-30): the 5-minute
 * screener count, or, while that count is down, each row's own chatPerMin. The
 * backend averages that over the reply's lookback of up to 35 minutes (minutes
 * with data only, the open minute included; hub_overview.go
 * summarizeChannelWindow), and the row does not say how many minutes it covers.
 * It is not "now" and not a fixed 35 minutes, so every list that uses it says
 * "recent average" (CX-4 fix, 10-30), and the two rates never share a list.
 */
export type HubChatBasis = 'five_min' | 'avg_35'

export interface HubBusiestRow {
  rank: number
  login: string
  displayName: string
  category: string
  streamId?: string
  viewers: number
  perMin: number
  fig: string
  href: string
  avatar: string | null
  /** 'avg_35': perMin is the row's recent average (up to 35 min) (candidate, 10-30). */
  basis?: HubChatBasis
  /** No chat rate Busiest now would count (Your follows): the tile shows viewers and perMin is NaN. */
  viewersOnly?: boolean
}

export interface HubBusiestSet {
  rows: HubBusiestRow[]
  /** The 5-minute window the rows share (unix ms), or NaN with no rows. */
  windowStart: number
  windowEnd: number
  /** Channels with a full window (all windows). */
  eligible: number
  synced: number
  /** Synced channels without a full window yet. */
  noWindow: number
  /** Channels with a full window that is not the shared one (left out). */
  otherWindow: number
  /** 'avg_35': ranked by each row's recent average (up to 35 min), with no shared window (candidate, 10-30). */
  basis?: HubChatBasis
}

export const HUB_BUSIEST_COUNT = 12

/** The 5-minute window most channels with a full one report (the later one on a tie), in unix ms; NaN with none. */
export function sharedChatWindow(live: readonly HubLiveChannel[]): readonly [number, number] {
  const tally = new Map<string, number>()
  for (const c of live) {
    if (!hasFullChatWindow(c)) continue
    const w = c.screenerV1!.currentWindow!
    const key = `${w.start}|${w.end}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]
  return top ? top[0].split('|').map(Number) as [number, number] : [NaN, NaN]
}

/** Busiest now: the shared (most common) 5-minute window, chat/min desc, then viewers desc, then login. */
export function rankBusiest(live: readonly HubLiveChannel[], n = HUB_BUSIEST_COUNT, basis: HubChatBasis = 'five_min'): HubBusiestSet {
  if (basis === 'avg_35') return rankBusiestOnAverage(live, n)
  const ok = live.filter(hasFullChatWindow)
  const synced = live.filter((c) => c.coverageState === 'synced').length
  const [windowStart, windowEnd] = sharedChatWindow(live)
  const shared = ok.filter((c) => c.screenerV1!.currentWindow!.start === windowStart && c.screenerV1!.currentWindow!.end === windowEnd)
  const rows = shared
    .slice()
    .sort((a, b) => hubChatNow(b) - hubChatNow(a) || (b.viewers || 0) - (a.viewers || 0) || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0))
    .slice(0, n)
    .map((c, index): HubBusiestRow => ({
      rank: index + 1,
      login: c.login,
      displayName: hubChannelName(c),
      category: c.category || '',
      streamId: c.streamId,
      viewers: c.viewers,
      perMin: hubChatNow(c),
      fig: formatHubRate(hubChatNow(c)),
      href: channelHref(c),
      avatar: c.profileImageUrl || null,
    }))
  return { rows, windowStart, windowEnd, eligible: ok.length, synced, noWindow: synced - ok.length, otherWindow: ok.length - shared.length }
}

/** Busiest now on each synced row's recent average (up to 35 min): no shared window, same ties (candidate, 10-30). */
function rankBusiestOnAverage(live: readonly HubLiveChannel[], n: number): HubBusiestSet {
  const ok = live.filter(hasChatAverage)
  const synced = live.filter((c) => c.coverageState === 'synced').length
  const rows = ok
    .slice()
    .sort((a, b) => b.chatPerMin - a.chatPerMin || (b.viewers || 0) - (a.viewers || 0) || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0))
    .slice(0, n)
    .map((c, index): HubBusiestRow => ({
      rank: index + 1,
      login: c.login,
      displayName: hubChannelName(c),
      category: c.category || '',
      streamId: c.streamId,
      viewers: c.viewers,
      perMin: c.chatPerMin,
      fig: formatHubRate(c.chatPerMin),
      href: channelHref(c),
      avatar: c.profileImageUrl || null,
      basis: 'avg_35',
    }))
  return { rows, windowStart: NaN, windowEnd: NaN, eligible: ok.length, synced, noWindow: synced - ok.length, otherWindow: 0, basis: 'avg_35' }
}
