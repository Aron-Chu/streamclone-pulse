/**
 * The d3-v5 hub's bar card (R5-8 option A, Aron 2026-10-15: "i think a is fine"):
 * the numbers for one chart bar, shown as a strip under the chart. A port of the
 * mockup's round3-model.js `bucket()` arithmetic and round3-ui.js `modelA`,
 * without R5-18 (the bar's top channels) and R5-23 (the tidied card), which
 * wait for Aron.
 *
 * Every figure is read from `hub.activity.points` (bucket TOTALS over
 * `bucketMinutes`) and the hub's detected moments (`livePulseMoments`); the card
 * never fetches `/hub/moments`. Chat and emotes are divided by the minutes
 * actually measured; viewers are a roster sample and are averaged, never
 * divided. Nothing is scored or typed in.
 */
import type { HubActivityPoint, HubBucketEmote, HubLivePulseMoment } from '../../../../lib/publicHub'
import { formatHubCardInt, formatHubCardRate, hubCardClockRange, type HubCardFormatOptions } from '../../../../lib/hubBucketCardModel'
import { momentHref } from './hubV5Model'

/** prod's hub card copy (one name for one thing on both pages). */
export const HUB_V5_BAR_STATE = 'Bucket selected'
/** The card lists this many detected moments and this many top emotes. */
export const HUB_V5_BAR_MOMENTS = 3
export const HUB_V5_BAR_EMOTES = 3

export interface HubV5BarFig {
  key: 'chat' | 'emotes' | 'viewers'
  label: 'chat/min' | 'emotes/min' | 'viewers (sample)'
  value: number | null
  valueText: string
  /** The tile's third line: "peak 1.2K" for a merged bar, the viewer sample line. */
  third: string | null
  /** Hover text: the busiest bucket's figure and time. */
  title: string | null
}

export type HubV5BarFigKey = HubV5BarFig['key']

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

export interface HubV5BarMoment {
  key: string
  channel: string
  login: string
  avatar: string | null
  clockLabel: string
  label: string
  href: string
  topEmote: { name: string; count: number; imageUrl: string | null } | null
  aria: string
  moment: HubLivePulseMoment
}

export interface HubV5BarCardModel {
  key: string
  t: number
  end: number
  /** The bar's length in minutes (one server bucket or a merged zoomed-out bar). */
  minutes: number
  /** No chat or emote count in the bar: the card says "Not measured", never zeros. */
  gap: boolean
  /** "Bucket selected · 6 min" ("Bucket selected" on a gap). */
  stateLabel: string
  /** "12:00–12:06 PM" */
  title: string
  /** "Oct 19 local time" */
  when: string
  figs: [HubV5BarFig, HubV5BarFig, HubV5BarFig]
  topEmotes: HubV5BarEmote[]
  /** None of the shown emotes is a minimum. */
  topEmotesExact: boolean
  /** The Top emotes line when no emote is listed; "none named" only for a bar that counted zero emotes (pick 12A, 10-30). */
  topEmotesNote: string | null
  moments: { items: HubV5BarMoment[]; total: number; note: string | null }
  /** 7TV and other (the emotes total minus 7TV), only when every bucket certifies its provider counts. */
  providers: { sevenTv: number; other: number } | null
  notes: string[]
  /** The gap card's line. */
  reason: string | null
  /** One sentence for the live region. */
  summary: string
}

export interface HubV5BarCardInput {
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  /** The bar [t, endT) as the chart reports it. */
  t: number
  endT: number
  /** The hub's detected moments (`livePulseMoments`). */
  moments: readonly HubLivePulseMoment[]
  /** login → picture, for moments without their own. */
  avatars?: ReadonlyMap<string, string>
  format?: HubCardFormatOptions
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const mean = (values: readonly number[]) => (values.length ? sum(values) / values.length : null)

const goodChat = (p: HubActivityPoint) => p.hasChatRollup !== false && !p.gapKind && finite(p.chat)
const goodEmotes = (p: HubActivityPoint) => p.hasChatRollup !== false && !p.gapKind && finite(p.emotes)
/** Qualified viewer samples only; a corpus value that cannot join the roster never counts. */
const goodViewer = (p: HubActivityPoint) =>
  p.viewerCoverage != null && p.hasViewerRollup !== false && p.viewerSourceMismatch !== true && !p.gapKind && finite(p.viewers)

const PROVIDER_FIELDS = ['seventv', 'twitch', 'bttv', 'ffz', 'other'] as const

/** The mockup's emote identity: provider, image (the API sends no provider id), name. */
function emoteKey(e: Pick<HubBucketEmote, 'name' | 'provider' | 'imageUrl'>): string {
  return JSON.stringify([e.provider || 'unknown', e.imageUrl || '', e.name])
}

/** The card's clock: the nearest minute, so the card and the Moments row agree. */
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

/** Fits a phone tile; the tooltip has the full figure. */
function short(value: number): string {
  return value >= 1e4 ? `${(Math.round(value / 100) / 10).toLocaleString('en-US')}K` : formatHubCardInt(value)
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

/** The card for the bar [t, endT), or null when the bar holds no activity point. */
export function buildHubV5BarCard(input: HubV5BarCardInput): HubV5BarCardModel | null {
  const { format } = input
  const minutesPerBucket = input.bucketMinutes > 0 ? input.bucketMinutes : 1
  const slot = minutesPerBucket * 60_000
  if (!(finite(input.t) && finite(input.endT) && input.endT > input.t)) return null
  const members = input.points.filter((p) => p && finite(p.t) && p.t >= input.t && p.t < input.endT).slice().sort((a, b) => a.t - b.t)
  if (!members.length) return null
  const t = input.t
  const end = input.endT
  const minutes = Math.round((end - t) / 60_000)
  // Buckets the bar spans; a missing point is an unmeasured bucket, never a zero.
  const expected = Math.max(members.length, Math.round((end - t) / slot))
  const merged = expected > 1

  const chatRows = members.filter(goodChat)
  const emoteRows = members.filter(goodEmotes)
  const viewerRows = members.filter(goodViewer)
  const chatMinutes = chatRows.length * minutesPerBucket
  const emoteMinutes = emoteRows.length * minutesPerBucket
  const chat = chatMinutes ? sum(chatRows.map((p) => p.chat)) / chatMinutes : null
  const emotes = emoteMinutes ? sum(emoteRows.map((p) => p.emotes as number)) / emoteMinutes : null
  const viewers = mean(viewerRows.map((p) => p.viewers))
  const gap = !chatRows.length && !emoteRows.length

  const title = hubCardClockRange(t, end, format)
  const when = `${dateShort(t, format)} local time`
  const clock = (ms: number) => hubV5BarClock(ms, format)

  // The busiest bucket of a merged bar: its figure on the tile, its time in the tooltip.
  const peak = (key: HubV5BarFigKey): { value: number; t: number } | null => {
    if (!merged) return null
    const rows = key === 'viewers' ? viewerRows : key === 'emotes' ? emoteRows : chatRows
    if (!rows.length) return null
    const top = rows.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a))
    return { value: key === 'viewers' ? top.viewers : (top[key] as number) / minutesPerBucket, t: top.t }
  }
  const rateFig = (key: 'chat' | 'emotes', value: number | null): HubV5BarFig => {
    const p = peak(key)
    return {
      key,
      label: key === 'chat' ? 'chat/min' : 'emotes/min',
      value,
      valueText: formatHubCardInt(value),
      third: p ? `peak ${short(p.value)}` : null,
      title: p ? `Peak ${formatHubCardInt(p.value)} /min at ${clock(p.t)}` : null,
    }
  }
  const viewerPeak = peak('viewers')
  const viewerFig: HubV5BarFig = {
    key: 'viewers',
    label: 'viewers (sample)',
    value: viewers,
    valueText: formatHubCardInt(viewers),
    third: viewers == null
      ? 'not a full sample'
      : viewerRows.length < expected
        ? `${viewerRows.length} of ${expected} buckets sampled`
        : viewerPeak ? `peak ${short(viewerPeak.value)}` : null,
    title: viewerPeak ? `Peak ${formatHubCardInt(viewerPeak.value)} viewers at ${clock(viewerPeak.t)}` : null,
  }
  const figs: [HubV5BarFig, HubV5BarFig, HubV5BarFig] = [rateFig('chat', chat), rateFig('emotes', emotes), viewerFig]

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
      title: `${e.name}: ${topEmotesExact ? '' : 'at least '}${formatHubCardInt(e.count)} uses in this bucket, ${topEmotesExact ? '' : '≥'}${formatHubCardRate(e.perMin)}/min`,
    }
  })
  // A bar that counted emotes but whose reply sent no names (the 24h fallback's newest
  // minute) did not name none; the emotes/min tile's figure decides (pick 12A, 10-30).
  const topEmotesNote = topEmotes.length ? null : emotes === 0 ? 'none named in this bucket' : 'names not in this update'

  // Detected moments inside the bar (the hub sends its highest-scoring ones); each row opens in Moments.
  const lane = hubV5ChartMoments(input.points, minutesPerBucket, input.moments)
  const inside = lane.filter((m) => (m.at as number) >= t && (m.at as number) < end)
  const items: HubV5BarMoment[] = inside.map((m) => {
    const login = m.login as string
    const channel = m.displayName || login
    const clockLabel = clock(m.at as number)
    const label = m.label || 'Detected moment'
    const te = m.topEmotes?.[0]
    return {
      key: `${login}:${m.streamId ?? ''}:${m.offsetSeconds ?? ''}`,
      channel,
      login,
      avatar: m.profileImageUrl || input.avatars?.get(login) || null,
      clockLabel,
      label,
      href: momentHref(m),
      topEmote: te && typeof te.name === 'string' ? { name: te.name, count: te.count, imageUrl: te.imageUrl ?? null } : null,
      aria: `${channel} at ${clockLabel}, ${label}. Opens in Moments`,
      moment: m,
    }
  })
  const moments = { items, total: items.length, note: items.length ? null : `none of the hub’s ${lane.length}` }

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
  const notes = partial ? ['Some minutes in this bar were not measured. Gaps are not zero.'] : []

  const range = title.replace('–', ' to ')
  const summary = gap
    ? `${HUB_V5_BAR_STATE}, ${range}. Not measured.`
    : [
      `${HUB_V5_BAR_STATE}, ${range}`,
      `Chat ${figs[0].valueText} per minute`,
      `Emotes ${figs[1].valueText} per minute`,
      `Viewers ${figs[2].valueText}`,
      ...(items.length ? [`${items.length} ${items.length === 1 ? 'moment' : 'moments'}`] : []),
    ].join('. ') + '.'

  return {
    key: `${t}:${end}`,
    t,
    end,
    minutes,
    gap,
    stateLabel: gap ? HUB_V5_BAR_STATE : `${HUB_V5_BAR_STATE} · ${minutes} min`,
    title,
    when,
    figs,
    topEmotes,
    topEmotesExact,
    topEmotesNote,
    moments,
    providers,
    notes,
    reason: gap ? 'No chat or emote counts for this bar.' : null,
    summary,
  }
}
