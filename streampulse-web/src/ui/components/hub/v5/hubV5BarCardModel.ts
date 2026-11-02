/**
 * The d3-v5 hub's bar lock (L1, bar-lock board 2026-11-01; was R5-8 option A's
 * card): one chart bar under the chart, in the emote lock's rows. Its numbers sit
 * in the readout above the chart (R1); this model holds the rest.
 *
 * The top emotes and the provider split are read from `hub.activity.points`
 * (bucket TOTALS over `bucketMinutes`), divided by the minutes actually measured.
 * The busiest chats come from one hub/moments read per server bucket
 * (lib/hubIntervalMoments): each row is a stream's busiest minute in the bar,
 * one row a channel, busiest chat first. The hub's own detected moments
 * (`livePulseMoments`) only mark the channels they name. Nothing is scored.
 */
import type { HubActivityPoint, HubBucketEmote, HubLivePulseMoment } from '../../../../lib/publicHub'
import { formatHubCardInt, formatHubCardRate, hubCardClockRange, sortHubMomentsByChat, type HubCardFormatOptions } from '../../../../lib/hubBucketCardModel'

/** The lock lists this many busiest chats and this many top emotes. */
export const HUB_V5_BAR_CHATS = 6
export const HUB_V5_BAR_EMOTES = 3

export interface HubV5BarEmote {
  key: string
  name: string
  imageUrl: string | null
  count: number
  perMin: number | null
  /** Missing from at least one measured bucket's top list, so the sum is a minimum. */
  lowerBound: boolean
  /** "≥12" for a minimum, "12" when exact. */
  rateText: string
  title: string
}

export interface HubV5BarCardModel {
  key: string
  t: number
  end: number
  /** The bar's slot in minutes (the chart's bar size), even where the window cuts it short. */
  minutes: number
  /** No chat or emote count in the bar: the lock says "Not measured", never zeros. */
  gap: boolean
  /** "12:00–12:06 PM" */
  title: string
  /** "Oct 19" */
  day: string
  /** The bar's slot runs past the newest closed bucket: its figures are so far. */
  soFar: boolean
  /** The bar reaches the newest closed bucket, so its streams may not be in yet. */
  newest: boolean
  topEmotes: HubV5BarEmote[]
  /** None of the shown emotes is a minimum. */
  topEmotesExact: boolean
  /** The Top emotes line when no emote is listed; "none named" only for a bar that counted zero emotes (pick 12A, 10-30). */
  topEmotesNote: string | null
  /** 7TV and other (the emotes total minus 7TV), only when every bucket certifies its provider counts. */
  providers: { sevenTv: number; other: number } | null
  /** Lowercase logins of the hub's own detected moments inside the bar ("Top moment"). */
  hubMoments: ReadonlySet<string>
  notes: string[]
  /** The gap line. */
  reason: string | null
  /** "12:00 to 12:06 PM", for the status line. */
  range: string
}

export interface HubV5BarCardInput {
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  /** The bar [t, endT) as the chart reports it, and its slot in minutes. */
  t: number
  endT: number
  barMinutes?: number
  /** The hub's detected moments (`livePulseMoments`). */
  moments: readonly HubLivePulseMoment[]
  format?: HubCardFormatOptions
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

const goodChat = (p: HubActivityPoint) => p.hasChatRollup !== false && !p.gapKind && finite(p.chat)
const goodEmotes = (p: HubActivityPoint) => p.hasChatRollup !== false && !p.gapKind && finite(p.emotes)

const PROVIDER_FIELDS = ['seventv', 'twitch', 'bttv', 'ffz', 'other'] as const

/** The mockup's emote identity: provider, image (the API sends no provider id), name. */
function emoteKey(e: Pick<HubBucketEmote, 'name' | 'provider' | 'imageUrl'>): string {
  return JSON.stringify([e.provider || 'unknown', e.imageUrl || '', e.name])
}

/** The lock's clock: the nearest minute, so the lock and the Moments row agree. */
export function hubV5BarClock(ms: number, format?: HubCardFormatOptions): string {
  return new Date(Math.round(ms / 60_000) * 60_000).toLocaleTimeString(format?.locale ?? [], {
    hour: 'numeric',
    minute: '2-digit',
    ...(format?.timeZone ? { timeZone: format.timeZone } : {}),
  })
}

function dateShort(ms: number, format?: HubCardFormatOptions): string {
  return new Date(ms).toLocaleDateString(format?.locale ?? [], {
    month: 'short',
    day: 'numeric',
    ...(format?.timeZone ? { timeZone: format.timeZone } : {}),
  })
}

/** The detected moments the chart draws: those inside its span (the mockup's lane markers), oldest first. */
export function hubV5ChartMoments(points: readonly HubActivityPoint[], bucketMinutes: number, moments: readonly HubLivePulseMoment[]): HubLivePulseMoment[] {
  const ordered = points.filter((p) => p && finite(p.t))
  if (!ordered.length) return []
  const first = Math.min(...ordered.map((p) => p.t))
  const end = Math.max(...ordered.map((p) => p.t)) + bucketMinutes * 60_000
  const id = (m: HubLivePulseMoment) => `${m.login ?? ''}:${m.streamId ?? ''}:${m.offsetSeconds ?? ''}`
  return moments
    .filter((m) => m && finite(m.at) && m.at >= first && m.at <= end && typeof m.login === 'string' && m.login)
    .slice()
    .sort((a, b) => (a.at as number) - (b.at as number) || id(a).localeCompare(id(b)))
}

/**
 * Where the closed buckets end: the open bucket's start when the reply sends one
 * (the chart never draws it), else the newest bucket's end.
 */
export function hubV5LiveEdge(points: readonly HubActivityPoint[], bucketMinutes: number): number | null {
  let last: HubActivityPoint | null = null
  for (const p of points) if (p && finite(p.t) && (!last || p.t > last.t)) last = p
  if (!last) return null
  return last.bucketComplete === true ? last.t + Math.max(1, bucketMinutes) * 60_000 : last.t
}

/**
 * The bar's busiest chats: each channel once, at its busiest minute in the bar,
 * busiest chat first, at most `limit`. Rows without a channel are left out.
 */
export function hubV5BarChats(rows: readonly HubLivePulseMoment[], limit = HUB_V5_BAR_CHATS): HubLivePulseMoment[] {
  const seen = new Set<string>()
  const out: HubLivePulseMoment[] = []
  for (const row of sortHubMomentsByChat(rows)) {
    const login = typeof row.login === 'string' ? row.login.toLowerCase() : ''
    if (!login || seen.has(login)) continue
    seen.add(login)
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

/** The lock for the bar [t, endT), or null when the bar holds no activity point. */
export function buildHubV5BarCard(input: HubV5BarCardInput): HubV5BarCardModel | null {
  const { format } = input
  const minutesPerBucket = input.bucketMinutes > 0 ? input.bucketMinutes : 1
  const slot = minutesPerBucket * 60_000
  if (!(finite(input.t) && finite(input.endT) && input.endT > input.t)) return null
  const members = input.points.filter((p) => p && finite(p.t) && p.t >= input.t && p.t < input.endT).slice().sort((a, b) => a.t - b.t)
  if (!members.length) return null
  const t = input.t
  const end = input.endT
  const minutes = finite(input.barMinutes) && input.barMinutes > 0 ? Math.round(input.barMinutes) : Math.round((end - t) / 60_000)
  // Buckets the bar spans; a missing point is an unmeasured bucket, never a zero.
  const expected = Math.max(members.length, Math.round((end - t) / slot))

  const chatRows = members.filter(goodChat)
  const emoteRows = members.filter(goodEmotes)
  const emoteMinutes = emoteRows.length * minutesPerBucket
  const emotes = emoteMinutes ? sum(emoteRows.map((p) => p.emotes as number)) / emoteMinutes : null
  const gap = !chatRows.length && !emoteRows.length

  const title = hubCardClockRange(t, end, format)
  // The bar's slot past the closed buckets is still filling; a bar that reaches them is the newest.
  const edge = hubV5LiveEdge(input.points, minutesPerBucket)
  const newest = edge != null && end >= edge
  const soFar = edge != null && t + minutes * 60_000 > edge

  // Top emotes: summed per bucket; an emote missing from one measured bucket's top list is a minimum.
  const tally = new Map<string, { key: string; name: string; imageUrl: string | null; count: number }>()
  for (const p of emoteRows) {
    for (const e of p.topEmotes ?? []) {
      if (!e || typeof e.name !== 'string' || !finite(e.count)) continue
      const key = emoteKey(e)
      const old = tally.get(key)
      if (old) old.count += e.count
      else tally.set(key, { key, name: e.name, imageUrl: e.imageUrl ?? null, count: e.count })
    }
  }
  const ranked = [...tally.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, HUB_V5_BAR_EMOTES)
    .map((e) => ({
      ...e,
      perMin: emoteMinutes ? e.count / emoteMinutes : null,
      lowerBound: emoteRows.some((p) => !(p.topEmotes ?? []).some((raw) => raw && emoteKey(raw) === e.key)),
    }))
  const topEmotesExact = !ranked.some((e) => e.lowerBound)
  const topEmotes: HubV5BarEmote[] = ranked.map((e) => {
    const mark = e.lowerBound ? '≥' : ''
    return {
      ...e,
      rateText: `${mark}${formatHubCardRate(e.perMin ?? e.count)}`,
      title: `${e.name}: ${e.lowerBound ? 'at least ' : ''}${formatHubCardInt(e.count)} uses in this bar, ${mark}${formatHubCardRate(e.perMin)} a minute`,
    }
  })
  // A bar that counted emotes but whose reply sent no names (the 24h fallback's newest
  // minute) did not name none; the emotes figure decides (pick 12A, 10-30).
  const topEmotesNote = topEmotes.length ? null : emotes === 0 ? 'none named in this bucket' : 'names not in this update'

  // The hub's own moments inside the bar mark their channel's row.
  const hubMoments = new Set(
    hubV5ChartMoments(input.points, minutesPerBucket, input.moments)
      .filter((m) => (m.at as number) >= t && (m.at as number) < end)
      .map((m) => (m.login as string).toLowerCase()),
  )

  // The split only when every bucket certifies complete provider counts that stay inside the total.
  const providerValid = emoteRows.length > 0 && emoteRows.length === members.length && members.every((p) =>
    p.providerCountsComplete === true
    && PROVIDER_FIELDS.every((k) => p[k] === undefined || (finite(p[k]) && (p[k] as number) >= 0))
    && sum(PROVIDER_FIELDS.map((k) => (p[k] as number | undefined) || 0)) <= (p.emotes as number))
  const providers = providerValid
    ? {
      sevenTv: sum(members.map((p) => p.seventv || 0)) / emoteMinutes,
      other: sum(members.map((p) => (p.emotes as number) - (p.seventv || 0))) / emoteMinutes,
    }
    : null

  const partial = chatRows.length !== expected || emoteRows.length !== expected
  const notes = !gap && partial ? ['Some minutes in this bar were not measured. Gaps are not zero.'] : []

  // The bar's slot at its level: a bar a poll grows (the newest) or trims (the oldest) keeps its key, so the lock does
  // not say itself again and its rows stay put while the new bucket reads.
  const slotMs = Math.max(1, minutes) * 60_000
  return {
    key: `${Math.floor(t / slotMs) * slotMs}:${minutes}`,
    t,
    end,
    minutes,
    gap,
    title,
    day: dateShort(t, format),
    soFar,
    newest,
    topEmotes,
    topEmotesExact,
    topEmotesNote,
    providers,
    hubMoments,
    notes,
    reason: gap ? 'No chat or emote counts for this bar.' : null,
    range: title.replace('–', ' to '),
  }
}
