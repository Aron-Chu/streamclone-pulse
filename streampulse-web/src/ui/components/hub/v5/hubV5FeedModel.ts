/**
 * Live feed v3 (mockup d3-v5 hub-live.js, the default since 2026-10-17): the
 * hour before the hub's last poll, newest first, one row per channel. Pure
 * functions over the hub payload; every time and figure is one the backend
 * sent, nothing is estimated.
 *
 * - Chat spikes: the pool wire's chat/emote spikes, kept only when the
 *   channel's screener says the same 5 minutes ran at least 1.5× its own
 *   average, at least 30 a minute and 20 more than usual.
 * - Moments: the detector's moments from the hour at 1.5× usual or more; none
 *   from a stream's first 20 minutes, none the backend's comparison puts
 *   under 1.2×.
 * - Went live: every stream that started in the hour. 5,000+ viewers get a
 *   row; the smaller ones share one.
 * - Picking up: chat 1.5×+ usual with the same floors, ranked by how many
 *   more messages a minute.
 *
 * With the Moments list (L1, 10-21: where /analytics/moments is the checked
 * page), the moment rows are that list's: the same moments, the same × and the
 * server's checks, nothing scored here. Spikes, went live and Picking up still
 * come from the hub. A quiet hour shows the day's top moments under it.
 *
 * Without the list (E1 candidate, 10-30), the hub's other moments sit under the
 * hour as "earlier": the strongest peaks so far on streams live now, newest
 * first, under the same rules as the hour's.
 */
import type { HubEmote, HubLiveChannel, HubLivePulseMoment, HubMoment, PublicHub } from '../../../../lib/publicHub'
import { screenerMetricMultiplier, type HubScreenerMetricKey } from '../../../../lib/channelScreenerContract'
import type { MomentsFeedItem } from '../../../../lib/momentsFeed'
import { avatarImage, boxArtImage, checkMoment, emoteImage, fx, sameDay, type CheckedMoment } from '../../../../lib/momentsChecked'
import {
  channelHref,
  formatHubInt,
  formatHubMultiplier,
  hasFullChatWindow,
  hubCategoryArt,
  hubClock,
  hubClockRange,
  momentRowsV5,
  multiplierWords,
  type HubMomentRowV5,
} from './hubV5Model'

export const FEED_UP_MIN = 1.5
export const FEED_KEEP_MIN = 1.2
export const FEED_WINDOW_MS = 60 * 60_000
export const FEED_OLD_MS = 30 * 60_000
export const FEED_QUIET_MS = 15 * 60_000
export const FEED_START_MIN = 20
export const FEED_NOW_MIN = 30
export const FEED_ADD_MIN = 20
export const FEED_BIG_VIEWERS = 5000
export const FEED_UP_LIST = 5
export const FEED_LIVES_LIST = 10
export const FEED_SPAM_USES = 20
export const FEED_SPAM_SHARE = 0.25
/** The dot greys, and the quiet line names its hour, once the data is older than this. */
export const FEED_STALE_MS = 3 * 60_000

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const lo = (s: string | undefined | null) => String(s ?? '').toLowerCase()

interface GateMetric {
  state?: string
  multiplier?: number | null
  baselineMeasuredMinutes?: number | null
}
/** The comparison gate (Q4): ready, at least 10 measured minutes behind it, and a number. */
function q4(m: GateMetric | null | undefined): m is GateMetric & { multiplier: number } {
  return !!m && m.state === 'ready' && finite(m.baselineMeasuredMinutes) && m.baselineMeasuredMinutes >= 10 && finite(m.multiplier)
}

/** A channel whose last 5 minutes of `ser` ran 1.5×+ its own average, 30+ a minute and 20+ more than usual. */
export function screenerHot(c: HubLiveChannel | null | undefined, ser: HubScreenerMetricKey): boolean {
  const s = c?.screenerV1?.[ser]
  return !!c && !!s && hasFullChatWindow(c) && q4(s) && screenerMetricMultiplier(c.screenerV1, ser) != null
    && s.multiplier! >= FEED_UP_MIN && s.currentPerMin >= FEED_NOW_MIN && finite(s.absoluteDeltaPerMin) && s.absoluteDeltaPerMin >= FEED_ADD_MIN
}

/**
 * When the stream started: Twitch's start time when sent, else the pool wire's
 * went-live event (its time is the stream's start), else the start of its own
 * average (the stream's start, or up to 5 minutes early on a new stream).
 */
export function liveStartOf(c: HubLiveChannel, attachAt?: number | null): number | null {
  const t = c.startedAt ? Date.parse(c.startedAt) : Number.NaN
  if (Number.isFinite(t)) return t
  if (finite(attachAt)) return attachAt
  const s = c.screenerV1?.baselineWindow?.start
  return finite(s) ? s : null
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

/** A row's time on the right (games first, 10-22): "now", "13m", "2h". */
export function feedShort(at: number, nowMs: number): string {
  const m = Math.max(0, Math.floor((nowMs - at) / 60_000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`
}

/** The × as the backend sent it, whole from 10 up ("50×"), so a 50× flood never reads as 10× (E1 candidate, 10-30). */
export const feedMultiplier = (x: number) => (x >= 10 ? `${Math.round(x)}×` : formatHubMultiplier(x))
/** Screen-reader words for feedMultiplier: the same whole number at 10 and up, never "at least 10" beside a printed 50×. */
export const feedMultiplierWords = (x: number) => (x >= 10 ? formatHubInt(Math.round(x)) : multiplierWords(x))
export const feedMore = (n: number) => formatHubInt(Math.round(n))

interface FeedBase {
  at: number
  key: string
  login: string
  name: string
  cat: string | null
  streamId: string
  avatar: string | null
}
export interface FeedSpike extends FeedBase {
  kind: 'spike'
  ser: HubScreenerMetricKey
  x: number
  add: number
}
export interface FeedAct {
  /** "chat burst", "emote burst", "spammed", … */
  word: string
  /** "spammed X": the emote that led its minute. */
  emote: HubEmote | null
  /** The multiplier that matches the word. */
  x: number | null
}
export interface FeedMoment extends FeedBase {
  kind: 'moment'
  row: HubMomentRowV5
  act: FeedAct
  x: number | null
  /** Messages (or emotes) a minute over usual, when the word's number is the moment's own. */
  add: number | null
  /** From the Moments list: its × is written as that page writes it, and `why` stands in when it sends none. */
  list?: true
  why?: string
  /** Other channels that counted the same emotes in the same minute, folded into this row. */
  also?: string[]
  /** Those channels' own moments, so a picked game can show its channel's row (feedForGame). */
  folded?: FeedMoment[]
}
export interface FeedLive extends FeedBase {
  kind: 'live'
  viewers: number | null
  chat: number | null
  small: boolean
  /** The pool wire saw chat jump, but the stream is too new for its own average. */
  jump: boolean
}
export type FeedEvent = FeedSpike | FeedMoment | FeedLive

export interface FeedUpRow {
  login: string
  name: string
  cat: string | null
  streamId: string
  avatar: string | null
  x: number
  add: number
}

export type FeedItem =
  | { key: string; at: number; old: boolean; group: FeedEvent[] }
  | { key: 'lives'; at: number; old: boolean; lives: FeedLive[] }

export interface FeedLeftOut {
  spikeUnder: string[]
  spikeNew: string[]
  momStart: number
  momUnder: string[]
  momNoNum: number
}

export interface LiveFeedModel {
  /** The last poll (the hub's generatedAt, or the Moments list's when newer). Null before the first reply. */
  asOf: number | null
  /** In the hour, newest first. */
  events: FeedEvent[]
  items: FeedItem[]
  /** The day's top moments from before the hour, for a quiet hour: by ×, one a channel, none from a channel in the hour. */
  top: FeedItem[]
  /** Without the list: the hub's moments from before the hour (streams live now), newest first, same-minute twins folded. */
  earlier: FeedItem[]
  /** Live channels whose chat vs usual came with this update; 0 means spikes and Picking up could not be checked. */
  screenerReady: number
  /** Live channels in this update. */
  channels: number
  /** The moment rows are the Moments list's. */
  list: boolean
  up: FeedUpRow[]
  /** The 5-minute window most Picking up channels share, as sent ("4:20–4:25 PM"). */
  upWindow: string
  /** Box art by category, from the moments that carry it. */
  art: ReadonlyMap<string, string>
  left: FeedLeftOut
  spikeSeen: number
  liveCount: number
}

export type LiveFeedInput = Pick<PublicHub, 'generatedAt' | 'liveChannels' | 'moments' | 'livePulseMoments'>

/** The Moments list's newest page (/v1/public/moments), as the Moments page reads it. */
export interface FeedMomentsList {
  items: readonly MomentsFeedItem[]
  generatedAt: number
}

const EMPTY_LEFT: FeedLeftOut = { spikeUnder: [], spikeNew: [], momStart: 0, momUnder: [], momNoNum: 0 }

function momentAct(row: HubMomentRowV5): FeedAct {
  const m = row.moment
  const kx = 'x' in row.cmp ? row.cmp.x : null
  const chat = m.comparison?.chat
  const chatX = q4(chat) ? chat.multiplier : null
  const lead = (m.topEmotes ?? []).slice().sort((a, b) => (b.count || 0) - (a.count || 0))[0] ?? null
  const share = lead && finite(m.emotesPerMin) && m.emotesPerMin > 0 ? (lead.count || 0) / m.emotesPerMin : 0
  // an emote spike whose emotes did not rise but whose chat did is a chat burst
  if (row.label === 'Emote spike' && kx != null && kx < FEED_UP_MIN && chatX != null && chatX >= FEED_UP_MIN) return { word: 'chat burst', emote: null, x: chatX }
  // "spammed X" only when X led its minute: 20+ uses and a quarter of the minute's emotes
  if (row.label === 'Emote spike' && lead && lead.count >= FEED_SPAM_USES && share >= FEED_SPAM_SHARE) return { word: 'spammed', emote: lead, x: kx }
  const word = row.label === 'Chat spike' ? 'chat burst' : row.label === 'Emote spike' ? 'emote burst' : row.label.toLowerCase()
  return { word, emote: null, x: kx }
}

/**
 * A Moments-list moment as a feed row. Every figure is the item's: its label,
 * the row × the Moments page shows (only for a moment that holds up and rose),
 * and its 15-minute baseline for the card; the link opens the same moment there.
 */
function listMoment(m: CheckedMoment, live: ReadonlyMap<string, HubLiveChannel>): FeedMoment {
  const item = m.item
  const login = lo(item.login)
  const series = m.kind
  const label = series === 'chat' ? 'Chat spike' : 'Emote spike'
  const lead = item.topEmotes[0]
  const emote: HubEmote | null = lead ? { name: lead.name, imageUrl: emoteImage(lead), count: lead.count, sharePct: 0, provider: lead.provider, zeroWidth: lead.zeroWidth, animated: lead.animated } : null
  const avatar = avatarImage(item) ?? live.get(login)?.profileImageUrl ?? null
  const moment: HubLivePulseMoment = {
    offsetSeconds: item.offsetSeconds, score: item.score, label, kind: series === 'chat' ? 'chat_spike' : 'emote_spike',
    chatPerMin: item.chat.perMin ?? undefined, emotesPerMin: item.emotes.perMin ?? undefined, viewers: item.viewers,
    topEmotes: emote ? [emote] : [], login, displayName: m.name, profileImageUrl: avatar ?? undefined, streamId: item.streamId,
    at: item.minuteStart, category: item.category?.name, categoryId: item.category?.id, boxArtUrl: boxArtImage(item),
  }
  const rate = item[series].perMin
  const avg = item[series].baselinePerMin
  const worst = m.checks.find((c) => c.lv === item.verdict && c.short)
  const row: HubMomentRowV5 = {
    moment, key: item.id, login, displayName: m.name, label, series, rate,
    topEmote: series === 'emotes' ? emote : null,
    topEmoteName: series === 'emotes' ? emote?.name ?? null : null,
    cmp: m.rowX != null
      ? { x: m.rowX, avg, mins: item.baselineMeasuredMinutes ?? 15, over: 'the 15 minutes before' }
      : { why: m.why || 'not compared', long: worst?.long ?? 'No × came with this moment.' },
    href: `/analytics/moments?${new URLSearchParams({ m: item.id })}`,
    at: item.minuteStart,
  }
  const spammed = series === 'emotes' && item.label.spammed && emote
  return {
    kind: 'moment', at: item.minuteStart, key: `m:${item.id}`, login, name: m.name, cat: item.category?.name || null,
    streamId: item.streamId, avatar, row,
    act: spammed ? { word: 'spammed', emote, x: m.rowX } : { word: series === 'chat' ? 'chat burst' : 'emote burst', emote: null, x: m.rowX },
    x: m.rowX, add: m.rowX != null && rate != null && avg != null ? rate - avg : null,
    list: true, why: m.rowX == null ? m.why || undefined : undefined,
  }
}

/** What a moment row's × counts (X1, 10-22): its series, or chat when an emote spike's chat burst carries chat's ×. */
export function feedMomentSer(e: FeedMoment): 'chat' | 'emotes' {
  return e.act.word === 'chat burst' ? 'chat' : e.row.series
}

/** The event's words for "+N earlier" and the aria label. */
export function feedWord(e: FeedEvent): string {
  if (e.kind === 'live') return 'went live'
  if (e.kind === 'spike') return e.ser === 'chat' ? 'chat spike' : 'emote spike'
  return e.act.emote ? e.act.emote.name : e.act.word
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

/** A hub moment as a row under the hour's rules (not in a stream's first 20 minutes, a ready × of 1.5+), else null. */
function hubMoment(row: HubMomentRowV5, live: ReadonlyMap<string, HubLiveChannel>): FeedMoment | null {
  const m = row.moment
  const raw = m.comparison?.[row.series]
  const rx = raw && raw.state === 'ready' && finite(raw.multiplier) ? raw.multiplier : null
  const kx = 'x' in row.cmp ? row.cmp.x : null
  if (!finite(row.at)) return null
  if ((m.offsetSeconds || 0) / 60 < FEED_START_MIN) return null
  if ((kx != null && kx < FEED_KEEP_MIN) || (rx != null && rx < FEED_KEEP_MIN)) return null
  if (!(kx != null && kx >= FEED_UP_MIN)) return null
  const act = momentAct(row)
  const avg = 'x' in row.cmp ? row.cmp.avg : null
  const login = lo(row.login)
  return {
    kind: 'moment', at: row.at, key: `m:${row.key}`, login, name: row.displayName, cat: m.category || null,
    streamId: m.streamId || live.get(login)?.streamId || '', avatar: m.profileImageUrl || live.get(login)?.profileImageUrl || null,
    row, act, x: act.x ?? kx, add: act.x === kx && avg != null && row.rate != null ? row.rate - avg : null,
  }
}

export function liveFeedModel(hub: LiveFeedInput | null | undefined, list: FeedMomentsList | null = null): LiveFeedModel {
  const hubAt = hub ? Date.parse(hub.generatedAt) : Number.NaN
  const asOf = list && finite(list.generatedAt) ? Math.max(hubAt, list.generatedAt) : hubAt
  const art = hubCategoryArt(hub?.livePulseMoments ?? [])
  if (!hub || !Number.isFinite(asOf)) {
    return { asOf: null, events: [], items: [], top: [], earlier: [], screenerReady: 0, channels: 0, list: false, up: [], upWindow: '', art, left: EMPTY_LEFT, spikeSeen: 0, liveCount: 0 }
  }
  for (const item of list?.items ?? []) {
    const boxArt = boxArtImage(item)
    if (boxArt && item.category && !art.has(item.category.name)) art.set(item.category.name, boxArt)
  }
  const inHour = (t: number | null | undefined): t is number => finite(t) && t <= asOf && asOf - t <= FEED_WINDOW_MS
  const live = new Map(hub.liveChannels.map((c) => [lo(c.login), c]))
  const left: FeedLeftOut = { spikeUnder: [], spikeNew: [], momStart: 0, momUnder: [], momNoNum: 0 }

  // Went live: every stream that started in the hour
  const attach = new Map<string, number>()
  for (const m of hub.moments ?? []) if (m.kind === 'live_attach' && m.login && finite(m.at)) attach.set(lo(m.login), m.at)
  const lives: FeedLive[] = []
  for (const c of hub.liveChannels) {
    const at = liveStartOf(c, attach.get(lo(c.login)))
    if (!inHour(at)) continue
    lives.push({
      kind: 'live', at, key: `l:${lo(c.login)}`, login: lo(c.login), name: c.displayName || c.login, cat: c.category || null,
      streamId: c.streamId || '', avatar: c.profileImageUrl || null,
      viewers: finite(c.viewers) ? c.viewers : null,
      chat: hasFullChatWindow(c) && finite(c.chatPerMin) ? c.chatPerMin : null,
      small: !(c.viewers >= FEED_BIG_VIEWERS), jump: false,
    })
  }

  // Chat spikes: the pool wire's, kept only when the screener agrees
  const spikes: FeedSpike[] = []
  const wire = (hub.moments ?? []).filter((m: HubMoment) => /^(chat|emote)_spike$/.test(m.kind) && m.login)
  for (const m of wire) {
    const login = lo(m.login)
    const c = live.get(login)
    const ser: HubScreenerMetricKey = m.kind === 'chat_spike' ? 'chat' : 'emotes'
    const s = c?.screenerV1?.[ser]
    const name = m.displayName || m.login || login
    if (c && s && screenerHot(c, ser)) {
      if (!inHour(m.at) || spikes.some((x) => x.login === login)) continue
      spikes.push({ kind: 'spike', at: m.at, key: `k:${login}`, login, name, cat: m.detail || c.category || null, streamId: c.streamId || m.streamId || '', avatar: c.profileImageUrl || null, ser, x: s.multiplier!, add: s.absoluteDeltaPerMin! })
      continue
    }
    const lv = lives.find((e) => e.login === login)
    if (lv && !q4(s)) {
      lv.jump = true // too new for its own average: its went-live row says so
      left.spikeNew.push(name)
    } else {
      left.spikeUnder.push(name + (s && finite(s.multiplier) ? ` ${formatHubMultiplier(s.multiplier)}` : ', not compared'))
    }
  }

  // Moments: the Moments list's from the hour (those that hold up or partly do, as its Latest shows them);
  // without the list, the hub's own from the hour at 1.5×+ usual
  const moments: FeedMoment[] = []
  for (const item of list?.items ?? []) {
    if (item.verdict !== 'bad' && inHour(item.minuteStart)) moments.push(listMoment(checkMoment(item, asOf), live))
  }
  const before: FeedMoment[] = []
  for (const row of list ? [] : momentRowsV5(hub.livePulseMoments ?? [])) {
    const m = row.moment
    if (!inHour(row.at)) {
      const e = finite(row.at) && row.at < asOf ? hubMoment(row, live) : null
      if (e) before.push(e)
      continue
    }
    const raw = m.comparison?.[row.series]
    const rx = raw && raw.state === 'ready' && finite(raw.multiplier) ? raw.multiplier : null
    const kx = 'x' in row.cmp ? row.cmp.x : null
    if ((m.offsetSeconds || 0) / 60 < FEED_START_MIN) { left.momStart += 1; continue }
    if ((kx != null && kx < FEED_KEEP_MIN) || (rx != null && rx < FEED_KEEP_MIN)) {
      left.momUnder.push(`${row.displayName} ${hubClock(row.at)}, ${formatHubMultiplier((kx ?? rx)!)}`)
      continue
    }
    if (!(kx != null && kx >= FEED_UP_MIN)) { left.momNoNum += 1; continue }
    const act = momentAct(row)
    const avg = 'x' in row.cmp ? row.cmp.avg : null
    const add = act.x === kx && avg != null && row.rate != null ? row.rate - avg : null
    const login = lo(row.login)
    moments.push({
      kind: 'moment', at: row.at, key: `m:${row.key}`, login, name: row.displayName, cat: m.category || null,
      streamId: m.streamId || live.get(login)?.streamId || '', avatar: m.profileImageUrl || live.get(login)?.profileImageUrl || null,
      row, act, x: act.x ?? kx, add,
    })
  }

  const events: FeedEvent[] = [...moments, ...spikes, ...lives].sort((a, b) => b.at - a.at)

  // Earlier (E1): the hub's moments from before the hour, newest first; a minute two channels counted the same emotes in is one row
  const earlier: FeedItem[] = []
  const twins = new Map<string, FeedMoment>()
  for (const e of before.sort((a, b) => b.at - a.at || (b.x ?? 0) - (a.x ?? 0))) {
    const emotes = (e.row.moment.topEmotes ?? []).map((t) => `${t.name}:${t.count}`).join('|')
    const k = `${Math.floor(e.at / 60_000)}|${emotes}`
    const twin = emotes ? twins.get(k) : undefined
    if (twin) {
      if (twin.login !== e.login && !twin.also?.includes(e.name)) {
        twin.also = [...(twin.also ?? []), e.name]
        twin.folded = [...(twin.folded ?? []), e]
      }
      continue
    }
    if (emotes) twins.set(k, e)
    earlier.push({ key: `e:${e.key}`, at: e.at, old: true, group: [e] })
  }
  const screenerReady = hub.liveChannels.filter((c) => hasFullChatWindow(c) && c.screenerV1?.chat?.state === 'ready').length

  // Picking up: chat 1.5×+ usual with the same floors, not counting channels with a spike row
  const spiked = new Set(spikes.map((e) => e.login))
  const hotChat = hub.liveChannels.filter((c) => screenerHot(c, 'chat') && !spiked.has(lo(c.login)))
    .sort((a, b) => b.screenerV1!.chat!.absoluteDeltaPerMin! - a.screenerV1!.chat!.absoluteDeltaPerMin!)
  const up: FeedUpRow[] = hotChat.map((c) => ({
    login: lo(c.login), name: c.displayName || c.login, cat: c.category || null, streamId: c.streamId || '', avatar: c.profileImageUrl || null,
    x: c.screenerV1!.chat!.multiplier!, add: c.screenerV1!.chat!.absoluteDeltaPerMin!,
  }))

  // one row per channel (its newest event leads); the smaller starts share one row, placed at the newest of them
  const small = events.filter((e): e is FeedLive => e.kind === 'live' && e.small)
  const big = events.filter((e) => !(e.kind === 'live' && e.small))
  const groups = new Map<string, FeedEvent[]>()
  for (const e of big) {
    const g = groups.get(e.login)
    if (g) g.push(e)
    else groups.set(e.login, [e])
  }
  const items: FeedItem[] = [...groups.values()].map((g) => ({ key: `g:${g[0]!.login}`, at: g[0]!.at, old: asOf - g[0]!.at > FEED_OLD_MS, group: g }))
  if (small.length) items.push({ key: 'lives', at: small[0]!.at, old: asOf - small[0]!.at > FEED_OLD_MS, lives: small })
  items.sort((a, b) => b.at - a.at)

  // The day's top moments, for a quiet hour: the list's from earlier today that hold up, by their ×
  const top: FeedItem[] = []
  const seen = new Set(groups.keys())
  const best = (list?.items ?? [])
    .filter((item) => item.minuteStart < asOf - FEED_WINDOW_MS && sameDay(item.minuteStart, asOf))
    .map((item) => checkMoment(item, asOf))
    .filter((m) => m.rowX != null)
    .sort((a, b) => b.rowX! - a.rowX! || b.at - a.at)
  for (const m of best) {
    const e = listMoment(m, live)
    if (seen.has(e.login)) continue
    seen.add(e.login)
    top.push({ key: `t:${e.login}`, at: e.at, old: true, group: [e] })
  }

  return {
    asOf, events, items, top, earlier, screenerReady, channels: hub.liveChannels.length, list: !!list, up, upWindow: commonWindow(hotChat), art, left,
    spikeSeen: spikes.length + left.spikeUnder.length + left.spikeNew.length,
    liveCount: lives.length,
  }
}

/** Event keys a poll can bring (and 'now' for the Picking up row). */
export function feedKeys(model: LiveFeedModel): Set<string> {
  const keys = new Set(model.events.map((e) => e.key))
  if (model.up.length) keys.add('now')
  return keys
}

/** Rows a newer model brings that the shown one lacks. */
export function feedFresh(shown: LiveFeedModel, next: LiveFeedModel): Set<string> {
  if (shown.asOf == null) return new Set()
  const had = feedKeys(shown)
  return new Set([...feedKeys(next)].filter((k) => !had.has(k)))
}

/** How many rows fit: phone 6, under 1536 px 8; the sticky rail ≥ 1536 px is sized to the window's height. */
export function feedCap(phone: boolean, wide: boolean, innerHeight: number): number {
  return phone ? 6 : !wide ? 8 : Math.max(6, Math.floor((innerHeight - 72 - 300) / 52))
}

/** 1100–1535 px: rows of 52 px that fit the column's `px` under the header, leaving room for the "earlier" rule and "Show N more" (L1). */
export function feedColumnCap(px: number): number {
  return Math.max(3, Math.floor((px - 26 - 40) / 52))
}

export function feedIsQuiet(model: LiveFeedModel): boolean {
  const first = model.items[0]
  return model.asOf != null && (!first || model.asOf - first.at > FEED_QUIET_MS)
}

/** The data is over 3 minutes old: the dot greys, and the quiet line names its hour. */
export const feedStale = (asOf: number | null, nowMs: number): boolean => asOf != null && nowMs - asOf > FEED_STALE_MS

/**
 * The quiet line. Fresh data says "right now"; data over 3 minutes old, or a
 * saved copy whatever the viewer's clock says, names the hour it covers on the
 * feed's own clock, the "as of" time (Q1, 10-28).
 */
export function feedQuietText(game: string | null, asOf: number, nowMs: number, saved = false, blind = false): string {
  if (saved || feedStale(asOf, nowMs)) return `Nothing${game ? ` from ${game}` : ''} in the hour before ${feedClockFloor(asOf)}`
  // without chat vs usual, spikes and Picking up were never checked, so the hour is not known to be quiet
  if (blind) return game ? `No ${game} moments in the last hour` : 'No new moments in the last hour'
  return game ? `Nothing from ${game} in the last hour` : 'Quiet right now · nothing in the last hour'
}

/** Said over the feed when no live channel's chat vs usual came with the update (the backend's history read failed). */
export const FEED_BLIND = 'Chat vs usual isn’t in this update, so chat spikes and Picking up can’t show.'

/** No live channel's chat vs usual came with this update. */
export const feedBlind = (model: LiveFeedModel): boolean => model.asOf != null && model.channels > 0 && model.screenerReady === 0

/** The phone peek's quiet line, under the same rule. */
export function feedPeekQuietText(asOf: number, nowMs: number, saved = false): string {
  return saved || feedStale(asOf, nowMs) ? `Nothing in the hour before ${feedClockFloor(asOf)}.` : 'Quiet right now.'
}

export const FEED_LOADING = 'Loading live feed…'
export const FEED_UNAVAILABLE = 'Unavailable right now.'

/**
 * What the feed waits on (10-28) while no hub answer stands behind it (totals
 * only, a saved copy, or nothing yet): 'loading' while the page's hub read
 * runs, 'unavailable' once it gave up. null: a hub answer, or a saved copy
 * whose read gave up, shows as it is.
 */
export type FeedWait = 'loading' | 'unavailable' | null

/**
 * The one line the feed and the phone peek show instead of rows and the quiet
 * line, or null when they show their own. Rows always show (a saved copy's
 * too). `waiting`: the first reply, or a hub answer whose feed is not built
 * yet, is still coming. Nothing at all to show is never a quiet hour.
 */
export function feedWaitText(model: LiveFeedModel, wait: FeedWait, waiting = false): string | null {
  if (model.items.length || model.up.length || model.top.length || model.earlier.length) return null
  if (wait === 'loading' || (!wait && model.asOf == null && waiting)) return FEED_LOADING
  return wait === 'unavailable' || model.asOf == null ? FEED_UNAVAILABLE : null
}

/* ---------- F2 (10-22): one game at a time ---------- */

/** A row's game, as GroupRow shows it: its newest event's, else the first an older one names. */
export const feedGroupCat = (group: readonly FeedEvent[]): string | null => group[0]?.cat || group.find((e) => e.cat)?.cat || null

export interface FeedGame {
  name: string
  art: string | null
  /** Its Twitch category id, for the Moments link; null when it has no art. */
  id: string | null
  /** Rows it has in the feed (channels, went-live starts, Picking up, the quiet hour's top moments). */
  rows: number
}

/** The feed's art is only ever its category's own (publicHub, boxArtImage), so the art names the id. */
const ART_ID = /^https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\/(\d{1,20})(?:_IGDB)?-\d+x\d+\.(?:jpe?g|png|webp)$/i
export const feedGameId = (art: string | null | undefined): string | null => (art ? ART_ID.exec(art)?.[1] ?? null : null)

/** "All moments →": the Moments page on the picked game (B2's ?game=), or whole when its id isn't known. */
export function feedMomentsHref(game: FeedGame | null | undefined): string {
  return game?.id ? `/analytics/moments?${new URLSearchParams({ game: game.id })}` : '/analytics/moments'
}

/**
 * The games the feed's rows name, most rows first, for the box-art strip over
 * the list. `keep` (the picked game) stays listed with 0 rows after a poll
 * leaves it none, so the pick can still be cleared.
 */
export function feedGames(model: LiveFeedModel, keep: string | null = null): FeedGame[] {
  const tally = new Map<string, number>()
  const add = (cat: string | null) => { if (cat) tally.set(cat, (tally.get(cat) ?? 0) + 1) }
  for (const it of [...model.items, ...model.top, ...model.earlier]) {
    if ('group' in it) add(feedGroupCat(it.group))
    else for (const e of it.lives) add(e.cat)
  }
  // a folded twin in another game is that game's row once it is picked (feedForGame)
  for (const it of model.earlier) {
    const lead = 'group' in it ? it.group[0] : undefined
    if (lead?.kind !== 'moment' || !lead.folded) continue
    for (const cat of new Set(lead.folded.map((t) => t.cat))) if (cat !== lead.cat) add(cat)
  }
  for (const u of model.up) add(u.cat)
  if (keep && !tally.has(keep)) tally.set(keep, 0)
  return [...tally]
    .map(([name, rows]) => {
      const art = model.art.get(name) ?? null
      return { name, art, id: feedGameId(art), rows }
    })
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name))
}

/**
 * An earlier row under a picked game: the lead's row with only that game's twins named, or, when the lead is in
 * another game, the first folded twin in this one as its own row.
 */
function earlierForGame(it: FeedItem, game: string): FeedItem[] {
  if (!('group' in it)) return []
  const lead = it.group[0]
  if (lead?.kind !== 'moment' || !lead.folded) return feedGroupCat(it.group) === game ? [it] : []
  const named = (ms: readonly FeedMoment[]) => ms.filter((t) => t.cat === game).map((t) => t.name)
  if (lead.cat === game) return [{ ...it, group: [{ ...lead, also: named(lead.folded) }] }]
  const twin = lead.folded.find((t) => t.cat === game)
  if (!twin) return []
  return [{ ...it, key: `e:${twin.key}`, at: twin.at, group: [{ ...twin, also: named(lead.folded.filter((t) => t !== twin)) }] }]
}

/** The feed with only `game`'s rows; null leaves it whole. A shared went-live row keeps that game's starts. */
export function feedForGame(model: LiveFeedModel, game: string | null): LiveFeedModel {
  if (!game || model.asOf == null) return model
  const asOf = model.asOf
  const items: FeedItem[] = []
  for (const it of model.items) {
    if ('group' in it) {
      if (feedGroupCat(it.group) === game) items.push(it)
      continue
    }
    const lives = it.lives.filter((e) => e.cat === game)
    if (lives.length) items.push({ ...it, at: lives[0]!.at, old: asOf - lives[0]!.at > FEED_OLD_MS, lives })
  }
  items.sort((a, b) => b.at - a.at) // the shared row may now sit at an older start
  return {
    ...model,
    events: model.events.filter((e) => e.cat === game),
    items,
    top: model.top.filter((it) => 'group' in it && feedGroupCat(it.group) === game),
    earlier: model.earlier.flatMap((it) => earlierForGame(it, game)),
    up: model.up.filter((u) => u.cat === game),
  }
}

export function feedHref(e: FeedEvent): string {
  return e.kind === 'moment' ? e.row.href : channelHref({ login: e.login, streamId: e.streamId })
}

/** The row's "Earlier: 4:20 PM went live · …" (title and aria), or ''. */
export function feedRestTip(group: readonly FeedEvent[]): string {
  const rest = group.slice(1)
  return rest.length ? `Earlier: ${rest.map((e) => `${hubClock(e.at)} ${feedWord(e)}`).join(' · ')}` : ''
}

export function feedRowAria(group: readonly FeedEvent[], nowMs: number): string {
  const e = group[0]!
  const cat = e.cat || group.map((x) => x.cat).find(Boolean) || null
  const ago = feedAgo(e.at, nowMs)
  let said: string
  if (e.kind === 'spike') {
    const u = e.ser === 'chat' ? 'chat' : 'emotes'
    said = `${feedWord(e)}, ${ago}: ${feedMore(e.add)} more ${u} a minute than usual, ${feedMultiplierWords(e.x)} times usual`
  } else if (e.kind === 'moment') {
    const u = e.row.series
    said = `${feedWord(e)}, ${ago}${e.add != null && e.add > 0 ? `: ${feedMore(e.add)} more ${u} a minute than usual` : ''}${e.x != null ? `, ${feedMomentSer(e)} ${e.list ? fx(e.x).replace('×', '') : feedMultiplierWords(e.x)} times usual` : e.why ? `, ${e.why}` : ''}${e.also?.length ? `, with ${e.also.join(', ')} in the same minute` : ''}`
  } else {
    said = `went live ${ago}${e.chat != null && e.chat >= 1 ? `, chat ${feedMore(e.chat)} a minute` : ''}${e.jump ? ', chat jumping' : ''}${e.viewers != null ? `, ${formatHubInt(e.viewers)} viewers now` : ''}`
  }
  const tip = feedRestTip(group)
  return `${e.name} ${said}${cat ? `, ${cat}` : ''}${tip ? `. ${tip}` : ''}${e.kind === 'moment' ? '. Opens in Moments.' : '. Opens the stream page.'}`
}

export function feedLivesAria(lives: readonly FeedLive[], nowMs: number): string {
  const n = lives.length
  const lead = lives.slice(0, 3).map((e) => e.name)
  return `${n} smaller ${n === 1 ? 'channel' : 'channels'} went live in the last hour, under ${formatHubInt(FEED_BIG_VIEWERS)} viewers each, the latest ${feedAgo(lives[0]!.at, nowMs)}: `
    + `${lead.join(', ')}${n > 3 ? ` and ${n - 3} more` : ''}. Show them.`
}

export function feedUpAria(model: LiveFeedModel): string {
  const n = model.up.length
  const top = model.up[0]
  return `Picking up: ${n} ${n === 1 ? 'channel' : 'channels'} whose chat${model.upWindow ? ` over ${model.upWindow}` : ''} ran at least ${FEED_UP_MIN} times usual, at least ${FEED_NOW_MIN} a minute and ${FEED_ADD_MIN} more than usual.`
    + (top ? ` Most added: ${top.name}, ${feedMore(top.add)} more a minute.` : '') + ' Show them.'
}

export function feedTip(model: LiveFeedModel): string {
  const { left } = model
  const moments = model.events.filter((e) => e.kind === 'moment').length
  const spikes = model.events.filter((e) => e.kind === 'spike').length
  return `The hour before ${model.asOf != null ? feedClockFloor(model.asOf) : 'the last update'}, newest first, one row per channel. `
    + `Chat spikes: channels whose chat or emotes jumped over the last 5 minutes against the 5 before, kept only when those 5 minutes also ran at least ${FEED_UP_MIN}× the stream’s own average, at least ${FEED_NOW_MIN} a minute and ${FEED_ADD_MIN} more than usual: ${spikes} of ${model.spikeSeen} here`
    + (left.spikeUnder.length ? `; under ${FEED_UP_MIN}× their usual: ${left.spikeUnder.join(', ')}` : '')
    + (left.spikeNew.length ? `; too new to compare, so their went-live row says “chat jumping”: ${left.spikeNew.join(', ')}` : '') + '. '
    + 'One number a row, how many times the stream’s usual chat or emotes (“5.0× more emotes”), beside its game; a moment’s other numbers are in its card when you point at it. '
    + (feedBlind(model) ? 'Chat vs usual did not come with this update, so chat spikes and Picking up are hidden. ' : '')
    + (model.list
      ? `Moments: the Moments page’s own list, the hour’s moments that hold up or partly do (${moments || 'none this hour'}), with its checks. `
        + 'The × is the minute against the 15 minutes before, shown when the moment holds up; one that partly holds up says why. '
        + 'When the hour is quiet, the day’s top moments sit under it. '
      : `Moments: the detector’s moments from the hour at ${FEED_UP_MIN}× usual or more (${moments || 'none this hour'}). `
        + `Moments in a stream’s first ${FEED_START_MIN} minutes are left out (chat saying hello), and so is any the backend’s own comparison puts under ${FEED_KEEP_MIN}×`
        + (left.momUnder.length ? ` (${left.momUnder.join('; ')})` : '') + '. '
        + (model.earlier.length ? `Under the hour, “earlier”: ${model.earlier.length} of the strongest moments so far on streams live now (the hub sends up to 10, from the 12 busiest channels), newest first, under the same rules; channels that counted the same emotes in the same minute share a row. ` : ''))
    + `Went live: every stream that started in the hour (${model.liveCount}). ${formatHubInt(FEED_BIG_VIEWERS)}+ viewers get their own row; the rest share one. `
    + `Picking up: chat at least ${FEED_UP_MIN}× usual${model.upWindow ? ` over ${model.upWindow}` : ''} with the same floors (${model.up.length}, not counting channels with a spike row), ranked by how many more messages a minute. `
    + 'Rows older than 30 minutes fade. Went offline needs a backend event and is not shown.'
}
