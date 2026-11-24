import type { HubActivityPoint, HubLiveChannel, HubLivePulseMoment } from '../../../lib/publicHub'
import { momentComparisonBadge, momentReactionSignal } from '../../../lib/momentComparison'
import { findHeroEmote } from './heroEmotes'

/**
 * What the front page's background is drawn from: the hub read the page already makes (live channels, the
 * last 30 one-minute points and the live moments). Counted, never invented: a chat line stands for a batch
 * of counted messages in a public channel, never for words or who wrote them (PRODUCT.md, rollup-first).
 */

export interface ChatSource {
  /** The public channel name a line shows. */
  name: string
  login: string
  chatPerMin: number
  viewers: number
  /** Emotes per chat message (0-1), so a line carries an emote about as often as that chat does. */
  emoteShare: number
}

const finiteNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The busiest chats, each with its counts. Channels with no measured chat are left out. */
export function chatSources(live: readonly HubLiveChannel[], max = 60): ChatSource[] {
  return live
    .filter((c) => c.login && finiteNonNeg(c.chatPerMin) && c.chatPerMin > 0)
    .sort((a, b) => b.chatPerMin - a.chatPerMin)
    .slice(0, max)
    .map((c) => ({
      name: c.displayName?.trim() || c.login,
      login: c.login,
      chatPerMin: c.chatPerMin,
      viewers: finiteNonNeg(c.viewers) ? c.viewers : 0,
      emoteShare: finiteNonNeg(c.emotesPerMin) ? Math.min(1, c.emotesPerMin / c.chatPerMin) : 0,
    }))
}

export const PER_LINE_STEPS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000] as const

/**
 * How many counted messages one line stands for: the smallest round step that keeps each of the two
 * columns at about one new line a second or slower, so a line can be read.
 */
export function perLine(totalChatPerMin: number, linesPerSecPerColumn = 1): number {
  const total = finiteNonNeg(totalChatPerMin) ? totalChatPerMin : 0
  for (const step of PER_LINE_STEPS) if (total / step / 60 / 2 <= linesPerSecPerColumn) return step
  return PER_LINE_STEPS[PER_LINE_STEPS.length - 1]
}

export type RidgeKey = 'ffz' | 'bttv' | 'viewers' | 'twitch' | 'seventv' | 'emotes' | 'chat'

export interface RidgeRow {
  key: RidgeKey
  /** What a person reads on hover. */
  label: string
  /** Viewers are "watching"; every other row counts "a minute". */
  unit: 'a minute' | 'watching'
  /** One value per minute in `times`; null where the minute was not recorded. */
  values: (number | null)[]
  /** True where a provider count is only a lower bound. */
  atLeast: boolean[]
  /** 0-1 line height per minute (null where not recorded), each row scaled to itself. */
  heights: (number | null)[]
}

export interface RidgeData {
  /** Start of each complete minute, oldest first (ms). */
  times: number[]
  bucketMs: number
  /** Far to near. */
  rows: RidgeRow[]
}

/** Far to near: the quiet providers at the back, chat at the front. */
const RIDGE_SERIES: ReadonlyArray<{ key: RidgeKey; label: string; viewer?: true; provider?: true }> = [
  { key: 'ffz', label: 'FFZ emotes', provider: true },
  { key: 'bttv', label: 'BTTV emotes', provider: true },
  { key: 'viewers', label: 'Viewers', viewer: true },
  { key: 'twitch', label: 'Twitch emotes', provider: true },
  { key: 'seventv', label: '7TV emotes', provider: true },
  { key: 'emotes', label: 'Emotes', provider: true },
  { key: 'chat', label: 'Chat' },
]

/** A row needs this many recorded minutes to be drawn at all. */
export const RIDGE_MIN_MINUTES = 10

const toMs = (t: number) => (t < 1e12 ? t * 1000 : t)

/**
 * The ridge's rows: the network series of the last complete minutes, each scaled to itself. The open
 * minute is left out, and a minute that was not recorded is a gap, never a zero.
 */
export function ridgeRows(points: readonly HubActivityPoint[] | null | undefined, generatedAt?: string | null, bucketMinutes?: number | null): RidgeData {
  const bucketMs = Math.max(1, bucketMinutes && bucketMinutes > 0 ? bucketMinutes : 1) * 60_000
  const asOf = generatedAt ? Date.parse(generatedAt) : NaN
  const complete = (points ?? [])
    .filter((p) => p && Number.isFinite(p.t))
    .map((p) => ({ p, t: toMs(p.t) }))
    .filter(({ p, t }) => p.bucketComplete !== false && (!Number.isFinite(asOf) || t + bucketMs <= asOf))
    .sort((a, b) => a.t - b.t)
  const times = complete.map((x) => x.t)
  const rows: RidgeRow[] = []
  for (const s of RIDGE_SERIES) {
    const values = complete.map(({ p }) => {
      if (p.gapKind) return null
      if (s.viewer ? p.hasViewerRollup === false : p.hasChatRollup === false) return null
      const v = (p as unknown as Record<string, unknown>)[s.key]
      return finiteNonNeg(v) ? v : null
    })
    const atLeast = complete.map(({ p }) => Boolean(s.provider && p.providerCountsLowerBound))
    const seen = values.filter((v): v is number => v != null)
    if (seen.length < RIDGE_MIN_MINUTES) continue
    const mean = seen.reduce((a, b) => a + b, 0) / seen.length
    if (mean < 1) continue
    const max = Math.max(...seen)
    const min = Math.min(...seen)
    // Softened: the quietest minute sits about a third of the way up, so small wobbles stay small.
    const lo = Math.max(0, min - (max - min) * 0.6)
    const heights = values.map((v) => (v == null ? null : 0.1 + 0.6 * (max > lo ? (v - lo) / (max - lo) : 0.5)))
    rows.push({ key: s.key, label: s.label, unit: s.viewer ? 'watching' : 'a minute', values, atLeast, heights })
  }
  return { times, bucketMs, rows }
}

export interface HeroMoment {
  key: string
  /** The public channel name. */
  name: string
  login: string
  at: number
  /** 'Chat' or 'Emotes': the signal the ratio belongs to. */
  label: string
  series: 'chat' | 'emotes'
  /** e.g. "6.2×". */
  short: string
  /** The emote the moment leaned on, when it is one of the stored set. */
  emote: string | null
}

/**
 * The live moments the background may mark: only those whose comparison is ready and rose (the hub's own
 * badge), newest first, one per channel.
 */
export function heroMoments(moments: readonly HubLivePulseMoment[] | null | undefined, nowMs: number, max = 8): HeroMoment[] {
  const out: HeroMoment[] = []
  const seen = new Set<string>()
  const sorted = (moments ?? []).filter((m) => m && Number.isFinite(m.at) && (m.at as number) <= nowMs + 60_000).sort((a, b) => (b.at as number) - (a.at as number))
  for (const m of sorted) {
    const login = m.login?.trim()
    if (!login || seen.has(login)) continue
    const badge = momentComparisonBadge(m.comparison, momentReactionSignal(m.kind))
    if (!badge || badge.words == null || badge.belowBaseline) continue
    seen.add(login)
    out.push({
      key: m.publicMomentId || `${login}:${m.at}`,
      name: m.displayName?.trim() || login,
      login,
      at: m.at as number,
      label: badge.label,
      series: badge.series,
      short: badge.short,
      emote: findHeroEmote(m.topEmoteCode)?.name ?? null,
    })
    if (out.length >= max) break
  }
  return out
}
