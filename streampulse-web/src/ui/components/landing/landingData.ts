import type { PublicHub } from '../../../lib/publicHub'
import {
  LANDING_EMOTES,
  findLandingEmote,
  landingEmoteImageUrl,
} from './landingEmotes'

/** Compact integer formatting for landing visuals: 1234 -> "1.2K", 2_400_000 -> "2.4M". */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (abs >= 1_000) return `${trim(value / 1_000)}K`
  return `${Math.round(value)}`
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

/** Signed percentage label: 12.4 -> "+12%", -3 -> "-3%", 0 -> "flat". */
export function signedPct(value: number): string {
  if (!Number.isFinite(value) || Math.round(value) === 0) return 'flat'
  const rounded = Math.round(value)
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`
}

/** "now" | "2m ago" | "1h ago" from an epoch-seconds timestamp. */
export function shortAgo(atSeconds: number, nowMs = Date.now()): string {
  if (!Number.isFinite(atSeconds) || atSeconds <= 0) return 'now'
  const diffSec = Math.max(0, Math.round(nowMs / 1000 - atSeconds))
  if (diffSec < 45) return 'now'
  const min = Math.round(diffSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

export type Tone = 'up' | 'dn' | 'flat'

export interface TickerItem {
  /** Short lead glyph/emote token (text fallback when no image resolves). */
  lead: string
  label: string
  value: string
  delta?: string
  tone: Tone
  /** Emote (7TV) or channel-avatar image URL rendered as the visual lead. */
  image?: string
}

const EMOTE_BY_NAME = new Map<string, (typeof LANDING_EMOTES)[number]>(
  LANDING_EMOTES.map((emote) => [emote.name.toLowerCase(), emote]),
)

/** Resolve a landing CDN image for a known emote name (undefined if unmapped). */
function emoteImageByName(name: string): string | undefined {
  const emote = EMOTE_BY_NAME.get(name.trim().toLowerCase())
  return emote ? landingEmoteImageUrl(emote) : undefined
}

function nameOf(login: string, displayName?: string): string {
  const name = (displayName ?? '').trim()
  return name.length > 0 ? name : login
}

export function buildEmoteTicker(hub: PublicHub | null): TickerItem[] {
  const emotes = hub?.topEmotes ?? []
  if (emotes.length === 0) return []
  return emotes.slice(0, 10).map((emote) => ({
    lead: emote.name,
    label: emote.name,
    value: compact(emote.count),
    delta: emote.sharePct > 0 ? `${emote.sharePct.toFixed(1)}%` : undefined,
    tone: 'up' as Tone,
    image: emote.imageUrl ?? emoteImageByName(emote.name),
  }))
}

export function buildMoverTicker(hub: PublicHub | null): TickerItem[] {
  const movers = hub?.topMovers ?? []
  if (movers.length === 0) return []
  // No rank glyphs: leads are the channel initial (or real avatar) so the strip
  // reads as "channels with rising 7TV/min", not a fabricated #1/#2 leaderboard.
  return movers.slice(0, 8).map((mover) => {
    const name = nameOf(mover.login, mover.displayName)
    return {
      lead: (name[0] ?? '?').toUpperCase(),
      label: name,
      value: `${compact(mover.seventvPerMin)}/min`,
      delta: signedPct(mover.trendPct),
      tone: mover.trendPct > 1 ? 'up' : mover.trendPct < -1 ? 'dn' : 'flat',
      image: mover.profileImageUrl,
    }
  })
}

export interface HeatBar {
  /** 0..1 normalized height. */
  height: number
  level: 'base' | 'hot' | 'peak'
}

export interface PreviewMoment {
  time: string
  summary: string
  emote?: string
}

export interface PreviewModel {
  channel: string
  category: string
  viewers: string
  initial: string
  bars: HeatBar[]
  moments: PreviewMoment[]
  live: boolean
}

const FALLBACK_PREVIEW: PreviewModel = {
  channel: 'caseoh_',
  category: 'Just Chatting',
  viewers: '22.4K',
  initial: 'C',
  live: true,
  bars: barsFromValues([
    4, 5, 6, 5, 7, 8, 6, 9, 12, 10, 14, 18, 15, 22, 28, 24, 19, 16, 13, 17, 21, 26, 31, 27, 20, 15, 11, 9,
  ]),
  moments: [
    { time: '1:42:08', summary: 'Chat erupts — fall clip', emote: 'OMEGALUL' },
    { time: '1:18:51', summary: 'Donation read reaction', emote: 'Pog' },
    { time: '0:54:30', summary: 'Rage moment spike', emote: 'KEKW' },
  ],
}

export function barsFromValues(values: number[]): HeatBar[] {
  const safe = values.filter((v) => Number.isFinite(v) && v >= 0)
  if (safe.length === 0) return FALLBACK_PREVIEW.bars
  const max = Math.max(...safe, 1)
  return safe.map((value) => {
    const height = Math.max(0.12, value / max)
    const level: HeatBar['level'] = height >= 0.82 ? 'peak' : height >= 0.55 ? 'hot' : 'base'
    return { height, level }
  })
}

export function buildPreview(hub: PublicHub | null): PreviewModel {
  const top = (hub?.liveChannels ?? [])[0]
  if (!top) return FALLBACK_PREVIEW

  const points = hub?.activity.points ?? []
  const chatSeries = points.map((p) => p.chat)
  const bars = chatSeries.length >= 6 ? barsFromValues(chatSeries.slice(-28)) : FALLBACK_PREVIEW.bars

  const moments = (hub?.moments ?? [])
    .filter((m) => m.kind === 'chat_spike' || m.kind === 'emote_spike')
    .slice(0, 3)
    .map((m) => ({
      time: shortAgo(m.at),
      summary: m.label,
      emote: m.detail,
    }))

  const name = nameOf(top.login, top.displayName)
  return {
    channel: name,
    category: top.category?.trim() || 'Live channel',
    viewers: compact(top.viewers),
    initial: (name[0] ?? 'S').toUpperCase(),
    live: true,
    bars,
    moments: moments.length > 0 ? moments : FALLBACK_PREVIEW.moments,
  }
}

export interface ExtTile {
  label: string
  value: string
  sub: string
}

export interface ExtModel {
  channel: string
  category: string
  connectionOk: boolean
  syncLabel: string
  tiles: ExtTile[]
  wavePath: string
  reacted: PreviewMoment[]
}

const FALLBACK_EXT: ExtModel = {
  channel: 'caseoh_',
  category: 'Just Chatting · 1:42:18',
  connectionOk: true,
  syncLabel: 'syncing',
  tiles: [
    { label: 'Viewers', value: '22.4K', sub: '+3.1%' },
    { label: 'Chat/min', value: '482', sub: 'live' },
    { label: '7TV/min', value: '318', sub: '+24%' },
  ],
  wavePath: buildWavePath([6, 8, 7, 11, 16, 13, 22, 28, 21, 17, 25, 31, 24, 18, 14, 19], 600, 96),
  reacted: [
    { time: '1:42:08', summary: 'Fall clip', emote: 'OMEGALUL' },
    { time: '1:18:51', summary: 'Donation read', emote: 'Pog' },
    { time: '0:54:30', summary: 'Rage spike', emote: 'KEKW' },
  ],
}

/** Build a smooth-ish SVG polyline path across [0,width]x[0,height] (y inverted). */
export function buildWavePath(values: number[], width: number, height: number): string {
  const safe = values.filter((v) => Number.isFinite(v))
  if (safe.length < 2) return FALLBACK_EXT.wavePath
  const max = Math.max(...safe, 1)
  const min = Math.min(...safe, 0)
  const span = Math.max(1, max - min)
  const step = width / (safe.length - 1)
  const pad = height * 0.12
  return safe
    .map((value, index) => {
      const x = Math.round(index * step)
      const norm = (value - min) / span
      const y = Math.round(height - pad - norm * (height - pad * 2))
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

export function buildExtModel(hub: PublicHub | null): ExtModel {
  const top = (hub?.liveChannels ?? [])[0]
  if (!top) return FALLBACK_EXT

  const points = hub?.activity.points ?? []
  const chatSeries = points.map((p) => p.chat)
  const wavePath = chatSeries.length >= 4 ? buildWavePath(chatSeries.slice(-24), 600, 96) : FALLBACK_EXT.wavePath

  const reacted = (hub?.moments ?? [])
    .filter((m) => m.kind === 'chat_spike' || m.kind === 'emote_spike')
    .slice(0, 3)
    .map((m) => ({
      time: shortAgo(m.at),
      summary: m.label,
      emote: m.detail,
    }))

  const coverage = hub?.coverage
  return {
    channel: nameOf(top.login, top.displayName),
    category: top.category?.trim() || 'Live channel',
    connectionOk: coverage?.databaseOk ?? true,
    syncLabel: (coverage?.syncActive ?? 0) > 0 ? 'syncing' : 'idle',
    tiles: [
      { label: 'Viewers', value: compact(top.viewers), sub: signedPct(top.trendPct) },
      { label: 'Chat/min', value: compact(top.chatPerMin), sub: 'live' },
      { label: '7TV/min', value: compact(top.seventvPerMin), sub: 'live' },
    ],
    wavePath,
    reacted: reacted.length > 0 ? reacted : FALLBACK_EXT.reacted,
  }
}

export interface LiveSignalMoment {
  i: number
  time: string
  kind: string
  emoteImage: string
  count: number
  top?: boolean
}

export interface LiveSignalTopEmote {
  name: string
  count: number
  imageUrl: string
  pct: number
}

export interface LiveSignalChannel {
  login: string
  initial: string
  live: boolean
}

export interface LiveSignalFeaturedMoment {
  time: string
  kind: string
  chatPerMin: number
  emotesPerMin: number
}

export interface LiveSignalModel {
  min: number
  chat: number[]
  emotes: number[]
  sv: number[]
  viewers: number[]
  kpiViewers: number
  kpiChat: number
  kpiEmotes: number
  kpiSeventv: number
  kpiViewerDelta: string
  moments: LiveSignalMoment[]
  topEmotes: LiveSignalTopEmote[]
  channels: LiveSignalChannel[]
  axisStart: string
  axisMid: string
  featuredMoment: LiveSignalFeaturedMoment
  topEmoteCount: number
  topEmoteTotal: number
  trackedChannelCount: number
}

function formatAxisTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--'
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function findPeakIndices(values: number[], maxCount = 3): number[] {
  if (values.length < 3) return values.length > 0 ? [values.length - 1] : []
  const peaks: Array<{ i: number; v: number }> = []
  for (let i = 1; i < values.length - 1; i += 1) {
    const value = values[i] ?? 0
    if (value >= (values[i - 1] ?? 0) && value > (values[i + 1] ?? 0)) {
      peaks.push({ i, v: value })
    }
  }
  if (peaks.length === 0) return [values.length - 1]
  return peaks
    .sort((a, b) => b.v - a.v)
    .slice(0, maxCount)
    .sort((a, b) => a.i - b.i)
    .map((peak) => peak.i)
}

function resolveEmoteImage(name: string | undefined, imageUrl: string | undefined): string {
  if (imageUrl?.trim()) return imageUrl
  const mapped = name ? emoteImageByName(name) : undefined
  if (mapped) return mapped
  const fallback = findLandingEmote('peepoHappy')
  return fallback ? landingEmoteImageUrl(fallback) : ''
}

function buildLiveSignalMoment(
  index: number,
  points: Array<{ t: number }>,
  chat: number[],
  emotes: number[],
  emoteImage: string,
  top: boolean,
): LiveSignalMoment {
  const chatVal = chat[index] ?? 0
  const emoteVal = emotes[index] ?? 0
  return {
    i: index,
    time: formatAxisTime(points[index]?.t ?? Date.now()),
    kind: emoteVal > chatVal * 0.85 ? 'Emote spike' : 'Chat spike',
    emoteImage,
    count: Math.max(chatVal, emoteVal),
    top,
  }
}

/** Map hosted public hub activity into the landing live-signal scroll graph. */
export function buildLiveSignalModel(hub: PublicHub | null): LiveSignalModel | null {
  const rawPoints = hub?.activity.points ?? []
  if (rawPoints.length < 6) return null

  const points = rawPoints.length > 48 ? rawPoints.slice(-48) : rawPoints
  const min = points.length
  const chat = points.map((point) => Math.max(0, Math.round(point.chat)))
  const sv = points.map((point) => Math.max(0, Math.round(point.seventv)))
  const emotes = points.map((point, index) =>
    Math.max(sv[index] ?? 0, Math.round(Math.max(point.emotes ?? 0, point.seventv ?? 0))),
  )
  const viewers = points.map((point) => Math.max(0, Math.round(point.viewers)))

  const topChannel = hub?.liveChannels?.[0]
  const hubEmotes = hub?.topEmotes ?? []
  const topEmoteImage = resolveEmoteImage(hubEmotes[0]?.name, hubEmotes[0]?.imageUrl)

  const peakIndices = findPeakIndices(chat, 3)
  const loudestIndex = peakIndices.reduce(
    (best, index) => ((chat[index] ?? 0) + (emotes[index] ?? 0) > (chat[best] ?? 0) + (emotes[best] ?? 0) ? index : best),
    peakIndices[0] ?? min - 1,
  )
  const moments = peakIndices.map((index) =>
    buildLiveSignalMoment(index, points, chat, emotes, topEmoteImage, index === loudestIndex),
  )

  const topShare = Math.max(hubEmotes[0]?.sharePct ?? 1, 1)
  const topEmotes = hubEmotes.slice(0, 5).map((emote) => ({
    name: emote.name,
    count: emote.count,
    imageUrl: resolveEmoteImage(emote.name, emote.imageUrl),
    pct: Math.max(8, Math.round((emote.sharePct / topShare) * 100)),
  }))

  const channels = (hub?.liveChannels ?? []).slice(0, 8).map((channel) => {
    const label = nameOf(channel.login, channel.displayName)
    return {
      login: channel.login,
      initial: (label[0] ?? '?').toUpperCase(),
      live: true,
    }
  })

  const featured = moments.find((moment) => moment.top) ?? moments[moments.length - 1]
  const latestChat = chat[chat.length - 1] ?? 0
  const latestEmotes = emotes[emotes.length - 1] ?? 0

  return {
    min,
    chat,
    emotes,
    sv,
    viewers,
    kpiViewers: Math.round(topChannel?.viewers ?? viewers[viewers.length - 1] ?? 0),
    kpiChat: Math.round(topChannel?.chatPerMin ?? latestChat),
    kpiEmotes: Math.round(topChannel?.emotesPerMin ?? latestEmotes),
    kpiSeventv: Math.round(topChannel?.seventvPerMin ?? sv[sv.length - 1] ?? 0),
    kpiViewerDelta: topChannel ? `${signedPct(topChannel.trendPct)} · 5m` : 'rolling 5m',
    moments,
    topEmotes,
    channels,
    axisStart: formatAxisTime(points[0]?.t ?? 0),
    axisMid: formatAxisTime(points[Math.floor(min / 2)]?.t ?? 0),
    featuredMoment: {
      time: featured?.time ?? formatAxisTime(points[loudestIndex]?.t ?? Date.now()),
      kind: featured?.kind ?? 'Chat spike',
      chatPerMin: chat[loudestIndex] ?? latestChat,
      emotesPerMin: emotes[loudestIndex] ?? latestEmotes,
    },
    topEmoteCount: topEmotes.length,
    topEmoteTotal: hub?.emoteIntel?.uniqueEmotes ?? hubEmotes.length,
    trackedChannelCount: Math.max(hub?.poolSize ?? 0, channels.length),
  }
}
