/**
 * The selected bar's strip under the session chart (F22, d3-v2
 * session-original): the data model, ported from the mockup's
 * card-model.js `sessionBar` plus session-original.js `modelFor`.
 *
 * Every number comes from the measured minutes, the backend's recap moments
 * and the VOD link; nothing is typed in or estimated. Departures from the
 * mockup, on purpose:
 * - no "× usual" on the figures (F8, owner item 11);
 * - Play and the 10 s lead-in only when the VOD is linked and its alignment is
 *   a number (PORT-PLAN §2.4); otherwise prod's "Open full VOD".
 */
import {
  recapMomentAnalyticalOffset,
  recapMomentReasonLabel,
  recapMomentSeekOffset,
  topEmotesFromRollup,
} from '@streampulse/pulse-core'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseRecapMoment } from '../apiTypes.ts'
import { minuteEmoteTotal } from '../components/analytics/chartRollupUtils.ts'
import { resolveGameArtUrl } from '../components/analytics/GamesPlayedStrip.tsx'
import { getEmoteImageUrl, rollupOffsetSeconds } from './consoleFormat.ts'
import { resolveMomentRowRollup } from './momentRowDisplay.ts'
import { stripMomentEmotes } from './sessionStripMoments.ts'
import { alignedVodOffset, buildTwitchVodUrl, type VodLinkState } from './twitchVodUrl.ts'

/** Seconds of lead-in before a moment, so it plays in (moment-rows.js LEAD). */
export const VOD_LEAD_SECONDS = 10
/** Under this share of a bar's emote uses named, the strip says how much the names cover. */
export const NAMED_MIN_PCT = 25
export const STRIP_MAX_EMOTES = 3
export const STRIP_MAX_MOMENTS = 3

/** A bar on the stream clock: [startSec, endSec), at the chart's bar size. */
export interface SessionBarSpan {
  startSec: number
  endSec: number
  levelMinutes: number
}

/** A recap moment in the strip, with its rank in the Moments list (null when unknown). */
export interface SessionBarMoment {
  rank: number | null
  moment: PulseRecapMoment
}

/** Unpadded stream-clock time, the mockup's h:mm:ss ("0:50:54"). */
export function formatStripClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

const nf = new Intl.NumberFormat('en-US')
/** Whole number with grouping, "—" when missing (the card's `int`). */
export function stripInt(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : nf.format(Math.round(value))
}
/** Per-minute emote figure: whole from 10, one decimal under 10 (bucket-card.js `rate`). */
export function stripRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 10) return stripInt(value)
  if (value <= 0) return '0'
  if (value < 0.1) return '<0.1'
  return String(Math.round(value * 10) / 10)
}

/**
 * The bar's span on the stream clock: from the chart's bar (`onSelectBar`, epoch ms)
 * when given, else the selected minute.
 */
export function resolveBarSpan(args: {
  barSpan?: { startMs: number; endMs: number; levelMinutes?: number | null } | null
  rollup: AnalyticsMinuteRollup
  startedAt?: string
}): SessionBarSpan {
  const { barSpan, rollup, startedAt } = args
  const startMs = startedAt ? Date.parse(startedAt) : Number.NaN
  if (barSpan && Number.isFinite(startMs) && Number.isFinite(barSpan.startMs) && Number.isFinite(barSpan.endMs)
    && barSpan.endMs > barSpan.startMs) {
    const startSec = Math.max(0, Math.floor((barSpan.startMs - startMs) / 1000))
    const endSec = Math.max(startSec + 1, Math.floor((barSpan.endMs - startMs) / 1000))
    const levelMinutes = barSpan.levelMinutes != null && barSpan.levelMinutes > 0
      ? barSpan.levelMinutes
      : Math.max(1, Math.round((endSec - startSec) / 60))
    return { startSec, endSec, levelMinutes }
  }
  const startSec = rollupOffsetSeconds(rollup, startedAt)
  return { startSec, endSec: startSec + 60, levelMinutes: 1 }
}

/** A moment belongs to a bar when its minute overlaps the bar (session-original.js momentsIn). */
function momentInSpan(moment: PulseRecapMoment, span: { startSec: number; endSec: number }): boolean {
  const off = recapMomentAnalyticalOffset(moment)
  return Number.isFinite(off) && off < span.endSec && off + 60 > span.startSec
}

/** The ranked Moments list's entries inside a bar, rank = place in that list (1-based). */
export function momentsInBar(
  ranked: readonly PulseRecapMoment[],
  span: { startSec: number; endSec: number },
): SessionBarMoment[] {
  return ranked
    .map((moment, index) => ({ rank: index + 1, moment }))
    .filter(({ moment }) => momentInSpan(moment, span))
}

const hasScore = (moment: PulseRecapMoment) =>
  Number.isFinite(moment.reactionScore ?? Number.NaN) || Number.isFinite(moment.score)

/**
 * The moment a bar click locks: the best-ranked one in the bar (backend rank,
 * the Moments list order); when none carries a score, the earliest.
 */
export function bestMomentInSpan(
  ranked: readonly PulseRecapMoment[],
  span: { startSec: number; endSec: number },
): PulseRecapMoment | null {
  const held = momentsInBar(ranked, span)
  if (!held.length) return null
  if (held.some(({ moment }) => hasScore(moment))) return held[0]!.moment
  return held
    .slice()
    .sort((a, b) => recapMomentAnalyticalOffset(a.moment) - recapMomentAnalyticalOffset(b.moment))[0]!.moment
}

/** The moment's row label: the backend's reason and score ("Emote spike · score 56"). */
export function barMomentLabel(moment: PulseRecapMoment): string {
  const reason = recapMomentReasonLabel(moment) || 'Moment'
  const raw = moment.reactionScore != null && Number.isFinite(moment.reactionScore) ? moment.reactionScore : moment.score
  return Number.isFinite(raw) ? `${reason} · score ${Math.round(raw)}` : reason
}

/** Play time for a moment: its playback offset on the VOD's clock, 10 s early. Null without verified alignment. */
export function momentPlayAt(
  moment: PulseRecapMoment,
  alignSeconds: number | null | undefined,
  durationSeconds: number | null | undefined,
): number | null {
  if (typeof alignSeconds !== 'number' || !Number.isFinite(alignSeconds)) return null
  const vod = alignedVodOffset(recapMomentSeekOffset(moment), alignSeconds, durationSeconds ?? undefined)
  return vod == null ? null : Math.max(0, vod - VOD_LEAD_SECONDS)
}

// ---- clock labels ----

const CLOCK: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

function clockText(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleTimeString('en-US', { ...CLOCK, timeZone })
}

/** "1:22–1:23 PM" (one day period when both ends share it), card-model.js clockRange. */
export function stripClockRange(a: number, b: number, timeZone?: string): string {
  const parts = (ms: number) => new Intl.DateTimeFormat('en-US', { ...CLOCK, timeZone }).formatToParts(new Date(ms))
  const fa = parts(a)
  const fb = parts(b)
  const period = (p: Intl.DateTimeFormatPart[]) => p.find((x) => x.type === 'dayPeriod')?.value
  const bare = (p: Intl.DateTimeFormatPart[]) => p.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim()
  if (period(fa) && period(fa) === period(fb)) return `${bare(fa)}–${clockText(b, timeZone)}`
  return `${clockText(a, timeZone)}–${clockText(b, timeZone)}`
}

function zoneLabel(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone }).formatToParts(new Date(ms))
      .find((x) => x.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

// ---- the model ----

export interface StripFigure {
  key: 'viewers' | 'chat' | 'emotes'
  label: string
  value: number | null
  /** The tile's third line (viewers: "peak N" or the sampling note); never "× usual". */
  third: string | null
  /** Hover text: peak and sampling. */
  tip: string | null
}

export interface StripEmote {
  key: string
  code: string
  count: number
  perMin: number | null
  imageUrl: string | null
}

export interface StripMomentItem {
  key: string
  rank: number | null
  offsetSec: number
  offsetLabel: string
  label: string
  topEmote: { code: string; count: number; imageUrl: string | null } | null
  locked: boolean
  moment: PulseRecapMoment
}

export interface StripVod {
  vodId: string | null
  /** VOD second Play starts at; null = no Play. */
  playAt: number | null
  playVerb: 'Play VOD from' | 'Play from'
  /** Why there is no Play, in place of the button. */
  message: string | null
  /** The lead-in caption under the picture (a locked moment). */
  leadCaption: { leadSeconds: number; alignSeconds: number } | null
  open: { href: string; label: string } | null
  /** The VOD's start on the VOD clock of what the picture previews (for the frame's timing line). */
  subjectVodStart: number | null
  /** VOD offset whose storyboard tile the picture shows (the middle of the minute or bar). */
  frameVodOffset: number | null
  subject: 'minute' | 'bar' | 'moment'
}

export interface SessionBarStripModel {
  span: SessionBarSpan
  title: string
  startLabel: string
  endLabel: string
  clockLabel: string
  zone: string
  coverage: { measured: number; total: number; partial: boolean; label: string }
  figures: StripFigure[]
  topEmotes: StripEmote[]
  topEmotesExact: boolean
  namedNote: string | null
  providers: { sevenTv: number; other: number } | null
  category: { name: string; artUrl: string | null } | null
  categorySwitch: string | null
  moments: StripMomentItem[]
  lockedMoment: StripMomentItem | null
  vod: StripVod
  /** True when the bar has no measured minute. */
  gap: boolean
}

export interface StripGame {
  gameName: string
  boxArtUrl?: string
  categoryId?: string
  offsetSeconds: number
  durationSeconds: number
}

const sum = <T>(list: readonly T[], f: (item: T) => number) => list.reduce((acc, item) => acc + f(item), 0)
const VOD_ID = /^\d{6,20}$/

export function buildSessionBarStrip(args: {
  span: SessionBarSpan
  rollups: readonly AnalyticsMinuteRollup[]
  startedAt: string
  topEmotesCatalog?: AnalyticsTopEmote[]
  games?: readonly StripGame[] | null
  /** Used for the category when `games` is absent. */
  gameName?: string | null
  moments?: readonly SessionBarMoment[]
  lockedMomentOffsetSeconds?: number | null
  vodLinkState: VodLinkState
  vodId?: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  timeZone?: string
}): SessionBarStripModel {
  const { span, startedAt, topEmotesCatalog, timeZone } = args
  const startMs = Date.parse(startedAt)
  const bm = Math.max(1, Math.round(span.levelMinutes))
  const end = Math.max(span.endSec, span.startSec + 60)

  const inBar = args.rollups.filter((row) => {
    const off = rollupOffsetSeconds(row, startedAt)
    return off >= span.startSec && off < end
  })
  const rows = inBar.filter((row) => !row.missing)
  const n = rows.length
  const mean = (f: (row: AnalyticsMinuteRollup) => number | null | undefined, list = rows) => {
    const values = list.map(f).filter((v): v is number => v != null && Number.isFinite(v))
    return values.length ? sum(values, (v) => v) / values.length : null
  }
  const peakOf = (f: (row: AnalyticsMinuteRollup) => number | null | undefined, list = rows) => {
    if (list.length < 2) return null
    let best: AnalyticsMinuteRollup | null = null
    for (const row of list) {
      const v = f(row)
      if (v == null || !Number.isFinite(v)) continue
      if (!best || v > (f(best) ?? -1)) best = row
    }
    return best ? { value: f(best) as number, at: formatStripClock(rollupOffsetSeconds(best, startedAt)) } : null
  }

  // figures: session order viewers, chat, emotes; viewers carry their sampling or peak, never "× usual" (F8)
  const vRows = rows.filter((row) => row.viewerAvg != null && Number.isFinite(row.viewerAvg))
  const viewers = mean((row) => row.viewerAvg, vRows)
  const vSub = !n ? null : !vRows.length ? 'Not sampled' : vRows.length < n ? `sampled ${vRows.length}/${n} min` : null
  const vPeak = vRows.length > 1 ? peakOf((row) => row.viewerMax ?? row.viewerAvg, vRows) : null
  const chat = mean((row) => row.chatCount)
  const emotes = mean((row) => minuteEmoteTotal(row))
  const chatPeak = peakOf((row) => row.chatCount)
  const emotePeak = peakOf((row) => minuteEmoteTotal(row))
  const tipOf = (peak: { value: number; at: string } | null, extra?: string | null) =>
    [peak ? `Peak ${stripInt(peak.value)} at ${peak.at}` : null, extra ?? null].filter(Boolean).join(' · ') || null
  const figures: StripFigure[] = [
    {
      key: 'viewers', label: 'viewers', value: viewers == null ? null : Math.round(viewers),
      third: vSub ?? (vPeak ? `peak ${stripInt(vPeak.value)}` : null), tip: tipOf(vPeak, vSub),
    },
    { key: 'chat', label: 'chat/min', value: chat == null ? null : Math.round(chat), third: null, tip: tipOf(chatPeak) },
    { key: 'emotes', label: 'emotes/min', value: emotes == null ? null : Math.round(emotes), third: null, tip: tipOf(emotePeak) },
  ]

  // top emotes: the bar's per-minute named lists merged, per minute; exact only for one minute
  const merged: Record<string, number> = {}
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.emotes ?? {})) {
      if (Number.isFinite(value) && value > 0) merged[key] = (merged[key] ?? 0) + value
    }
  }
  const hits = rows.length
    ? topEmotesFromRollup({ minuteTs: rows[0]!.minuteTs, emotes: merged }, 10, topEmotesCatalog)
    : []
  const topEmotes: StripEmote[] = hits.map((hit) => ({
    key: hit.key,
    code: hit.name,
    count: hit.count,
    perMin: n > 0 ? hit.count / n : null,
    imageUrl: getEmoteImageUrl(hit) || null,
  }))
  const emoteTotal = sum(rows, (row) => minuteEmoteTotal(row))
  const namedPct = emoteTotal > 0 ? Math.round((sum(Object.values(merged), (v) => v) / emoteTotal) * 1000) / 10 : null
  const namedNote = namedPct != null && namedPct < NAMED_MIN_PCT
    ? `Names for ${namedPct < 1 ? '<1' : Math.round(namedPct)}% of emote uses`
    : null

  // 7TV is complete; "other" = the emotes total minus 7TV, so the two add up to emotes/min
  const svRows = rows.filter((row) => row.seventvEmoteCount != null && Number.isFinite(row.seventvEmoteCount))
  const sevenTv = n && svRows.length ? Math.round(sum(svRows, (row) => row.seventvEmoteCount ?? 0) / n) : null
  const providers = sevenTv != null && emotes != null
    ? { sevenTv, other: Math.max(0, Math.round(emotes) - sevenTv) }
    : null

  // category: the game covering most of the bar; a switch inside the bar reads in time order
  let category: SessionBarStripModel['category'] = null
  let categorySwitch: string | null = null
  const games = (args.games ?? []).filter((g) => g.gameName?.trim() && Number.isFinite(g.offsetSeconds) && Number.isFinite(g.durationSeconds))
  if (games.length) {
    const segs = games
      .map((g) => ({ g, ov: Math.min(end, g.offsetSeconds + g.durationSeconds) - Math.max(span.startSec, g.offsetSeconds) }))
      .filter((x) => x.ov > 0)
    const main = segs.slice().sort((a, b) => b.ov - a.ov)[0]
    if (main) category = { name: main.g.gameName.trim(), artUrl: resolveGameArtUrl(main.g.boxArtUrl, main.g.categoryId, main.g.gameName) }
    const ordered = segs.slice().sort((a, b) => a.g.offsetSeconds - b.g.offsetSeconds)
    if (ordered.length > 1) {
      categorySwitch = ordered
        .map((x, i) => (i ? `${x.g.gameName.trim()} at ${formatStripClock(x.g.offsetSeconds)}` : x.g.gameName.trim()))
        .join(' → ')
    }
  } else if (args.gameName?.trim()) {
    category = { name: args.gameName.trim(), artUrl: resolveGameArtUrl(undefined, undefined, args.gameName.trim()) }
  }

  // moments in the bar, in rank order; the locked one is marked
  const lockedOff = args.lockedMomentOffsetSeconds
  const moments: StripMomentItem[] = (args.moments ?? [])
    .filter(({ moment }) => momentInSpan(moment, { startSec: span.startSec, endSec: end }))
    .map(({ rank, moment }) => {
      const offsetSec = recapMomentAnalyticalOffset(moment)
      const exact = resolveMomentRowRollup({ moment, rollups: args.rollups as AnalyticsMinuteRollup[], streamStartedAt: startedAt })
      const exactTotal = exact ? minuteEmoteTotal(exact) : 0
      const exactNamed = exact ? sum(Object.values(exact.emotes ?? {}), (v) => v) : 0
      const fewNames = exact != null && exactTotal > 0 && (exactNamed / exactTotal) * 100 < NAMED_MIN_PCT
      const top = fewNames ? null : stripMomentEmotes({
        moment, rollups: args.rollups as AnalyticsMinuteRollup[], streamStartedAt: startedAt, topEmotesCatalog,
      }).emotes[0] ?? null
      return {
        key: `m${offsetSec}`,
        rank,
        offsetSec,
        offsetLabel: formatStripClock(offsetSec),
        label: barMomentLabel(moment),
        topEmote: top ? { code: top.name, count: top.count, imageUrl: getEmoteImageUrl(top) || null } : null,
        locked: lockedOff != null && Number.isFinite(lockedOff) && Math.abs(lockedOff - offsetSec) < 1,
        moment,
      }
    })
  const lockedMoment = moments.find((m) => m.locked) ?? null

  // VOD: Play + lead-in only when the VOD is linked and its alignment is a number (PORT-PLAN §2.4)
  const linked = args.vodLinkState.status === 'linked'
  const candidateId = args.vodId ?? args.vodLinkState.vodId ?? null
  const vodId = linked && candidateId && VOD_ID.test(candidateId) ? candidateId : null
  const align = typeof args.vodAlignSeconds === 'number' && Number.isFinite(args.vodAlignSeconds) ? args.vodAlignSeconds : null
  const duration = args.vodDurationSeconds ?? undefined
  const unitMinute = end - span.startSec <= 60
  let vod: StripVod
  const vodAt = (off: number) => (align == null ? undefined : alignedVodOffset(off, align, duration))
  const frameMid = (a: number, b: number) => {
    const v = vodAt(a + (b - a) / 2)
    return v == null ? null : v
  }
  if (!vodId) {
    const pending = args.vodLinkState.status === 'live' || args.vodLinkState.status === 'syncing'
    vod = {
      vodId: null, playAt: null, playVerb: 'Play from', leadCaption: null, open: null,
      message: pending || !args.vodLinkState.label ? 'No VOD for this stream yet.' : args.vodLinkState.label,
      subjectVodStart: null, frameVodOffset: null, subject: lockedMoment ? 'moment' : unitMinute ? 'minute' : 'bar',
    }
  } else if (align == null) {
    // prod's rule: no timed jump without verified alignment, only the full VOD
    vod = {
      vodId, playAt: null, playVerb: 'Play from', leadCaption: null,
      open: { href: buildTwitchVodUrl(vodId), label: 'Open full VOD' },
      message: 'Timestamp alignment is not verified.',
      subjectVodStart: null, frameVodOffset: null, subject: lockedMoment ? 'moment' : unitMinute ? 'minute' : 'bar',
    }
  } else if (lockedMoment) {
    // the bar holds the locked moment: the strip shows that moment's player (session-original.js modelFor, F23)
    const playAt = momentPlayAt(lockedMoment.moment, align, duration)
    vod = {
      vodId, playAt, playVerb: 'Play VOD from',
      leadCaption: playAt == null ? null : { leadSeconds: VOD_LEAD_SECONDS, alignSeconds: align },
      open: playAt == null ? { href: buildTwitchVodUrl(vodId), label: 'Open full VOD' }
        : { href: buildTwitchVodUrl(vodId, playAt), label: `Open VOD at ${formatStripClock(playAt)}` },
      message: playAt == null ? "This minute isn't in the VOD yet." : null,
      subjectVodStart: vodAt(lockedMoment.offsetSec) ?? null,
      frameVodOffset: frameMid(lockedMoment.offsetSec, lockedMoment.offsetSec + 60),
      subject: 'moment',
    }
  } else {
    const jump = vodAt(span.startSec)
    vod = {
      vodId, playAt: jump ?? null, playVerb: 'Play from', leadCaption: null,
      open: jump == null ? { href: buildTwitchVodUrl(vodId), label: 'Open full VOD' }
        : { href: buildTwitchVodUrl(vodId, jump), label: `Open VOD at ${formatStripClock(jump)}` },
      message: jump == null ? "This minute isn't in the VOD yet." : null,
      subjectVodStart: jump ?? null,
      frameVodOffset: frameMid(span.startSec, end),
      subject: unitMinute ? 'minute' : 'bar',
    }
  }

  const startLabel = formatStripClock(span.startSec)
  const endLabel = formatStripClock(end)
  const clockLabel = Number.isFinite(startMs)
    ? stripClockRange(startMs + span.startSec * 1000, startMs + end * 1000, timeZone)
    : ''
  return {
    span: { startSec: span.startSec, endSec: end, levelMinutes: bm },
    title: bm === 1 && n > 0 ? startLabel : `${startLabel}–${endLabel}`,
    startLabel,
    endLabel,
    clockLabel,
    zone: Number.isFinite(startMs) ? zoneLabel(startMs + span.startSec * 1000, timeZone) : '',
    coverage: {
      measured: n,
      total: bm,
      partial: n < bm,
      label: n >= bm ? `Full ${bm} min` : `${n} of ${bm} min measured`,
    },
    figures,
    topEmotes,
    topEmotesExact: n === 1,
    namedNote,
    providers,
    category,
    categorySwitch,
    moments,
    lockedMoment,
    vod,
    gap: n === 0,
  }
}
