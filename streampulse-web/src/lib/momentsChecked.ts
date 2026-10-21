import { sanitizeEmoteImageUrl } from './emoteAssetUrl'
import { isExactCategoryBoxArt } from './momentCategoryArtwork'
import { newsroomProfileUrl } from './newsroomProfiles'
import type { MomentCheckLevel, MomentMetricKind, MomentVerdict, MomentsFeedEmote, MomentsFeedItem } from './momentsFeed'

/**
 * The checked Moments page's display model (design: moments-r2, 2026-10-16).
 *
 * Every verdict, check outcome, label, × and baseline comes from the feed. This
 * module only words them: the check codes become sentences, and the figures in
 * those sentences are the item's own (perMin, x, baselinePerMin,
 * baselineMeasuredMinutes). Where the feed leaves the baseline out (5 to 9
 * minutes measured), the sentence quotes the mean of the sparkline's baseline
 * slots, the same minutes (-16..-2) the checks read, as the feed's contract
 * words it. No × is worked out here and no threshold is applied again: a
 * moment the feed sends no × for shows none.
 */

/** Play starts this many seconds before the minute. */
export const LEAD_S = 10
/** "updated … ago" greys after this long without a fresh poll (the feed's rule). */
export const STALE_MS = 3 * 60_000
/** A stream that went live this recently gets the red ring. */
const JUST_LIVE_MS = 60 * 60_000

export const VERDICT_WORD: Record<MomentVerdict, string> = { ok: 'Holds up', warn: 'Partly', bad: 'Doesn’t hold up' }

export type CheckLineLevel = MomentCheckLevel | 'note'
export interface CheckLine { id: 'history' | 'busy' | 'rise' | 'label'; lv: CheckLineLevel; short: string; long: string }

export type MomentAct =
  | { type: 'spammed'; emote: MomentsFeedEmote; text: string }
  | { type: 'emotes'; emotes: MomentsFeedEmote[]; text: string }
  | { type: 'chat'; text: string }

export interface CheckedMoment {
  item: MomentsFeedItem
  key: string
  sid: string
  name: string
  /** Epoch ms of the moment's minute. */
  at: number
  /** The stream's go-live, epoch ms (the minute less its offset). */
  startedAt: number
  /** What rose: the label's kind. */
  kind: MomentMetricKind
  /** The label kind's ×, as sent; null when the feed sends none. */
  x: number | null
  /** The row's ×: only for a moment that holds up and rose 1.5× or more (the feed's rise code "rose"). */
  rowX: number | null
  /** The short reason a moment is partly or doesn't hold up. */
  why: string
  checks: CheckLine[]
  /** The baseline a minute: the feed's, else the mean of the measured slots (-16..-2 inside the stream); null under 5. */
  baseC: number | null
  baseE: number | null
  /** Minutes from the moment where the compared minutes start (-16, or the stream's first whole minute). */
  winFrom: number
  justLive: boolean
  find: string
  live: boolean
}

const nf = new Intl.NumberFormat('en-US')
export const int = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '–' : nf.format(Math.round(n)))
/** 4.2×, 12× */
export const fx = (x: number) => `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The stream's own clock, as Twitch's player writes it: h:mm:ss, m:ss under an hour. */
export function stc(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60
  return `${h ? `${h}:${String(mi).padStart(2, '0')}` : mi}:${String(se).padStart(2, '0')}`
}
/** Twitch's ?t= form: 1h2m3s. */
export function hms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`
}

const TF = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const TS = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
/** Clock time in the reader's zone. */
export const clk = (t: number) => TF.format(t)
/** An axis tick: the clock time without AM/PM. */
export const tick = (t: number) => TS.format(t).replace(/\s?[AP]M$/, '')
export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

/** "just now", "N min ago", the clock time, or "Yesterday" and the clock time. */
export function when(t: number, now: number): string {
  const m = Math.max(0, Math.floor((now - t) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${sameDay(t, now) ? '' : 'Yesterday '}${clk(t)}`
}

/** A Twitch CDN URL with no user, password, query or hash whose path starts with `path`, else nothing. */
function twitchCdn(value: string | undefined, path: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.origin === 'https://static-cdn.jtvnw.net' && url.pathname.startsWith(path) && !url.username && !url.password && !url.search && !url.hash ? url.href : undefined
  } catch {
    return undefined
  }
}
/** The channel's avatar (the repo's profile picture check). */
export const avatarImage = (item: Pick<MomentsFeedItem, 'profileImageUrl'>) => newsroomProfileUrl(item.profileImageUrl)
/** The game's box art, only when it is that category's own (the repo's box art check). */
export const boxArtImage = (item: Pick<MomentsFeedItem, 'category'>) => {
  const art = item.category?.boxArtUrl
  return art && isExactCategoryBoxArt(art, item.category!.id) ? art : undefined
}
/** The stream's live preview frame. */
export const liveFrameImage = (item: Pick<MomentsFeedItem, 'liveFrameUrl'>) => twitchCdn(item.liveFrameUrl, '/previews-ttv/')
export const emoteImage = (emote: Pick<MomentsFeedEmote, 'imageUrl'>) => sanitizeEmoteImageUrl(emote.imageUrl)

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)

/** The sparkline's baseline slots: -16..-2 from the moment, inside the stream. */
function baselineSlots(item: MomentsFeedItem, kind: MomentMetricKind): number[] {
  const arr = kind === 'emotes' ? item.spark.emotes : item.spark.chat, mi = item.spark.momentIndex
  const out: number[] = []
  for (let i = Math.max(0, mi - 16, item.spark.sparkStartIndex); i <= mi - 2; i += 1) {
    const v = arr[i]
    if (v != null) out.push(v)
  }
  return out
}
/** The baseline a minute: the feed's; where it leaves it out (5 to 9 minutes measured), the mean of those minutes, for the sentences only. */
function baseOf(item: MomentsFeedItem, kind: MomentMetricKind): number | null {
  const sent = item[kind].baselinePerMin
  if (sent != null) return sent
  const slots = baselineSlots(item, kind)
  return slots.length >= 5 ? mean(slots) : null
}

/** What happened, in the feed's words: "spammed" and the emote, "emote burst" with the minute's emotes, "chat burst". */
export function actOf(item: MomentsFeedItem, big = false): MomentAct {
  const lead = item.topEmotes[0]
  if (item.label.kind === 'emotes' && item.label.spammed && lead) return { type: 'spammed', emote: lead, text: item.label.text }
  if (item.label.kind === 'emotes') {
    const emotes = item.topEmotes.filter(e => emoteImage(e)).slice(0, big ? 3 : 2)
    return { type: 'emotes', emotes, text: `emote burst${emotes.length ? ` (${emotes.map(e => e.name).join(', ')})` : ''}` }
  }
  return { type: 'chat', text: 'chat burst' }
}

/**
 * The checks, worded from the feed's codes (moments-r2 model.js wording). The
 * label note is added when the feed says it relabelled the moment.
 */
export function checkLines(item: MomentsFeedItem): CheckLine[] {
  const out: CheckLine[] = []
  const kind = item.label.kind, word = kind === 'emotes' ? 'emotes' : 'chat', was = kind === 'emotes' ? ' were ' : ' was '
  const baseC = baseOf(item, 'chat'), baseE = baseOf(item, 'emotes'), base = kind === 'emotes' ? baseE : baseC
  const xc = item.chat.x, xe = item.emotes.x, x = kind === 'emotes' ? xe : xc
  const chat = item.chat.perMin, val = item[kind].perMin
  const measured = item.baselineMeasuredMinutes ?? baselineSlots(item, 'chat').length
  const expected = 15 - Math.max(0, item.spark.sparkStartIndex)
  const age = Math.floor(item.offsetSeconds / 60)
  const h = item.checks.history
  if (h.code === 'opening') out.push({ id: 'history', lv: h.level, short: 'the stream had just started', long: `The stream had been live ${item.offsetSeconds < 60 ? 'under a minute' : `${age} min`}. A stream’s opening always looks like a jump, so it never counts.` })
  else if (h.code === 'young') out.push({ id: 'history', lv: h.level, short: `stream only ${age} min old`, long: `The stream had been live ${age} min, so only ${measured} minutes were there to compare with (20 is the minimum).` })
  else if (h.code === 'gaps') out.push({ id: 'history', lv: h.level, short: 'gaps before it', long: `Only ${measured} of the ${expected} minutes before it were measured.` })
  else out.push({ id: 'history', lv: h.level, short: '', long: `The stream was past its first 20 minutes, and all ${measured} minutes before it were measured.` })
  const b = item.checks.busy
  if (b && b.code === 'quiet') out.push({ id: 'busy', lv: b.level, short: 'quiet chat before', long: `Chat was quiet before it (${int(baseC)} messages a minute), so a small change looks big${chat != null ? `: this minute had ${int(chat)}.` : '.'}` })
  else if (b) out.push({ id: 'busy', lv: b.level, short: '', long: `Busy enough to compare: ${int(baseC)} messages a minute before it.` })
  const r = item.checks.rise
  if (r) {
    const tail = ` (${int(val)} a minute against ${int(base)})`
    if (r.code === 'from_quiet') out.push({ id: 'rise', lv: r.level, short: '', long: `${cap(word)} went from almost none (${int(base)} a minute) to ${int(val)}.` })
    else if (r.code === 'too_small') out.push({ id: 'rise', lv: r.level, short: 'too small to call', long: `${cap(word)} went from ${int(base)} to ${val == null ? 'no figure' : int(val)} a minute: too small to call.` })
    else if (r.code === 'no_figure') out.push({ id: 'rise', lv: r.level, short: 'nothing to measure', long: `There was no ${word} count for this minute.` })
    else if (r.code === 'rose') out.push({ id: 'rise', lv: r.level, short: '', long: `${cap(word)}${was}${x != null ? fx(x) : 'more than'} the 15 minutes before${tail}.` })
    else if (r.code === 'partly') out.push({ id: 'rise', lv: r.level, short: `only ${x != null ? fx(x) : 'a little more than'} the minutes before`, long: `${cap(word)}${was}only ${x != null ? fx(x) : 'a little more than'} the 15 minutes before${tail}.` })
    else out.push({ id: 'rise', lv: r.level, short: 'no busier than before', long: `Chat (${xc != null ? fx(xc) : 'no figure'}) and emotes (${xe != null ? fx(xe) : 'no figure'}) were no busier than the 15 minutes before.` })
  }
  if (item.label.relabelled) {
    const det = kind === 'emotes' ? 'chat' : 'emotes', dx = det === 'emotes' ? xe : xc
    const shown = item.label.spammed && item.topEmotes[0] ? `"spammed ${item.topEmotes[0].name}"` : `a ${item.label.text}`
    out.push({ id: 'label', lv: 'note', short: 'relabelled', long: `Detected as ${det === 'emotes' ? 'an emote spike' : 'a chat spike'}, but ${det === 'emotes' ? 'emotes were' : 'chat was'} ${dx != null ? fx(dx) : 'flat'} the minutes before while ${word} rose ${x != null ? fx(x) : 'more'}. Shown as ${shown}.` })
  }
  return out
}

export function checkMoment(item: MomentsFeedItem, now: number): CheckedMoment {
  const kind = item.label.kind
  const checks = checkLines(item)
  const baseC = baseOf(item, 'chat'), baseE = baseOf(item, 'emotes')
  const x = item[kind].x
  const worst = checks.find(c => c.lv === item.verdict && c.short)
  const startedAt = item.minuteStart - item.offsetSeconds * 1000
  return {
    item, key: item.id, sid: item.streamId, name: item.displayName || item.login,
    at: item.minuteStart, startedAt, kind, x,
    rowX: item.verdict === 'ok' && item.checks.rise?.code === 'rose' && x != null ? x : null,
    why: worst ? worst.short : '',
    checks, baseC, baseE,
    winFrom: Math.max(-16, item.spark.sparkStartIndex - item.spark.momentIndex),
    justLive: now - startedAt <= JUST_LIVE_MS,
    find: `${item.displayName} ${item.login} ${item.category?.name ?? ''} ${item.topEmotes.map(e => e.name).join(' ')}`.toLowerCase(),
    live: item.streamLive,
  }
}

/** The detail's verdict line: "all N checks pass", or the reason, and how many labels the page corrected. */
export function verdictLine(m: CheckedMoment): string {
  const counted = m.checks.filter(c => c.lv !== 'note').length, fixed = m.checks.filter(c => c.lv === 'note').length
  return `${m.item.verdict === 'ok' ? `all ${counted} checks pass` : m.why}${fixed ? ` · ${fixed} corrected` : ''}`
}
const LEVEL_ORDER: Record<CheckLineLevel, number> = { bad: 0, warn: 1, ok: 2, note: 3 }
export const sortedChecks = (checks: CheckLine[]) => checks.slice().sort((a, b) => LEVEL_ORDER[a.lv] - LEVEL_ORDER[b.lv])

export type MomentsView = 'checked' | 'all' | 'saved'
export type MomentsSort = 'new' | 'jump' | 'busy'
export const SORTS: Record<MomentsSort, (a: CheckedMoment, b: CheckedMoment) => number> = {
  new: (a, b) => b.at - a.at || b.item.score - a.item.score,
  jump: (a, b) => (b.x ?? -1) - (a.x ?? -1) || b.at - a.at,
  busy: (a, b) => (b.item.chat.perMin ?? -1) - (a.item.chat.perMin ?? -1) || b.at - a.at,
}

/** One row per stream, in list order; the stream's moments under its newest. */
export function groupsOf(list: CheckedMoment[]): CheckedMoment[][] {
  const by = new Map<string, CheckedMoment[]>()
  for (const m of list) {
    const g = by.get(m.sid)
    if (g) g.push(m)
    else by.set(m.sid, [m])
  }
  return [...by.values()]
}

/** The aria label a row and the live region read. */
export function ariaOf(m: CheckedMoment, now: number, more = 0): string {
  const x = m.rowX != null ? `${fx(m.rowX).replace('×', ' times')} the 15 minutes before` : m.why
  const cat = m.item.category?.name, act = actOf(m.item)
  return `${m.name} ${act.type === 'spammed' ? 'chat ' : ''}${act.text}, ${when(m.at, now)}${x ? `, ${x}` : ''}${cat ? `, ${cat}` : ''}${m.item.viewers != null ? `, ${int(m.item.viewers)} watched it` : ''}. ${VERDICT_WORD[m.item.verdict]}.${more ? ` ${more} ${more === 1 ? 'earlier moment.' : 'earlier moments.'}` : ''}`
}

/** The 25 sparkline bars: the moment in teal, the compared minutes stronger than the rest. */
export interface SparkBar { x: number; y: number; w: number; h: number; tone: 'mo' | 'in' | 'out' }
export function sparkBars(m: CheckedMoment): SparkBar[] {
  const arr = m.kind === 'emotes' ? m.item.spark.emotes : m.item.spark.chat, mi = m.item.spark.momentIndex, bw = 72 / 25
  const max = Math.max(1, ...arr.filter((v): v is number => v != null))
  const out: SparkBar[] = []
  arr.forEach((v, j) => {
    if (v == null) return
    const h = Math.max(1, (v / max) * 26), rel = j - mi
    out.push({ x: j * bw, y: 28 - h, w: Math.max(1, bw - 0.9), h, tone: rel === 0 ? 'mo' : rel >= m.winFrom && rel <= -2 ? 'in' : 'out' })
  })
  return out
}

/**
 * Where a minute sits in the stream: in the VOD when the stream record links
 * one with verified timing (Play and Open on Twitch land there), else since
 * go-live.
 */
export interface MomentVod { vodId: string; alignSeconds: number }
export const offAt = (m: CheckedMoment, rel = 0) => m.item.offsetSeconds + rel * 60
export const streamTime = (m: CheckedMoment, vod: MomentVod | null, rel = 0) => stc(offAt(m, rel) + (vod ? vod.alignSeconds : 0))
export const streamWhere = (vod: MomentVod | null) => (vod ? 'in the VOD' : 'into the stream')
export function streamTip(m: CheckedMoment, vod: MomentVod | null, rel = 0): string {
  return vod && Math.abs(vod.alignSeconds) >= 2
    ? `${streamTime(m, vod, rel)} in the VOD, ${stc(offAt(m, rel))} since the stream went live`
    : `${streamTime(m, vod, rel)} since the stream went live`
}

/** The stream strip: the channel's moments on the stream's own timeline. */
export interface StripModel {
  stems: Array<{ m: CheckedMoment; left: number; h: number }>
  marks: Array<{ left: number; text: string }>
  from: string
  to: string
  since: string
  count: number
}
export function stripModel(m: CheckedMoment, all: CheckedMoment[], now: number): StripModel | null {
  const mine = all.filter(x => x.sid === m.sid).sort((a, b) => a.at - b.at)
  if (mine.length < 2) return null
  const live = m.live
  const t0 = Math.max(m.startedAt, now - 12 * 3600e3), t1 = live ? now : mine[mine.length - 1].at + 10 * 60_000
  const span = Math.max(60_000, t1 - t0), pos = (t: number) => Math.max(0, Math.min(100, ((t - t0) / span) * 100))
  const tall = (x: CheckedMoment) => (x.x == null ? 8 : 8 + Math.min(1, Math.log(Math.max(1, x.x)) / Math.log(20)) * 26)
  const step = [1, 2, 3, 4, 6].find(n => span / 3600e3 / n <= 5) ?? 12
  const marks: StripModel['marks'] = []
  const h0 = new Date(t0)
  h0.setMinutes(0, 0, 0)
  for (let t = h0.getTime() + 3600e3; t < t1; t += 3600e3) {
    if (new Date(t).getHours() % step) continue
    const p = pos(t)
    if (p < 12 || p > 88) continue
    marks.push({ left: p, text: tick(t) })
  }
  const since = m.startedAt >= t0
    ? `live since ${clk(m.startedAt)}${sameDay(m.startedAt, now) ? '' : ' yesterday'}`
    : `the last 12 hours · live for ${Math.round((now - m.startedAt) / 3600e3)} hours`
  return {
    stems: mine.map(x => ({ m: x, left: pos(x.at), h: tall(x) })),
    marks, from: clk(t0), to: live ? 'now' : clk(t1), since, count: mine.length,
  }
}

/**
 * The minutes around the opened moment for the chart and the held minute:
 * index 0 is 32 minutes before it, MINUTE_SERIES_AT the moment, the last 16 after.
 */
export const SERIES_BEFORE = 32
export const SERIES_AFTER = 16
export interface MinuteSeries {
  c: Array<number | null>
  e: Array<number | null>
  v: Array<number | null>
  /** The minute's top three emotes, by count. */
  t3: Array<Array<{ name: string; imageUrl?: string; count: number }> | null>
  /** True when drawn from the feed's 25-minute sparkline because /minutes did not answer. */
  fromSpark: boolean
}
/** The 25 sparkline slots as a series (no viewers or emotes per minute): what the chart draws without /minutes. */
export function seriesFromSpark(m: CheckedMoment): MinuteSeries {
  const n = SERIES_BEFORE + SERIES_AFTER + 1, c = Array<number | null>(n).fill(null), e = Array<number | null>(n).fill(null)
  const mi = m.item.spark.momentIndex
  m.item.spark.chat.forEach((v, j) => { c[SERIES_BEFORE + j - mi] = v })
  m.item.spark.emotes.forEach((v, j) => { e[SERIES_BEFORE + j - mi] = v })
  const t3 = Array<MinuteSeries['t3'][number]>(n).fill(null)
  t3[SERIES_BEFORE] = m.item.topEmotes.map(({ name, imageUrl, count }) => ({ name, imageUrl, count }))
  return { c, e, v: Array<number | null>(n).fill(null), t3, fromSpark: true }
}

/**
 * A held minute against its own 15 minutes before (the moment's rule, read off
 * the drawn minutes): minutes -16..-2 from it, inside the stream, mean of the
 * measured ones. Display only: the held minute is any bar, not a moment.
 */
export function usualAt(series: Array<number | null>, m: CheckedMoment, rel: number, floor: number):
  { why: string; b?: number } | { b: number; x: number | null; fromRel: number; toRel: number } {
  const off = offAt(m, rel), lo = Math.max(rel - 16, rel - Math.floor(off / 60)), vs: number[] = []
  for (let j = lo; j <= rel - 2; j += 1) {
    const v = series[SERIES_BEFORE + j]
    if (j >= -SERIES_BEFORE && v != null) vs.push(v)
  }
  if (vs.length < 5) return { why: 'too early to compare' }
  const b = vs.reduce((a, v) => a + v, 0) / vs.length
  if (b < floor) return { b, why: 'quiet before' }
  const v = series[SERIES_BEFORE + rel]
  return { b, x: v == null ? null : v / b, fromRel: lo, toRel: rel - 2 }
}
/** The page's own floors for the held minute's "× usual" (the moment checks' floors). */
export const HOLD_FLOOR = { chat: 10, emotes: 5 } as const
export const RISE_OK = 1.5

/** The freshness line's counts. */
export function freshCounts(list: CheckedMoment[]) {
  const ok = list.filter(m => m.item.verdict === 'ok').length, warn = list.filter(m => m.item.verdict === 'warn').length
  return { all: list.length, ok, warn, bad: list.length - ok - warn, streams: new Set(list.map(m => m.sid)).size }
}
export function updatedText(sinceMs: number): string {
  const s = Math.floor(sinceMs / 1000)
  return s < 10 ? 'updated just now' : s < 60 ? `updated ${Math.floor(s / 10) * 10} s ago` : `updated ${Math.floor(s / 60)} min ago`
}
