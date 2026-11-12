/**
 * The hub bucket card's data model (plan §1.1 "Bucket card", §1.5, F4).
 *
 * A port of the d3-v2 mockup's `card-model.js` `hubBucket(t, endT)` without the client
 * "× usual" (card-model.js:44-52 has no API backing). Every figure is read from
 * `hub.activity.points` and the `hub/moments` responses; nothing is scored or typed in.
 *
 * Points hold bucket TOTALS over `bucketMinutes`; chat, emotes and provider tallies are
 * divided by the measured minutes for per-minute rates. Viewers are a roster sample and
 * are never divided.
 */
import type { HubActivityPoint, HubLivePulseMoment } from './publicHub'
import type { HubIntervalMomentsState } from './hubIntervalMoments'

export interface HubCardFormatOptions {
  /** BCP 47 locale list; defaults to the viewer's locale, like ActivityBucketInspector. */
  locale?: string | string[]
  /** IANA zone; defaults to the viewer's zone. Tests pin it. */
  timeZone?: string
}

export interface HubCardCategory {
  name: string
  boxArtUrl?: string | null
  categoryId?: string | null
}

export type HubCardTileKey = 'chat' | 'emotes' | 'viewers'

export interface HubCardPeak {
  value: number
  t: number
  clockLabel: string
}

export interface HubCardTile {
  key: HubCardTileKey
  /** Tile label as the F4 card prints it. */
  label: 'chat/min' | 'emotes/min' | 'viewers (sample)'
  value: number | null
  valueText: string
  /** The busiest server bucket inside a multi-bucket bar; null for one bucket. */
  peak: HubCardPeak | null
  /** The tile's second line: "peak N at 12:06 PM" for rates, the sample line for viewers. */
  secondLine: string | null
  /** Hover text with the full sample note and the peak. */
  tooltip: string | null
  /** Viewers only: the full sample sentence ("≈45 live · 1 of 2 intervals not a full sample"). */
  sub: string | null
}

export interface HubCardTopEmote {
  name: string
  provider: string | null
  imageUrl: string | null
  /** Uses inside the bar (raw). */
  count: number
  /** count / measured minutes: the card's unit. */
  perMin: number | null
  /** Name first, then the rate: "≥12" when summed across buckets. */
  rateText: string
}

export interface HubCardProvider {
  key: 'sevenTv' | 'other'
  label: '7TV' | 'other'
  value: number | null
  lowerBound: boolean
  valueText: string
}

export interface HubCardProviderTally {
  key: 'sevenTv' | 'twitch' | 'bttv' | 'ffz'
  label: '7TV' | 'Twitch' | 'BTTV' | 'FFZ'
  value: number | null
  lowerBound: boolean
}

export interface HubCardMomentItem {
  id: string
  channel: string
  login: string | null
  avatar: string | null
  category: string | null
  at: number | null
  clockLabel: string | null
  /** "1,333 chat/min · 4 emotes/min" */
  label: string
  chatPerMin: number | null
  emotesPerMin: number | null
  /** Backend comparison multiplier, only with at least 10 measured baseline minutes. Never a client score. */
  strength: number | null
  topEmote: { name: string; count: number; imageUrl: string | null } | null
  moment: HubLivePulseMoment
}

export type HubCardMomentsState = HubIntervalMomentsState['status'] | 'idle'

export interface HubCardMoments {
  state: HubCardMomentsState
  /** Sorted by chat/min, highest first (spec H4: no score). */
  items: HubCardMomentItem[]
  /** null until every bucket in the bar has answered. */
  total: number | null
  /** A bucket answered with the request limit, so there may be more. */
  totalIsMinimum: boolean
  /** "10+" / "3" */
  totalLabel: string | null
  /** "Show 10+ moments" when there is a list to open. */
  showLabel: string | null
  /** Loading / error / empty / zoom-in line (plan §1.8). */
  stateText: string | null
}

export interface HubBucketCardModel {
  scope: 'hub'
  key: string
  /** True when no point inside the bar was measured: the card says "Not measured", never zeros. */
  gap: boolean
  /** F4 eyebrow: "Bucket selected · 6 min". */
  stateLabel: string
  /** F4 title: the shared-period clock range, "12:00–12:06 PM". */
  title: string
  /** F4 meta line under the title: "Oct 11 MST". */
  clockLine: string
  range: {
    startT: number
    endT: number
    startLabel: string
    endLabel: string
    clockLabel: string
    dateLabel: string
    zone: string
  }
  bucketMinutes: number
  inProgress: boolean
  coverage: {
    label: string
    partial: boolean
    minutesMeasured: number
    minutesTotal: number
  }
  /** Hub buckets span many channels, so the art slot is usually empty. */
  category: HubCardCategory | null
  /** Ordered chat, emotes, viewers (the hub legend order). */
  tiles: [HubCardTile, HubCardTile, HubCardTile]
  topEmotes: HubCardTopEmote[]
  /** One bucket's top 10 is exact; summed across buckets an emote can miss a bucket's list. */
  topEmotesExact: boolean
  /** False when no point carries top emotes (a cache hydrate drops them until the next read). */
  topEmotesAvailable: boolean
  /** 7TV and other = emotes − 7TV, so the two add up to the emotes tile. */
  providers: [HubCardProvider, HubCardProvider]
  /** The separate per-provider tallies (they can count one use twice); hover text only. */
  providerDetail: HubCardProviderTally[]
  providerNote: string | null
  moments: HubCardMoments
  /** A hub interval spans many channels: never a VOD button (plan §1.5). */
  vod: null
  /** Accessible one-line summary of the card. */
  summary: string
}

export interface HubBucketCardInput {
  points: readonly HubActivityPoint[]
  /** The server bucket size (`hub.activity.bucketMinutes`). */
  bucketMinutes: number
  /** Any time inside the first server bucket of the bar. */
  t: number
  /** End of a zoomed-out bar; omitted for one server bucket. */
  endT?: number | null
  moments?: HubIntervalMomentsState | null
  category?: HubCardCategory | null
  format?: HubCardFormatOptions
}

/** Moments strings for the card and the interval list (plan §1.8; shipped as defaults pending Aron's OK). */
export const HUB_MOMENTS_TEXT = Object.freeze({
  loading: 'Loading moments…',
  /** The full line; "Retry" is the button. */
  error: "Moments didn't load · Retry",
  errorLead: "Moments didn't load",
  retry: 'Retry',
  /** The backend says the bucket's moments are unavailable: retrying will not help, so no button. */
  unavailable: "Moments didn't load",
  empty: 'No moments in this bucket',
  zoomIn: 'Zoom in to list moments',
})

export const HUB_CARD_STATE_WORD = 'Bucket selected'
export const HUB_CARD_STRENGTH_MIN_BASELINE_MINUTES = 10

const numberFormat = new Intl.NumberFormat('en-US')

/** Whole number with grouping, or "—" when there is no value. */
export function formatHubCardInt(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : numberFormat.format(Math.round(value))
}

/** Per-minute emote figure: whole numbers from 10, one decimal under 10, "<0.1" for traces. */
export function formatHubCardRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 10) return formatHubCardInt(value)
  if (value <= 0) return '0'
  if (value < 0.1) return '<0.1'
  return String(Math.round(value * 10) / 10)
}

function clockOptions(format?: HubCardFormatOptions): Intl.DateTimeFormatOptions {
  return { hour: 'numeric', minute: '2-digit', ...(format?.timeZone ? { timeZone: format.timeZone } : {}) }
}

function locale(format?: HubCardFormatOptions): string | string[] {
  return format?.locale ?? []
}

export function hubCardClock(ms: number, format?: HubCardFormatOptions): string {
  return new Date(ms).toLocaleTimeString(locale(format), clockOptions(format))
}

/** "12:00–12:06 PM" when both ends share the day period, else "11:54 AM–12:00 PM". */
export function hubCardClockRange(start: number, end: number, format?: HubCardFormatOptions): string {
  const formatter = new Intl.DateTimeFormat(locale(format), clockOptions(format))
  const a = formatter.formatToParts(new Date(start))
  const b = formatter.formatToParts(new Date(end))
  const period = (parts: Intl.DateTimeFormatPart[]) => parts.find(part => part.type === 'dayPeriod')?.value
  const bare = (parts: Intl.DateTimeFormatPart[]) => parts
    .filter(part => part.type !== 'dayPeriod')
    .map(part => part.value)
    .join('')
    .trim()
  if (period(a) && period(a) === period(b)) return `${bare(a)}–${hubCardClock(end, format)}`
  return `${hubCardClock(start, format)}–${hubCardClock(end, format)}`
}

/** The viewer's short zone name ("MST"); same rule as ActivityBucketInspector. */
export function hubCardZoneLabel(ms: number, format?: HubCardFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale(format), {
      timeZoneName: 'short',
      ...(format?.timeZone ? { timeZone: format.timeZone } : {}),
    }).formatToParts(new Date(ms)).find(part => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

function dateShort(ms: number, format?: HubCardFormatOptions): string {
  return new Date(ms).toLocaleDateString(locale(format), {
    month: 'short',
    day: 'numeric',
    ...(format?.timeZone ? { timeZone: format.timeZone } : {}),
  })
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Chat is measured unless the backend attested a gap or the client filled the grid. */
function measured(point: HubActivityPoint): boolean {
  return point.gapKind == null && point.hasChatRollup !== false && finite(point.chat)
}

/** Plan §1.5: viewers come from qualified buckets only (`viewerCoverage != null`). */
function qualifiedViewers(point: HubActivityPoint): boolean {
  return measured(point)
    && point.viewerCoverage != null
    && point.hasViewerRollup !== false
    && point.viewerSourceMismatch !== true
    && finite(point.viewers)
}

function providerFlag(point: HubActivityPoint, field: string): boolean {
  const entry = point.providerCoverage?.[field]
  return typeof entry === 'object' && entry !== null && entry.lowerBound === true
}

const PROVIDERS: ReadonlyArray<[HubCardProviderTally['key'], 'seventv' | 'twitch' | 'bttv' | 'ffz', HubCardProviderTally['label']]> = [
  ['sevenTv', 'seventv', '7TV'],
  ['twitch', 'twitch', 'Twitch'],
  ['bttv', 'bttv', 'BTTV'],
  ['ffz', 'ffz', 'FFZ'],
]

function momentBaselineMinutes(moment: HubLivePulseMoment): number | null {
  const comparison = moment.comparison
  if (!comparison) return null
  const fromWindow = comparison.baselineWindow?.measuredMinutes
  if (finite(fromWindow)) return fromWindow
  const fromEvidence = comparison.evidence?.baselineMeasuredMinutes
  return finite(fromEvidence) ? fromEvidence : null
}

/** The larger backend multiplier of a ready metric, only with ≥10 measured baseline minutes. */
export function hubMomentStrength(moment: HubLivePulseMoment): number | null {
  const minutes = momentBaselineMinutes(moment)
  if (minutes == null || minutes < HUB_CARD_STRENGTH_MIN_BASELINE_MINUTES) return null
  const comparison = moment.comparison!
  const values = [comparison.chat, comparison.emotes]
    .filter(metric => metric?.state === 'ready' && finite(metric.multiplier) && metric.multiplier > 0)
    .map(metric => metric!.multiplier as number)
  return values.length ? Math.max(...values) : null
}

function momentItem(moment: HubLivePulseMoment, format?: HubCardFormatOptions): HubCardMomentItem {
  const login = moment.login ?? null
  const at = finite(moment.at) ? moment.at : null
  const top = moment.topEmotes?.[0]
  return {
    id: moment.publicMomentId
      ?? `${login ?? moment.streamId ?? 'moment'}:${at ?? moment.offsetSeconds}`,
    channel: moment.displayName || login || '—',
    login,
    avatar: moment.profileImageUrl ?? null,
    category: moment.category ?? null,
    at,
    clockLabel: at == null ? null : hubCardClock(at, format),
    label: `${formatHubCardInt(moment.chatPerMin)} chat/min · ${formatHubCardInt(moment.emotesPerMin)} emotes/min`,
    chatPerMin: finite(moment.chatPerMin) ? moment.chatPerMin : null,
    emotesPerMin: finite(moment.emotesPerMin) ? moment.emotesPerMin : null,
    strength: hubMomentStrength(moment),
    topEmote: top ? { name: top.name, count: top.count, imageUrl: top.imageUrl ?? null } : null,
    moment,
  }
}

/** Sort for the card and the interval list: chat/min, highest first; ties keep time order. */
export function sortHubMomentsByChat(rows: readonly HubLivePulseMoment[]): HubLivePulseMoment[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => ((b.row.chatPerMin ?? -1) - (a.row.chatPerMin ?? -1))
      || ((a.row.at ?? 0) - (b.row.at ?? 0))
      || (a.index - b.index))
    .map(entry => entry.row)
}

function showLabel(total: number, minimum: boolean): string {
  return `Show ${total}${minimum ? '+' : ''} moment${total === 1 && !minimum ? '' : 's'}`
}

export function hubCardMoments(
  state: HubIntervalMomentsState | null | undefined,
  format?: HubCardFormatOptions,
): HubCardMoments {
  if (!state) {
    return { state: 'idle', items: [], total: null, totalIsMinimum: false, totalLabel: null, showLabel: null, stateText: null }
  }
  switch (state.status) {
    case 'zoom-in':
      return { state: 'zoom-in', items: [], total: null, totalIsMinimum: false, totalLabel: null, showLabel: null, stateText: HUB_MOMENTS_TEXT.zoomIn }
    case 'loading':
      return { state: 'loading', items: [], total: null, totalIsMinimum: false, totalLabel: null, showLabel: null, stateText: HUB_MOMENTS_TEXT.loading }
    case 'error':
      return { state: 'error', items: [], total: null, totalIsMinimum: false, totalLabel: null, showLabel: null, stateText: HUB_MOMENTS_TEXT.error }
    case 'unavailable':
      return { state: 'unavailable', items: [], total: null, totalIsMinimum: false, totalLabel: null, showLabel: null, stateText: HUB_MOMENTS_TEXT.unavailable }
    case 'empty':
      return { state: 'empty', items: [], total: 0, totalIsMinimum: false, totalLabel: '0', showLabel: null, stateText: HUB_MOMENTS_TEXT.empty }
    case 'ready': {
      const items = sortHubMomentsByChat(state.rows).map(row => momentItem(row, format))
      return {
        state: 'ready',
        items,
        total: state.total,
        totalIsMinimum: state.atLimit,
        totalLabel: state.totalLabel,
        showLabel: state.total > 0 ? showLabel(state.total, state.atLimit) : null,
        stateText: null,
      }
    }
  }
}

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  let total = 0
  for (const row of rows) total += pick(row)
  return total
}

/**
 * The card model for the bar [t, endT). Returns null when no point holds t.
 * A bar wider than one server bucket snaps its end to whole buckets, like the chart.
 */
export function buildHubBucketCardModel(input: HubBucketCardInput): HubBucketCardModel | null {
  const { points, t, endT, format } = input
  const bucketMinutes = input.bucketMinutes > 0 ? input.bucketMinutes : 1
  const slot = bucketMinutes * 60_000
  const first = points.find(point => t >= point.t && t < point.t + slot)
  if (!first) return null
  const start = first.t
  const end = endT != null && endT > start + slot
    ? start + Math.round((endT - start) / slot) * slot
    : start + slot
  const members = points.filter(point => point.t >= start && point.t < end)
  const measuredMembers = members.filter(measured)
  const nominal = (end - start) / 60_000
  const measuredMinutes = measuredMembers.length * bucketMinutes
  const single = members.length === 1
  const gap = measuredMembers.length === 0

  const perMin = (field: 'chat' | 'emotes' | 'seventv' | 'twitch' | 'bttv' | 'ffz'): number | null => {
    const rows = measuredMembers.filter(point => finite(point[field]))
    return rows.length ? sum(rows, point => point[field] as number) / (rows.length * bucketMinutes) : null
  }
  const peakOf = (field: 'chat' | 'emotes'): HubCardPeak | null => {
    if (single) return null
    const rows = measuredMembers.filter(point => finite(point[field]))
    if (rows.length < 2) return null
    const top = rows.reduce((a, b) => ((b[field] as number) > (a[field] as number) ? b : a))
    return { value: Math.round((top[field] as number) / bucketMinutes), t: top.t, clockLabel: hubCardClock(top.t, format) }
  }

  const chat = perMin('chat')
  const emotes = perMin('emotes')

  const viewerRows = members.filter(qualifiedViewers)
  const viewers = viewerRows.length ? sum(viewerRows, point => point.viewers) / viewerRows.length : null
  const liveRows = viewerRows.filter(point => finite(point.viewerContributors))
  const live = liveRows.length ? sum(liveRows, point => point.viewerContributors as number) / liveRows.length : null
  let viewerSub: string
  if (!viewerRows.length) {
    viewerSub = 'Not a full sample'
  } else {
    const approx = viewerRows.length > 1 ? '≈' : ''
    const parts: string[] = []
    if (live != null) parts.push(`${approx}${Math.round(live)} live`)
    if (viewerRows.length < members.length) {
      parts.push(`${members.length - viewerRows.length} of ${members.length} intervals not a full sample`)
    }
    viewerSub = parts.join(' · ')
  }
  const viewerPeak: HubCardPeak | null = single || viewerRows.length < 2
    ? null
    : (() => {
      const top = viewerRows.reduce((a, b) => (b.viewers > a.viewers ? b : a))
      return { value: top.viewers, t: top.t, clockLabel: hubCardClock(top.t, format) }
    })()

  const rateTile = (key: 'chat' | 'emotes', value: number | null): HubCardTile => {
    const peak = peakOf(key)
    return {
      key,
      label: key === 'chat' ? 'chat/min' : 'emotes/min',
      value: value == null ? null : Math.round(value),
      valueText: formatHubCardInt(value),
      peak,
      secondLine: peak ? `peak ${formatHubCardInt(peak.value)} at ${peak.clockLabel}` : null,
      tooltip: peak ? `Peak ${formatHubCardInt(peak.value)} at ${peak.clockLabel}` : null,
      sub: null,
    }
  }
  const viewerShort = viewerSub ? viewerSub.split(' · ')[0] : null
  const viewerTooltip = [
    viewerPeak ? `Peak ${formatHubCardInt(viewerPeak.value)} at ${viewerPeak.clockLabel}` : null,
    viewerSub && viewerSub !== viewerShort ? viewerSub : null,
  ].filter(Boolean).join(' · ')
  const tiles: [HubCardTile, HubCardTile, HubCardTile] = [
    rateTile('chat', chat),
    rateTile('emotes', emotes),
    {
      key: 'viewers',
      label: 'viewers (sample)',
      value: viewers == null ? null : Math.round(viewers),
      valueText: formatHubCardInt(viewers),
      peak: viewerPeak,
      secondLine: viewerShort || (viewerPeak ? `peak ${formatHubCardInt(viewerPeak.value)}` : null),
      tooltip: viewerTooltip || null,
      sub: viewerSub || null,
    },
  ]

  // Top emotes: merged by name + provider + image, so two different "om" images never merge.
  const merged = new Map<string, { name: string; provider: string | null; imageUrl: string | null; count: number }>()
  let topEmotesAvailable = false
  for (const point of measuredMembers) {
    if (!point.topEmotes?.length) continue
    topEmotesAvailable = true
    for (const emote of point.topEmotes) {
      if (!emote || typeof emote.name !== 'string' || !finite(emote.count)) continue
      const key = `${emote.name}|${emote.provider ?? ''}|${emote.imageUrl ?? ''}`
      const prev = merged.get(key)
      if (prev) prev.count += emote.count
      else merged.set(key, { name: emote.name, provider: emote.provider ?? null, imageUrl: emote.imageUrl ?? null, count: emote.count })
    }
  }
  const topEmotesExact = measuredMembers.length === 1
  const topEmotes: HubCardTopEmote[] = [...merged.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((emote) => {
      const rate = measuredMinutes > 0 ? emote.count / measuredMinutes : null
      return { ...emote, perMin: rate, rateText: `${topEmotesExact ? '' : '≥'}${formatHubCardRate(rate)}` }
    })

  const countsLowerBound = measuredMembers.some(point => point.providerCountsLowerBound === true)
  const providerDetail: HubCardProviderTally[] = PROVIDERS.map(([key, field, label]) => {
    const value = perMin(field)
    const flagged = measuredMembers.some(point => providerFlag(point, field))
    return {
      key,
      label,
      value: value == null ? null : Math.round(value),
      lowerBound: key === 'sevenTv' ? flagged : countsLowerBound || flagged,
    }
  })
  const sevenTv = providerDetail[0]
  const otherValue = sevenTv.value == null || emotes == null ? null : Math.max(0, Math.round(emotes) - sevenTv.value)
  const providers: [HubCardProvider, HubCardProvider] = [
    {
      key: 'sevenTv',
      label: '7TV',
      value: sevenTv.value,
      lowerBound: sevenTv.lowerBound,
      valueText: `${sevenTv.lowerBound && sevenTv.value != null ? '≥' : ''}${formatHubCardInt(sevenTv.value)}`,
    },
    {
      key: 'other',
      label: 'other',
      value: otherValue,
      // plan §1.5: "≥" when the bucket's provider counts are a lower bound
      lowerBound: countsLowerBound,
      valueText: `${countsLowerBound && otherValue != null ? '≥' : ''}${formatHubCardInt(otherValue)}`,
    },
  ]
  const tallies = providerDetail.filter(provider => provider.value != null)
  const providerNote = tallies.length
    ? `Separate tallies per provider, per min: ${tallies.map(provider => `${provider.label} ${provider.lowerBound ? '≥' : ''}${formatHubCardInt(provider.value)}`).join(' · ')}. They can count one use twice, so the card shows 7TV and the rest of the total.`
    : null

  const moments = hubCardMoments(input.moments, format)
  const range = {
    startT: start,
    endT: end,
    startLabel: hubCardClock(start, format),
    endLabel: hubCardClock(end, format),
    clockLabel: hubCardClockRange(start, end, format),
    dateLabel: dateShort(start, format),
    zone: hubCardZoneLabel(start, format),
  }
  // A missing flag on a legacy point reads as closed, as in ActivityBucketInspector (`bucketComplete === false`).
  const inProgress = members.some(point => point.bucketComplete === false)
  const coverage = {
    label: measuredMinutes >= nominal ? `Full ${nominal} min` : `${measuredMinutes} of ${nominal} min measured`,
    partial: measuredMinutes < nominal,
    minutesMeasured: measuredMinutes,
    minutesTotal: nominal,
  }
  const stateLabel = gap ? HUB_CARD_STATE_WORD : `${HUB_CARD_STATE_WORD} · ${nominal} min`

  const summaryParts = [`${HUB_CARD_STATE_WORD}, ${range.clockLabel.replace('–', ' to ')}${inProgress ? ', in progress' : ''}`]
  if (gap) summaryParts.push('Not measured')
  else {
    summaryParts.push(`Chat ${tiles[0].valueText} per minute`)
    summaryParts.push(`Emotes ${tiles[1].valueText} per minute`)
    summaryParts.push(`Viewers ${tiles[2].valueText}`)
    if (moments.total != null && moments.total > 0) {
      summaryParts.push(`${moments.total}${moments.totalIsMinimum ? ' or more' : ''} moments`)
    }
  }

  return {
    scope: 'hub',
    key: `hub:${start}-${end}`,
    gap,
    stateLabel,
    title: range.clockLabel,
    clockLine: [range.dateLabel, range.zone].filter(Boolean).join(' '),
    range,
    bucketMinutes: nominal,
    inProgress,
    coverage,
    category: input.category ?? null,
    tiles,
    topEmotes,
    topEmotesExact,
    topEmotesAvailable,
    providers,
    providerDetail,
    providerNote,
    moments,
    vod: null,
    summary: `${summaryParts.join('. ')}.`,
  }
}
