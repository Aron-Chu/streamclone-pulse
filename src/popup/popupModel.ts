import type { ExtensionCoverageTierResponse, ExtensionRollup, PulsePayload } from '../shared/messages.ts'

/** What the active tab is, as far as the toolbar popup cares. */
export type PopupTabView =
  | { kind: 'elsewhere' }
  | { kind: 'browsing' }
  | { kind: 'vod'; vodId: string }
  | { kind: 'channel'; login: string }

// First path segments on twitch.tv that are product pages, not channels.
const TWITCH_RESERVED_ROUTES = new Set([
  'directory',
  'downloads',
  'drops',
  'friends',
  'inventory',
  'jobs',
  'messages',
  'p',
  'payments',
  'popout',
  'prime',
  'search',
  'settings',
  'subscriptions',
  'turbo',
  'videos',
  'wallet',
])

export function popupTabView(url: string | undefined): PopupTabView {
  if (!url) return { kind: 'elsewhere' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'elsewhere' }
  }
  if (parsed.protocol !== 'https:' || (parsed.hostname !== 'www.twitch.tv' && parsed.hostname !== 'twitch.tv')) {
    return { kind: 'elsewhere' }
  }
  const [segment, next] = parsed.pathname.split('/').filter(Boolean)
  // Replays carry their own Pulse chart beside chat.
  if (segment === 'videos' && next && /^\d+$/.test(next)) return { kind: 'vod', vodId: next }
  // Twitch logins are 1–25 word characters; anything else is a product page.
  if (!segment || TWITCH_RESERVED_ROUTES.has(segment.toLowerCase()) || !/^\w{1,25}$/.test(segment)) {
    return { kind: 'browsing' }
  }
  return { kind: 'channel', login: segment.toLowerCase() }
}

/**
 * Whether the popup may ask for "Jump back in": this profile's My Moments
 * history and device saves. The worker refuses My Moments for incognito
 * Twitch tabs by `sender.tab`, but a popup message has no tab, and in spanning
 * mode the worker never runs incognito, so only the popup knows it is showing
 * in a private window. A window the popup could not identify counts as private.
 */
export function popupShowsDeviceHistory(view: PopupTabView, incognito: boolean | undefined): boolean {
  return (view.kind === 'elsewhere' || view.kind === 'browsing') && incognito === false
}

const SAFE_IMAGE_HOSTS = new Set([
  'static-cdn.jtvnw.net',
  'cdn.7tv.app',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
])

/** Only render images from the emote and avatar CDNs the extension already trusts. */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && SAFE_IMAGE_HOSTS.has(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

export interface EmoteImage {
  src: string
  /** A still frame for reduced motion, when the CDN offers one. */
  still: string | null
}

/**
 * A crisp ~22 px emote from the hub's image URL. 7TV and Twitch both serve a
 * still variant, which reduced motion uses instead of the animation.
 */
export function emoteImage(value: string | null | undefined): EmoteImage | null {
  const safe = safeImageUrl(value)
  if (!safe) return null
  const url = new URL(safe)
  if (url.hostname === 'cdn.7tv.app') {
    const base = url.pathname.match(/^(\/emote\/[A-Za-z0-9]+)\//)?.[1]
    if (base) return { src: `https://cdn.7tv.app${base}/2x.webp`, still: `https://cdn.7tv.app${base}/2x_static.webp` }
  }
  if (url.hostname === 'static-cdn.jtvnw.net' && url.pathname.includes('/default/')) {
    return { src: safe, still: safe.replace('/default/', '/static/') }
  }
  return { src: safe, still: null }
}

export interface PopupMoment {
  label: string
  offsetSeconds: number
  /** Seconds before "now" on a live stream; null for a finished stream. */
  agoSeconds: number | null
}

export interface PopupChannelSummary {
  displayName: string
  isLive: boolean
  /** False when the channel sits outside the hosted Pulse roster. */
  tracked: boolean
  category: string | null
  uptime: string | null
  viewers: number | null
  /** Chat messages in the latest complete minute. */
  chatPerMinute: number | null
  /** One value per minute, oldest first; null marks a minute Pulse did not see. */
  spark: Array<number | null>
  sparkMinutes: number
  topEmote: { name: string; count: number; imageUrl: string | null } | null
  biggest: PopupMoment | null
  /** When the last broadcast ended, for an offline channel. */
  endedAt: number | null
}

const SPARK_LIVE_MINUTES = 30
const SPARK_MAX_POINTS = 48
const BUCKET_SECONDS = 60

export function summarizeChannel(
  login: string,
  payload: PulsePayload | null,
  coverage: ExtensionCoverageTierResponse | null | undefined,
  now = Date.now(),
): PopupChannelSummary {
  const live = coverage?.liveMetadata
  const isLive = payload?.isLive ?? live?.isLive === true
  const rollups = payload?.rollups ?? []
  const spark = isLive
    ? liveSpark(rollups, payload?.currentOffsetSeconds ?? 0)
    : downsample(finishedStreamRollups(payload))
  const topEmote = payload?.topEmotes?.find(emote => emote.count > 0 && emote.name)
  const ended = Date.parse(payload?.endedAt ?? payload?.latestEndedAt ?? '')
  return {
    displayName: coverage?.displayName?.trim() || login,
    isLive,
    tracked: payload?.rosterEligible !== false,
    category: payload?.category || live?.category || null,
    uptime: isLive ? formatUptime(payload?.startedAt ?? live?.startedAt, now) : null,
    viewers: isLive ? (payload ? latestViewers(payload) : null) ?? liveViewers(live) : null,
    chatPerMinute: isLive ? latestChatPerMinute(rollups, payload?.currentOffsetSeconds ?? 0) : null,
    spark,
    sparkMinutes: isLive ? SPARK_LIVE_MINUTES : Math.round((payload?.durationSeconds ?? spark.length * BUCKET_SECONDS) / 60),
    topEmote: topEmote ? { name: topEmote.name, count: topEmote.count, imageUrl: safeImageUrl(topEmote.imageUrl) } : null,
    biggest: biggestMoment(payload, isLive),
    endedAt: Number.isFinite(ended) ? ended : null,
  }
}

function liveSpark(rollups: ExtensionRollup[], currentOffsetSeconds: number): Array<number | null> {
  const byMinute = new Map<number, number>()
  for (const rollup of rollups) {
    if (!rollup.missing) byMinute.set(Math.floor(rollup.offsetSeconds / BUCKET_SECONDS), rollup.chatCount)
  }
  const lastMinute = Math.floor(currentOffsetSeconds / BUCKET_SECONDS)
  const values: Array<number | null> = []
  for (let minute = lastMinute - SPARK_LIVE_MINUTES + 1; minute <= lastMinute; minute++) {
    values.push(minute < 0 ? null : byMinute.get(minute) ?? null)
  }
  // Leading minutes before the stream (or before coverage) are not a gap.
  const first = values.findIndex(value => value !== null)
  return first < 0 ? [] : values.slice(first)
}

function finishedStreamRollups(payload: PulsePayload | null): ExtensionRollup[] {
  if (!payload) return []
  const rollups = payload.fullRollups?.length ? payload.fullRollups : payload.rollups
  return [...rollups].sort((a, b) => a.offsetSeconds - b.offsetSeconds)
}

/** Average adjacent minutes so a whole broadcast fits the sparkline. */
function downsample(rollups: ExtensionRollup[]): Array<number | null> {
  if (rollups.length === 0) return []
  const size = Math.max(1, Math.ceil(rollups.length / SPARK_MAX_POINTS))
  const values: Array<number | null> = []
  for (let start = 0; start < rollups.length; start += size) {
    const seen = rollups.slice(start, start + size).filter(rollup => !rollup.missing)
    values.push(seen.length ? seen.reduce((sum, rollup) => sum + rollup.chatCount, 0) / seen.length : null)
  }
  return values
}

function latestViewers(payload: PulsePayload): number | null {
  for (let index = payload.rollups.length - 1; index >= 0; index--) {
    const rollup = payload.rollups[index]!
    if (rollup.offsetSeconds < payload.currentOffsetSeconds - 300) return null
    if ((rollup.viewerSamples ?? 0) > 0 && rollup.viewerCount != null) return rollup.viewerCount
    // Legacy payloads carry viewers without a sample count.
    if (rollup.viewerSamples == null && (rollup.viewerCount ?? 0) > 0) return rollup.viewerCount!
  }
  return null
}

// Helix metadata stands in when no recent minute carries a viewer sample.
function liveViewers(live: ExtensionCoverageTierResponse['liveMetadata']): number | null {
  if (!live?.isLive || live.viewerCount == null || !Number.isFinite(live.viewerCount)) return null
  if (live.freshnessSeconds != null && live.freshnessSeconds > 600) return null
  return live.viewerCount
}

function latestChatPerMinute(rollups: ExtensionRollup[], currentOffsetSeconds: number): number | null {
  for (let index = rollups.length - 1; index >= 0; index--) {
    const rollup = rollups[index]!
    if (rollup.offsetSeconds < currentOffsetSeconds - 180) return null
    if (!rollup.missing) return rollup.chatCount
  }
  return null
}

function biggestMoment(payload: PulsePayload | null, isLive: boolean): PopupMoment | null {
  let best: { score: number; offsetSeconds: number; label: string } | null = null
  for (const peak of payload?.peaks ?? []) {
    const score = peak.compositeScore ?? peak.score
    if (!Number.isFinite(score) || (best && score <= best.score)) continue
    best = { score, offsetSeconds: peak.seekOffsetSeconds ?? peak.offsetSeconds, label: peak.reasonLabel || 'Chat spike' }
  }
  if (!best || !payload) return null
  return {
    label: best.label,
    offsetSeconds: best.offsetSeconds,
    agoSeconds: isLive ? Math.max(0, payload.currentOffsetSeconds - best.offsetSeconds) : null,
  }
}

export function formatUptime(startedAt: string | null | undefined, now = Date.now()): string | null {
  const started = startedAt ? Date.parse(startedAt) : NaN
  // Twitch ends a broadcast at 48 h, so anything longer is a stale start time.
  if (!Number.isFinite(started) || started > now || now - started > 48 * 3_600_000) return null
  const minutes = Math.floor((now - started) / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function formatAgo(seconds: number): string {
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

export function formatSince(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export function formatClock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = String(Math.floor(value / 60) % 60).padStart(2, '0')
  const secs = String(value % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${minutes}:${secs}` : `${Math.floor(value / 60)}:${secs}`
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const standard = new Intl.NumberFormat('en-US')

export function formatCount(value: number): string {
  return value >= 10_000 ? compact.format(value) : standard.format(Math.round(value))
}

export interface SparkGeometry {
  line: string
  area: string
  last: { x: number; y: number } | null
}

/**
 * SVG paths for a gap-aware sparkline. Missing minutes break the line instead
 * of drawing a fake zero, and each run closes its own area to the baseline.
 */
export function sparkGeometry(values: Array<number | null>, width: number, height: number, inset = 2): SparkGeometry {
  const finite = values.filter((value): value is number => value !== null)
  if (finite.length === 0) return { line: '', area: '', last: null }
  const max = Math.max(...finite, 1)
  const step = values.length > 1 ? (width - inset * 2) / (values.length - 1) : 0
  const baseline = height - inset
  const point = (value: number, index: number) => ({
    x: round(inset + (values.length > 1 ? index * step : (width - inset * 2) / 2)),
    y: round(baseline - (value / max) * (height - inset * 2)),
  })
  let line = ''
  let area = ''
  let run: Array<{ x: number; y: number }> = []
  let last: { x: number; y: number } | null = null
  const flush = () => {
    if (run.length === 0) return
    // A lone minute still gets a short visible stroke.
    const points = run.length === 1 ? [{ ...run[0]!, x: run[0]!.x - 1 }, { ...run[0]!, x: run[0]!.x + 1 }] : run
    line += `M${points.map(p => `${p.x} ${p.y}`).join('L')}`
    area += `M${points[0]!.x} ${baseline}L${points.map(p => `${p.x} ${p.y}`).join('L')}L${points[points.length - 1]!.x} ${baseline}Z`
    run = []
  }
  values.forEach((value, index) => {
    if (value === null) {
      flush()
      return
    }
    const next = point(value, index)
    run.push(next)
    last = next
  })
  flush()
  return { line, area, last }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
