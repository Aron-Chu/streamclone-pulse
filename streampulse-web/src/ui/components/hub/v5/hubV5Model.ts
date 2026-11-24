/**
 * The d3-v5 hub page's lists (plan U4/U5, d3-v5 hub.html round 5): Busiest now,
 * Moments, Top emotes, Where chat is, Channels, the search and "How this is
 * measured". Pure functions over the hub payload; nothing here estimates a
 * value the backend did not send.
 *
 * Ported from the approved mockup (busiest-variants.js rank/tip, hub-r4.js
 * GAMES/chRows/vsCell/cmpOf/momRow, hub.js suggest/measuredBody).
 */
import type { HubActivityPoint, HubEmote, HubLiveChannel, HubLivePulseMoment, PublicHub } from '../../../../lib/publicHub'
import type { LiveWireMetricComparison } from '../../../../lib/liveWire'
import { screenerMetricMultiplier, type HubScreenerMetric } from '../../../../lib/channelScreenerContract'
import { channelHref, formatHubInt, formatHubRate, hasChatAverage, hasFullChatWindow, HUB_BUSIEST_COUNT, hubChannelName as nameOf, hubChatNow as chatNow, rankBusiest, sharedChatWindow, type HubBusiestRow, type HubBusiestSet, type HubChatBasis } from '../../../../lib/hubBusiest'
import { isPlausibleTwitchLogin } from '../../../../lib/normalizeTwitchLogin'
import { momentPageHref } from '../../../../lib/momentPageFlag'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/* ---------- formatting (mockup fmt / int / clk / mult) ---------- */

// Busiest now's ranking and the number words (formatHubRate, formatHubInt) live in lib/hubBusiest, which the saved hub
// copy shares without this UI model (11-19); they are re-exported here.
export { channelHref, formatHubInt, formatHubRate, hasFullChatWindow, HUB_BUSIEST_COUNT, rankBusiest, sharedChatWindow }
export type { HubBusiestRow, HubBusiestSet, HubChatBasis }

// One formatter each, made once: toLocaleTimeString builds a new one on every call, which the hub's first draw paid
// about 190 ms for on a phone (S1, 11-19). Same output.
let clockFormat: Intl.DateTimeFormat | null = null
let dayFormat: Intl.DateTimeFormat | null = null

const CLOCK: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
const nearestMinute = (t: number) => new Date(Math.round(t / 60_000) * 60_000)
/**
 * "10:50 AM" in the viewer's own time zone, from one shared formatter. An invalid date reads "Invalid Date", as
 * toLocaleTimeString did: Intl's format throws on one, which would take the whole hub down.
 */
export const formatHubClockAt = (at: Date) => (Number.isNaN(at.getTime()) ? 'Invalid Date' : (clockFormat ??= new Intl.DateTimeFormat('en-US', CLOCK)).format(at))

/** "10:50 AM": nearest minute, the viewer's own time zone. */
export function hubClock(t: number): string {
  return formatHubClockAt(nearestMinute(t))
}

/** A saved copy's day ("yesterday", "Oct 27"), or null today, and its minute. */
function savedClockParts(t: number, nowMs: number): { day: string | null; clock: string } {
  // Never later than now: the saved minute is floored, and a copy stamped ahead of this clock reads as now.
  const at = new Date(Math.min(t, nowMs))
  const clock = formatHubClockAt(new Date(Math.floor(at.getTime() / 60_000) * 60_000))
  const now = new Date(nowMs)
  if (at.toDateString() === now.toDateString()) return { day: null, clock }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (at.toDateString() === yesterday.toDateString()) return { day: 'yesterday', clock }
  return { day: Number.isNaN(at.getTime()) ? 'Invalid Date' : (dayFormat ??= new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })).format(at), clock }
}

/**
 * A saved copy's time (N1, 10-28): "10:50 AM" today, "yesterday, 11:30 PM",
 * else "Oct 27, 10:50 AM". Its own day and minute, so 11:59:40 PM reads as
 * 11:59 PM of that day.
 */
export function hubSavedClock(t: number, nowMs: number): string {
  const { day, clock } = savedClockParts(t, nowMs)
  return day ? `${day}, ${clock}` : clock
}

/** "at 10:50 AM" today; on another day just "yesterday, 11:30 PM" or "Oct 26, 9:05 PM". */
export function hubSavedAt(t: number, nowMs: number): string {
  const { day, clock } = savedClockParts(t, nowMs)
  return day ? `${day}, ${clock}` : `at ${clock}`
}

/** "10:45–10:50 AM" (one day period when both share it). */
export function hubClockRange(a: number, b: number): string {
  const parts = (t: number) => new Intl.DateTimeFormat('en-US', CLOCK).formatToParts(nearestMinute(t))
  const period = (p: Intl.DateTimeFormatPart[]) => p.find((x) => x.type === 'dayPeriod')?.value
  const pa = parts(a)
  const pb = parts(b)
  return period(pa) && period(pa) === period(pb)
    ? `${pa.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim()}–${hubClock(b)}`
    : `${hubClock(a)}–${hubClock(b)}`
}

/** "1.7×", "10×+". */
export function formatHubMultiplier(x: number): string {
  return x >= 10 ? '10×+' : `${(Math.round(x * 10) / 10).toFixed(1)}×`
}

/** Under its own average (shown quieter, never as a spike). */
export function isLowMultiplier(x: number): boolean {
  return x < 10 && Math.round(x * 10) / 10 < 1
}

/** "1.4" or "at least 10", for screen-reader labels. */
export function multiplierWords(x: number): string {
  return x >= 10 ? 'at least 10' : (Math.round(x * 10) / 10).toFixed(1)
}

/* ---------- avatars: the profile picture, else a toned monogram ---------- */

export const HUB_AVATAR_TONES = ['#34304a', '#2b3e3c', '#453627', '#2a364a', '#432f3b', '#373f2c'] as const

export function hubAvatarTone(login: string): string {
  let h = 7
  for (const ch of String(login)) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return HUB_AVATAR_TONES[h % HUB_AVATAR_TONES.length]!
}

export function hubMonogram(name: string | undefined, login: string): string {
  return Array.from(String(name || login || '?').replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase() || '?'
}

/* ---------- Busiest now (R5-1; the ranking is lib/hubBusiest's) ---------- */

/** The backend's reasons for a screener its own history read could not build (hub_screener.go). */
const SCREENER_READ_FAILED = new Set(['history_query_unavailable', 'history_store_unavailable'])

/** The screener's reason for a row, the chat metric's first. */
const screenerReason = (c: HubLiveChannel) => c.screenerV1?.chat?.reason || c.screenerV1?.reason || ''

/**
 * Our 5-minute chat read failed, not the channels (fix, 10-30): at least half
 * the rows came back unavailable because the backend's history read did. The
 * empty lines then say the counts are unavailable instead of blaming the
 * channels' windows. "Unavailable", not "delayed": nothing says the next poll
 * brings them back.
 */
export function screenerDown(live: readonly HubLiveChannel[]): boolean {
  if (!live.length) return false
  const failed = live.filter((c) => c.screenerV1?.state === 'unavailable' && SCREENER_READ_FAILED.has(screenerReason(c))).length
  return failed * 2 >= live.length
}

/** The empty line of Busiest now and Where chat is when the counts did not come (fix, 10-30). */
export const HUB_CHAT_COUNTS_DOWN = 'Chat counts are unavailable right now.'
/**
 * H1 (11-19): one outage of the 5-minute counts said so in three places (Busiest now, Picking up now, Where chat is).
 * Busiest now says it once, and the other two step aside until the counts are back.
 */
export const HUB_COUNTS_DOWN_REST = 'Picking up now and Where chat is come back with them.'
/** Over Busiest now's recent averages, while the 5-minute counts are down. */
export const HUB_COUNTS_DOWN_AVG = '5-minute chat counts are unavailable, so these rank by each channel’s recent average. ' + HUB_COUNTS_DOWN_REST

/** The hub windows whose reply averages row chatPerMin over up to 35 minutes (HubChatBasis); 7d and longer look back 47 minutes or more. */
const AVG_35_WINDOWS: ReadonlySet<string> = new Set(['30m', '24h'])

/** 'avg_35' only on 30m and 24h, while the screener is down and no row has a 5-minute count (candidate, 10-30). */
export function hubChatBasis(live: readonly HubLiveChannel[], windowKey?: string): HubChatBasis {
  if (live.some(hasFullChatWindow)) return 'five_min'
  return windowKey != null && AVG_35_WINDOWS.has(windowKey) && screenerDown(live) && live.some(hasChatAverage) ? 'avg_35' : 'five_min'
}

/** The rows a basis counts, and their rate (candidate, 10-30). */
const countedOn = (basis: HubChatBasis) => (basis === 'avg_35' ? hasChatAverage : hasFullChatWindow)
const rateOn = (basis: HubChatBasis): ((c: HubLiveChannel) => number) => (basis === 'avg_35' ? (c) => c.chatPerMin : chatNow)

/** Numbers older than this are not "live" (the shared 3-minute rule). */
export const HUB_LIVE_MS = 180_000

export type HubBusiestCue = 'live' | 'stale'

export function busiestCue(set: Pick<HubBusiestSet, 'windowEnd'>, nowMs: number): HubBusiestCue {
  return finite(set.windowEnd) && nowMs - set.windowEnd <= HUB_LIVE_MS ? 'live' : 'stale'
}

/**
 * Every tile tries Twitch's live picture, whatever the numbers' basis (11-22): the picture is Twitch's, checked against
 * Twitch's offline picture, and says nothing about our counts. Until 11-22 it showed only beside live 5-minute numbers
 * (mockup §5, 10-31), so the screener's outages left the strip on faces.
 */
export const BUSIEST_PICTURE_LINE = 'Each tile shows Twitch’s live picture, which can be a few minutes old; a channel Twitch has no picture for, or shows as offline, shows its profile picture.'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The (i): one paragraph per line. */
export function busiestTip(set: HubBusiestSet, cue: HubBusiestCue): string {
  if (set.basis === 'avg_35') return busiestAverageTip(set)
  const lines: string[] = []
  if (cue === 'stale' && finite(set.windowEnd)) lines.push(`Not updated since ${hubClock(set.windowEnd)}.`)
  if (finite(set.windowStart)) lines.push(`Ranked by chat messages per minute in the last full 5-minute window (${hubClockRange(set.windowStart, set.windowEnd)}); ties go to more viewers.`)
  lines.push(set.noWindow > 0
    ? `${set.eligible} of ${set.synced} synced channels have that full window; ${set.noWindow}${set.noWindow === 1 ? ' doesn’t yet and is left out.' : ' don’t yet and are left out.'}`
    : `All ${set.synced} synced channels have that full window.`)
  if (set.otherWindow > 0) lines.push(`${count(set.otherWindow, 'channel', 'channels')} reported a different window and ${set.otherWindow === 1 ? 'is' : 'are'} left out.`)
  lines.push('Live means numbers under 3 minutes old.')
  lines.push(BUSIEST_PICTURE_LINE)
  return lines.join('\n')
}

/** The (i) while Busiest ranks by the recent average (up to 35 min) (candidate, 10-30). */
function busiestAverageTip(set: HubBusiestSet): string {
  return [
    'The 5-minute counts did not load, so this ranks channels by recent average chat per minute: up to the last 35 minutes, counting only minutes with data and the current unfinished minute, so it can cover much less; ties go to more viewers.',
    set.noWindow > 0
      ? `${set.eligible} of ${set.synced} synced channels have a chat average; ${set.noWindow}${set.noWindow === 1 ? ' doesn’t and is left out.' : ' don’t and are left out.'}`
      : `All ${set.synced} synced channels have a chat average.`,
    BUSIEST_PICTURE_LINE,
  ].join('\n')
}

/** `livePicture`: the tile shows Twitch's live picture (checked), not the face tile. */
export function busiestAria(row: HubBusiestRow, total: number, livePicture = false): string {
  // the recent average says so, with no fixed span (candidate, 10-30)
  const basis = row.basis === 'avg_35' ? ', recent average' : ''
  const picture = livePicture ? 'Twitch’s live picture, can be a few minutes old.' : 'Profile picture.'
  const figure = row.viewersOnly ? `${row.fig} ${row.viewers === 1 ? 'viewer' : 'viewers'}, no chat count` : `${row.fig} chat messages per minute${basis}`
  return `${row.displayName}, ${figure}, ${row.category || 'No category'}, rank ${row.rank} of ${total}. ${picture}`
}

/* ---------- Where chat is (R5-6, the round-5 list) ---------- */

export interface HubGameShare {
  name: string
  chat: number
  viewers: number
  /** Share of chat, percent. */
  chatShare: number
  viewerShare: number
  rows: HubLiveChannel[]
}

export interface HubWhereChatIs {
  top: HubGameShare[]
  rest: HubGameShare[]
  all: HubGameShare[]
  /** Channels counted (full 5-minute window). */
  counted: number
  noWindow: number
  /** The 5-minute counts did not come (screenerDown): the rack's empty line says so (fix, 10-30). */
  down?: boolean
  /** 'avg_35': shares of each row's recent average (up to 35 min) (candidate, 10-30). */
  basis?: HubChatBasis
}

export const HUB_NO_CATEGORY = 'No category'
export const gameOf = (c: Pick<HubLiveChannel, 'category'>) => c.category || HUB_NO_CATEGORY

/** `windowKey`: the hub window on screen; on 30m and 24h a screener outage shares out the recent average (up to 35 min) (candidate, 10-30). */
export function whereChatIs(live: readonly HubLiveChannel[], limit = 10, windowKey?: string): HubWhereChatIs {
  const basis = hubChatBasis(live, windowKey)
  const rate = rateOn(basis)
  const ok = live.filter(countedOn(basis))
  const synced = live.filter((c) => c.coverageState === 'synced').length
  const byGame = new Map<string, HubGameShare>()
  for (const c of ok) {
    const key = gameOf(c)
    let game = byGame.get(key)
    if (!game) byGame.set(key, (game = { name: key, chat: 0, viewers: 0, chatShare: 0, viewerShare: 0, rows: [] }))
    game.chat += rate(c)
    game.viewers += c.viewers || 0
    game.rows.push(c)
  }
  const all = [...byGame.values()].sort((a, b) => b.chat - a.chat || b.viewers - a.viewers)
  const totalChat = all.reduce((sum, g) => sum + g.chat, 0)
  const totalViewers = all.reduce((sum, g) => sum + g.viewers, 0)
  for (const game of all) {
    game.chatShare = totalChat > 0 ? (game.chat / totalChat) * 100 : 0
    game.viewerShare = totalViewers > 0 ? (game.viewers / totalViewers) * 100 : 0
    game.rows.sort((a, b) => rate(b) - rate(a) || (b.viewers || 0) - (a.viewers || 0))
  }
  return { top: all.slice(0, limit), rest: all.slice(limit), all, counted: ok.length, noWindow: synced - ok.length, down: screenerDown(live), basis }
}

export function whereChatIsTip(games: HubWhereChatIs): string {
  const rest = games.rest.reduce((sum, g) => sum + g.chatShare, 0)
  // the recent average says what it is and why (candidate, 10-30)
  const lead = games.basis === 'avg_35'
    ? `The 5-minute counts did not load, so this is each game’s share of recent average chat messages per minute (each channel’s average over up to the last 35 minutes, minutes with data only, so it can cover much less), across the ${formatHubInt(games.counted)} synced channels with a chat average among the 500 biggest live channels we track`
      + (games.noWindow > 0 ? ` (${games.noWindow} more ${games.noWindow === 1 ? 'has' : 'have'} none)` : '')
    : `Each game’s share of chat messages per minute over the last 5 closed minutes, across the ${formatHubInt(games.counted)} channels with a full 5-minute window among the 500 biggest live channels we track`
      + (games.noWindow > 0 ? ` (${games.noWindow} more ${games.noWindow === 1 ? 'has' : 'have'} none yet)` : '')
  return lead
    + '. It is not a share of all of Twitch: Twitch has tens of thousands of live channels and no one counts chat on all of them, so a Twitch-wide figure would be a guess. The game is each channel’s current category. '
    + (games.rest.length ? `The other ${games.rest.length} games share ${rest.toFixed(1)}%. ` : '')
    + 'Click a game to list its channels below.'
}

export function gameAria(game: HubGameShare, pressed: boolean, basis: HubChatBasis = 'five_min'): string {
  const n = game.rows.length
  // the recent average says so, as on the Busiest tiles (candidate, 10-30)
  const avg = basis === 'avg_35' ? ' (recent average)' : ''
  return `${game.name}: ${game.chatShare.toFixed(1)}% of chat${avg}, ${n} ${n === 1 ? 'channel' : 'channels'}. ${pressed ? 'Show all channels again' : 'Show these channels in Channels'}`
}

/* ---------- Where chat is as a ranked rack (R5-22, mockup hub-rack.js) ---------- */

/** Rows the rack holds: eight under one share bar, at every width (9A, 11-22; it was 10, or 16 in two columns). */
export const HUB_RACK_ROWS = 8

/** "The other 12 games: 8.4% of chat" under the first `shown` rows. */
export function rackFoot(games: Pick<HubWhereChatIs, 'all'>, shown: number): string {
  const rest = games.all.slice(shown)
  const cs = rest.reduce((sum, g) => sum + g.chatShare, 0)
  return rest.length ? `The other ${rest.length} games: ${cs.toFixed(1)}% of chat` : 'Every game shown'
}

/** "GT" for "Grand Theft Auto V": the first letters of the first two words. */
export function gameInitials(name: string): string {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

/** Box art by category name, from the moments that carry vetted art (the hub sends none per live channel). */
export function hubCategoryArt(moments: readonly Pick<HubLivePulseMoment, 'category' | 'boxArtUrl' | 'categoryMetadataRejected'>[]): Map<string, string> {
  const art = new Map<string, string>()
  for (const m of moments) {
    if (m.category && m.boxArtUrl && !m.categoryMetadataRejected && !art.has(m.category)) art.set(m.category, m.boxArtUrl)
  }
  return art
}

/** Twitch box art at another size ("…-52x72.jpg" → "…-90x120.jpg"), so a 30 × 40 cover stays sharp. */
export function boxArtAt(url: string, w: number, h: number): string {
  return url.replace(/-\d+x\d+\.(jpe?g|png|webp)$/i, `-${w}x${h}.$1`)
}

/* ---------- Channels (R5-7) ---------- */

export type HubChannelSort = 'viewers' | 'chat' | 'vs'

export const HUB_CHANNEL_SORTS: ReadonlyArray<readonly [HubChannelSort, string]> = [
  ['viewers', 'Viewers'],
  ['chat', 'Chat/min'],
  ['vs', 'vs avg'],
]

const WHY: Record<string, string> = {
  baseline_warming: 'avg warming up',
  baseline_partial: 'avg has gaps',
  rollup_unavailable: 'no minute data',
  irc_unbound: 'IRC unbound',
  mismatch: 'numbers disagree',
  not_synced: 'viewers only',
  // the backend's own history read failed, or the row has no stream to read (fix, 10-30)
  history_query_unavailable: 'chat counts unavailable right now',
  history_store_unavailable: 'chat counts unavailable right now',
  missing_stream_identity: 'stream not matched yet',
  stream_identity_unavailable: 'stream not matched yet',
}

/** Reasons that say why a synced row has no 5-minute count at all (the rest are about its average). */
const NO_COUNT_REASONS = new Set(['history_query_unavailable', 'history_store_unavailable', 'missing_stream_identity', 'stream_identity_unavailable', 'rollup_unavailable', 'irc_unbound'])

/** Why Chat/min shows a dash: the row's own screener reason when it explains a missing count (fix, 10-30). */
export function channelChatWhy(c: HubLiveChannel): string {
  if (c.coverageState !== 'synced') return 'viewers only'
  const reason = screenerReason(c)
  return NO_COUNT_REASONS.has(reason) ? WHY[reason]! : 'no full 5 minutes yet'
}

function whyText(metric: Pick<HubScreenerMetric, 'state' | 'reason'> | null | undefined): string {
  if (metric?.reason && WHY[metric.reason]) return WHY[metric.reason]!
  if (metric?.state === 'warming') return WHY.baseline_warming!
  if (metric?.state === 'partial') return WHY.baseline_partial!
  return 'no comparison'
}

function baselineMinutes(c: HubLiveChannel): number | null {
  const s = c.screenerV1
  const minutes = s?.chat?.baselineMeasuredMinutes ?? s?.baselineMeasuredMinutes ?? s?.baselineWindow?.measuredMinutes
  return finite(minutes) ? minutes : null
}

/** Chat/min for the last 5 closed minutes, or null (no full window). 'avg_35': the row's recent average (up to 35 min) (candidate, 10-30). */
export function channelChat(c: HubLiveChannel, basis: HubChatBasis = 'five_min'): number | null {
  return countedOn(basis)(c) ? rateOn(basis)(c) : null
}

export type HubChannelVs = { x: number } | { why: string }

/**
 * "vs own avg": the backend chat multiplier, only when the screener and the
 * metric are ready (with prod's 5/min floor) and the average is built from at
 * least 10 measured minutes (Q4). Otherwise the plain reason.
 */
export function channelVs(c: HubLiveChannel, basis: HubChatBasis = 'five_min'): HubChannelVs {
  // a recent average has no 5-minute count to compare (candidate, 10-30)
  if (basis === 'avg_35') return { why: c.coverageState === 'synced' ? 'comparison unavailable right now' : 'viewers only' }
  const metric = c.screenerV1?.chat ?? null
  if (!hasFullChatWindow(c)) return { why: c.coverageState === 'synced' ? whyText(metric?.reason ? metric : { state: '', reason: 'rollup_unavailable' }) : 'viewers only' }
  const x = screenerMetricMultiplier(c.screenerV1, 'chat')
  const minutes = baselineMinutes(c)
  if (x == null || minutes == null || minutes < 10) return { why: whyText(metric) }
  return { x }
}

const vsValue = (c: HubLiveChannel, basis: HubChatBasis) => {
  const vs = channelVs(c, basis)
  return 'x' in vs ? vs.x : null
}

const SORT_VALUE: Record<HubChannelSort, (c: HubLiveChannel, basis: HubChatBasis) => number | null> = {
  viewers: (c) => (finite(c.viewers) ? c.viewers : null),
  chat: channelChat,
  vs: vsValue,
}

export interface HubChannelQuery {
  q: string
  game: string | null
  sort: HubChannelSort
  /** -1 descending, 1 ascending. */
  dir: 1 | -1
  /** 'avg_35': Chat/min is the row's recent average (up to 35 min) (candidate, 10-30). */
  basis?: HubChatBasis
}

export function channelRows(live: readonly HubLiveChannel[], query: HubChannelQuery): HubLiveChannel[] {
  const basis = query.basis ?? 'five_min'
  let rows = live.slice()
  // A game lists the same chat-counted rows its share counts.
  if (query.game) rows = rows.filter((c) => countedOn(basis)(c) && gameOf(c) === query.game)
  const t = query.q.trim().toLowerCase()
  if (t) rows = rows.filter((c) => nameOf(c).toLowerCase().includes(t) || c.login.includes(t) || (c.category || '').toLowerCase().includes(t))
  const value = SORT_VALUE[query.sort]
  const get = (c: HubLiveChannel) => value(c, basis)
  rows.sort((a, b) => {
    const va = get(a)
    const vb = get(b)
    if (va == null && vb == null) return (b.viewers || 0) - (a.viewers || 0)
    if (va == null) return 1
    if (vb == null) return -1
    return (va - vb) * query.dir || (b.viewers || 0) - (a.viewers || 0)
  })
  return rows
}

export function channelsTip(liveCount: number, poolSize: number, basis: HubChatBasis = 'five_min'): string {
  // the recent average says what it is and why (candidate, 10-30)
  if (basis === 'avg_35') {
    return `Every channel in the live pool (${formatHubInt(liveCount)} of the ~${formatHubInt(poolSize)} we track). The 5-minute counts did not load, so Chat/min is each channel’s recent average: up to the last 35 minutes, counting only minutes with data and the current unfinished minute, so it can cover much less. vs avg has nothing to compare. `
      + 'A dash means not measured: viewers-only channels have no chat count. Click a channel to open its stream page.'
  }
  return `Every channel in the live pool (${formatHubInt(liveCount)} of the ~${formatHubInt(poolSize)} we track). Chat/min is the last 5 closed minutes. `
    + 'vs avg compares those 5 minutes with the stream’s own measured average so far, shown only when that average is ready and built from at least 10 measured minutes. '
    + 'A dash means not measured: viewers-only channels have no chat count, and young streams have no average yet. Click a channel to open its stream page.'
}

/* ---------- Moments (R5-2) ---------- */

const REASONS: Record<string, string> = { chat_spike: 'Chat spike', viewer_spike: 'Viewer spike', game_change: 'Game change', manual: 'Moment' }
const isEmoteSpike = (code: string) => /^(emote|seventv|twitch_emote|twitch|ffz|bttv)_spike$/.test(code) || (code.includes('emote') && code.includes('spike'))

/** The detector's reason in prod Moments wording ("Emote spike", "Chat spike"). */
export function momentReasonLabel(kind: string | undefined, label: string | undefined): string {
  const raw = String(kind ?? '').trim().toLowerCase()
  const code = raw === 'chat' ? 'chat_spike' : raw && !raw.endsWith('_spike') && !REASONS[raw] ? `${raw}_spike` : raw
  const text = String(label ?? '').trim()
  if (isEmoteSpike(code) || /emote spike/i.test(text)) return 'Emote spike'
  return code ? REASONS[code] || code.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) : text || 'Moment'
}

/** A minute whose named emotes cover under 25% of its uses names no top emote. */
export const HUB_NAMED_EMOTE_MIN_PCT = 25

export type HubMomentCmp =
  /** `over`: what the × compares with when it isn't the stream's own average (the Moments list: "the 15 minutes before"). */
  | { x: number; avg: number | null; mins: number; over?: string }
  | { why: string; long: string }

export interface HubMomentRowV5 {
  moment: HubLivePulseMoment
  key: string
  login: string
  displayName: string
  label: string
  series: 'chat' | 'emotes'
  rate: number | null
  /** The top emote to name, or null when the named share is under 25%. */
  topEmote: HubEmote | null
  topEmoteName: string | null
  cmp: HubMomentCmp
  href: string
  at: number | null
}

function momentCmp(m: HubLivePulseMoment, series: 'chat' | 'emotes'): HubMomentCmp {
  const comparison = m.comparison
  const metric = comparison?.[series] as LiveWireMetricComparison | undefined
  const mins = metric?.baselineMeasuredMinutes ?? comparison?.baselineWindow?.measuredMinutes
  const rate = series === 'chat' ? m.chatPerMin : m.emotesPerMin
  const live = Math.max(1, Math.round((m.offsetSeconds || 0) / 60))
  if (metric && metric.state === 'ready' && finite(mins) && mins >= 10 && finite(metric.multiplier) && finite(metric.currentPerMin)) {
    if (!finite(rate) || Math.abs(metric.currentPerMin - rate) > 0.01) {
      return { why: 'not compared', long: 'Not compared: two counts for this minute disagree, so its multiplier is held back.' }
    }
    return { x: metric.multiplier, avg: finite(metric.baselinePerMin) ? metric.baselinePerMin : null, mins: Math.round(mins) }
  }
  if (metric?.state === 'warming' || metric?.reason === 'baseline_warming') return { why: 'new stream', long: `Too early to compare: the stream had been live about ${live} min, too soon for its own average.` }
  if (metric?.state === 'partial' || metric?.reason === 'baseline_partial') return { why: 'avg has gaps', long: 'Not compared: the stream’s average before this minute has gaps.' }
  return { why: 'no avg', long: 'No comparison came with this moment.' }
}

/**
 * The Moment's own page for the minute that holds `at` when the build has the page; else the
 * Analytics → Moments deep link (login, stream, whole-second offset).
 */
export function momentHref(m: Pick<HubLivePulseMoment, 'login' | 'streamId' | 'offsetSeconds' | 'at'>): string {
  const page = momentPageHref({ streamId: m.streamId ?? '', at: m.at })
  if (page) return page
  const query = new URLSearchParams({ login: m.login ?? '', stream: m.streamId ?? '', offset: String(Math.max(0, Math.floor(m.offsetSeconds || 0))) })
  return `/analytics/moments?${query}`
}

export function momentRowKey(m: HubLivePulseMoment): string {
  return `${m.login ?? ''}|${m.streamId ?? ''}|${m.at ?? ''}|${m.offsetSeconds ?? ''}`
}

/** Newest first. Rows without a channel are left out. */
export function momentRowsV5(moments: readonly HubLivePulseMoment[]): HubMomentRowV5[] {
  return moments
    .filter((m) => m && typeof m.login === 'string' && m.login)
    .slice()
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .map((m) => {
      const label = momentReasonLabel(m.kind, m.label)
      const series = label === 'Chat spike' ? 'chat' : 'emotes'
      const emotes = m.topEmotes ?? []
      const named = finite(m.emotesPerMin) && m.emotesPerMin > 0 ? (emotes.reduce((sum, e) => sum + (e.count || 0), 0) / m.emotesPerMin) * 100 : null
      const tok = emotes.find((e) => e.name === m.topEmoteCode) ?? emotes[0] ?? null
      const namedOk = named != null && named >= HUB_NAMED_EMOTE_MIN_PCT
      const rate = series === 'chat' ? m.chatPerMin : m.emotesPerMin
      return {
        moment: m,
        key: momentRowKey(m),
        login: m.login!,
        displayName: m.displayName || m.login!,
        label,
        series,
        rate: finite(rate) ? rate : null,
        topEmote: namedOk ? tok : null,
        topEmoteName: namedOk ? m.topEmoteCode || tok?.name || null : null,
        cmp: momentCmp(m, series),
        href: momentHref(m),
        at: finite(m.at) ? m.at : null,
      }
    })
}

export function momentRowAria(row: HubMomentRowV5): string {
  const metric = row.series === 'chat' ? 'chat' : 'emotes'
  const when = row.at != null ? ` at ${hubClock(row.at)}` : ''
  const fig = 'x' in row.cmp ? `${metric} ${multiplierWords(row.cmp.x)} times its own average` : row.cmp.why
  return `${row.displayName}, ${row.moment.category || 'game not sent'}, ${row.label.toLowerCase()}${when}, ${fig}. Opens in Moments.`
}

export function momentsTip(count: number): string {
  return `One-minute spikes the detector found on live streams. The hub sends its ${count} highest-scoring from the 12 chattiest live channels; newest first. `
    + 'The figure compares that minute with the stream’s own average before it: emotes for an emote spike, chat for a chat spike. It shows only when the backend sends a ready comparison; '
    + '‘new stream’ means the stream was too young for an average. The game is the category sent with the moment. Hover a moment for its numbers; click to open it in Moments.'
}

/* ---------- Top emotes (R5-5, the round-5 list) ---------- */

export interface HubTopEmoteRow {
  emote: HubEmote
  share: string
  /** Bar width against the top emote, percent (at least 2). */
  width: number
}

export function topEmoteRows(topEmotes: readonly HubEmote[], limit = 10): HubTopEmoteRow[] {
  const list = topEmotes.filter((e) => e && typeof e.name === 'string' && finite(e.sharePct)).slice(0, limit)
  const first = list[0]?.sharePct ?? 0
  return list.map((emote) => ({
    emote,
    share: `${emote.sharePct.toFixed(1)}%`,
    width: Math.max(2, first > 0 ? (emote.sharePct / first) * 100 : 2),
  }))
}

/** "≈35 min" when the backend stamps the window, else "recent window". */
export function topEmotesWindowLabel(windowMinutes: number | undefined): string {
  return finite(windowMinutes) && windowMinutes > 0 ? `≈${Math.round(windowMinutes)} min` : 'recent window'
}

export function topEmotesTip(rows: readonly HubTopEmoteRow[], uniqueEmotes: number | undefined, windowMinutes: number | undefined): string {
  if (!rows.length) return 'Share of named emote uses in the recent window.'
  const first = rows[0]!.emote
  const sum = rows.reduce((total, r) => total + r.emote.sharePct, 0)
  const total = first.sharePct > 0 ? Math.round(first.count / (first.sharePct / 100) / 100) * 100 : null
  const window = finite(windowMinutes) && windowMinutes > 0 ? `the last ${Math.round(windowMinutes)} minutes` : 'the recent window (the server does not stamp it)'
  return `Share of named emote uses in ${window}. Each bar is measured against the top emote. `
    + `Together these ${rows.length} are ${sum.toFixed(1)}%`
    + (total != null ? ` of about ${total.toLocaleString('en-US')} named emote uses` : '')
    + (finite(uniqueEmotes) ? `, out of ${formatHubInt(uniqueEmotes)} different emotes.` : '.')
}

/* ---------- search (R5-12 / R5-14) ---------- */

/** What the field holds as a login: lowercase, no @, no twitch.tv/ prefix or trailing path. */
export function typedLogin(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '').replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//, '').replace(/[/?#].*$/, '')
}

export function channelsByViewers(live: readonly HubLiveChannel[]): HubLiveChannel[] {
  return live.slice().sort((a, b) => (b.viewers || 0) - (a.viewers || 0))
}

export interface HubSearchResult {
  heading: string | null
  channels: HubLiveChannel[]
  /** A plausible login no live row matches: "Open analytics for <login>". */
  openLogin: string | null
  empty: boolean
}

export function searchChannels(byViewers: readonly HubLiveChannel[], raw: string, limit = 6): HubSearchResult {
  const t = typedLogin(raw)
  const channels = (t ? byViewers.filter((c) => nameOf(c).toLowerCase().includes(t) || c.login.includes(t)) : byViewers).slice(0, limit)
  const openLogin = t && isPlausibleTwitchLogin(t) && !channels.some((c) => c.login === t) ? t : null
  return {
    heading: channels.length ? (t ? 'Live now' : 'Busiest live channels') : null,
    channels,
    openLogin,
    empty: Boolean(t) && !channels.length && !openLogin,
  }
}

/** A game the box offers (3A, 11-02): `n` is the channels its Channels filter lists, the chat-counted ones Where chat is counts. */
export interface HubSearchGame {
  name: string
  n: number
  art?: string
}

/** An emote the box offers: one the hub's intervals counted, so the map has its tile. */
export interface HubSearchEmote {
  name: string
  provider?: string
  imageUrl?: string
  uses: number
}

/** Every game a live channel is counted in, busiest first: the games the hub's game filter can list. */
export function hubSearchGames(games: Pick<HubWhereChatIs, 'all'>, art?: ReadonlyMap<string, string>): HubSearchGame[] {
  return games.all
    .filter((g) => g.name !== HUB_NO_CATEGORY && g.rows.length > 0)
    .map((g) => ({ name: g.name, n: g.rows.length, art: art?.get(g.name) }))
}

/** The emotes in the hub's interval top 10s, most used first, one row per provider and name. */
export function hubSearchEmotes(points: readonly Pick<HubActivityPoint, 'topEmotes'>[]): HubSearchEmote[] {
  const byKey = new Map<string, HubSearchEmote>()
  for (const p of points) {
    for (const e of p.topEmotes ?? []) {
      if (!e?.name || !finite(e.count) || e.count <= 0) continue
      const key = `${e.provider || ''}|${e.name}`
      const row = byKey.get(key)
      if (row) row.uses += e.count
      else byKey.set(key, { name: e.name, provider: e.provider, imageUrl: e.imageUrl, uses: e.count })
    }
  }
  return [...byKey.values()].sort((a, b) => b.uses - a.uses)
}

/** Name matches from 2 letters: the whole name first, then names that start with it, then the rest; the bigger first within each. */
function matchByName<T extends { name: string }>(rows: readonly T[], raw: string, size: (row: T) => number, limit: number): T[] {
  const exact = raw.trim()
  const t = exact.toLowerCase()
  if (t.length < 2) return []
  // the spelling as typed first: emote names are case sensitive ("KEKW", "kekw")
  const rank = (name: string) => (name === exact ? 0 : name.toLowerCase() === t ? 1 : name.toLowerCase().startsWith(t) ? 2 : name.toLowerCase().includes(t) ? 3 : 4)
  return rows
    .map((row) => ({ row, r: rank(row.name) }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || size(b.row) - size(a.row))
    .slice(0, limit)
    .map((x) => x.row)
}

export function searchGames(games: readonly HubSearchGame[], raw: string, limit = 3): HubSearchGame[] {
  return matchByName(games, raw, (g) => g.n, limit)
}

export function searchEmotes(emotes: readonly HubSearchEmote[], raw: string, limit = 3): HubSearchEmote[] {
  return matchByName(emotes, raw, (e) => e.uses, limit)
}

/** "/analytics?game=VALORANT": the hub with its game filter set. */
export function hubGameHref(name: string): string {
  return `/analytics?game=${encodeURIComponent(name)}`
}

/** "/analytics?emote=KEKW": the hub, its Top emotes map finding the emote. */
export function hubEmoteHref(name: string): string {
  return `/analytics?emote=${encodeURIComponent(name)}`
}

/* ---------- How this is measured ---------- */

export interface HubMeasuredFacts {
  poolSize: number
  lowerBoundBuckets: number
  buckets: number
  roster: number | null
}

export function measuredFacts(hub: Pick<PublicHub, 'poolSize' | 'activity'>): HubMeasuredFacts {
  const points: readonly HubActivityPoint[] = hub.activity.points ?? []
  const roster = points.find((p) => finite(p.viewerExpectedContributors))?.viewerExpectedContributors
  return {
    poolSize: hub.poolSize,
    lowerBoundBuckets: points.filter((p) => p.providerCountsLowerBound === true).length,
    buckets: points.length,
    roster: finite(roster) ? roster : null,
  }
}
