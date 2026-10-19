import type { MomentContext } from '../ui/library/MomentPreview.tsx'

/** Minutes either side of a saved moment that Preview's chat strip draws. */
export const MOMENT_MINUTE_SPAN = 10
const TOP_EMOTES = 10
/** The tail read is bounded to 120 rows server-side; never trust more than that. */
const MAX_ROWS = 240

interface MinuteRow {
  offsetSeconds?: unknown
  chatCount?: unknown
  totalEmoteCount?: unknown
  viewerAvg?: unknown
  viewerLatest?: unknown
  viewerMax?: unknown
  viewerSamples?: unknown
  missing?: unknown
  topEmotes?: unknown
}
interface MinutesPayload { streamId?: unknown; startedAt?: unknown; minutes?: unknown }
export interface MinuteEmote { name: string; count: number; provider?: string; imageUrl?: string; id?: string; providerEmoteId?: string }

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined

/**
 * `afterOffset` for the bounded tail read the portal's stream timeline uses:
 * whole minutes, with one spare minute for a start that is not on a minute.
 */
export function momentMinutesAfterOffset(offsetSeconds: number): number {
  return Math.max(0, Math.floor((offsetSeconds - (MOMENT_MINUTE_SPAN + 1) * 60) / 60) * 60)
}

/**
 * The whole second the API's offsets count from. The backend computes each
 * offset as int(MinuteTS - StartedAt), so against a start with a fractional
 * second every offset lands on the whole second after it. Date.parse keeps
 * milliseconds only, so a finer remainder is read from the text.
 */
function offsetOriginMs(startedAt: string, startMs: number): number {
  const finer = /\.\d{3}\d*[1-9]/.test(startedAt)
  return Math.ceil((startMs + (finer ? 1 : 0)) / 1000) * 1000
}

function providerLabel(raw: unknown): MomentContext['topEmotes'][number]['provider'] {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return value === 'seventv' || value === '7tv' ? '7TV' : value === 'twitch' ? 'Twitch' : value === 'bttv' ? 'BTTV' : value === 'ffz' ? 'FFZ' : undefined
}

/** The minute's emotes, most used first: `/minutes` sends them unsorted. */
function topEmotes(raw: unknown, image?: (emote: MinuteEmote) => string | undefined): MomentContext['topEmotes'] {
  if (!Array.isArray(raw)) return []
  const emotes: MinuteEmote[] = []
  for (const item of raw.slice(0, 100) as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const name = text(item.name, 100)
    if (!name || !isCount(item.count) || item.count === 0) continue
    emotes.push({ name, count: Math.round(item.count), provider: text(item.provider, 20), imageUrl: text(item.imageUrl, 500),
      id: text(item.id, 128), providerEmoteId: text(item.providerEmoteId, 128) })
  }
  return emotes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, TOP_EMOTES).map(emote => {
    const provider = providerLabel(emote.provider)
    const staticImageUrl = image?.(emote)
    return { name: emote.name, count: emote.count, ...(provider ? { provider } : {}), ...(staticImageUrl ? { staticImageUrl } : {}) }
  })
}

/** The minute's audience, as the stream chart reads it: the sampled average first. */
function viewers(row: MinuteRow): number | null {
  const sampled = isCount(row.viewerSamples) && row.viewerSamples > 0 && isCount(row.viewerAvg) && row.viewerAvg > 0 ? row.viewerAvg : undefined
  const value = sampled ?? [row.viewerLatest, row.viewerAvg, row.viewerMax].find(v => isCount(v) && v > 0)
  return isCount(value) ? Math.round(value) : null
}

/**
 * Shape `/streams/{id}/minutes` rows into Preview's stats for one saved moment:
 * the minute it falls in, and chat per minute either side of it.
 *
 * A minute the API flags missing, or never returns, stays a gap rather than
 * zero. The API omits a zero count, so a row without one is "not available",
 * never a measured zero. Returns null when the payload is for another
 * broadcast or the moment's own minute has no rollup.
 */
export function momentContextFromMinutes(
  payload: unknown,
  moment: { streamId: string; offsetSeconds: number },
  options: { capturedAt: number; emoteImage?: (emote: MinuteEmote) => string | undefined },
): MomentContext | null {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as MinutesPayload
  if (data.streamId != null && String(data.streamId) !== moment.streamId) return null
  const startMs = typeof data.startedAt === 'string' ? Date.parse(data.startedAt) : NaN
  if (!Number.isFinite(startMs) || !Array.isArray(data.minutes) || !isCount(moment.offsetSeconds)) return null
  const origin = offsetOriginMs(data.startedAt as string, startMs)
  const minuteOf = (offset: number) => Math.floor((origin + offset * 1000) / 60_000)
  const momentMinute = minuteOf(moment.offsetSeconds)
  const rows = new Map<number, MinuteRow>()
  let latest = -Infinity
  for (const row of data.minutes.slice(0, MAX_ROWS) as MinuteRow[]) {
    if (!row || typeof row !== 'object' || !isCount(row.offsetSeconds)) continue
    const relative = minuteOf(row.offsetSeconds) - momentMinute
    latest = Math.max(latest, relative)
    // A repeated minute keeps its last row, as the stream timeline does.
    if (Math.abs(relative) <= MOMENT_MINUTE_SPAN) rows.set(relative, row)
  }
  const selected = rows.get(0)
  if (!selected || selected.missing === true) return null
  const first = Math.max(-MOMENT_MINUTE_SPAN, Math.floor(startMs / 60_000) - momentMinute)
  const last = Math.min(MOMENT_MINUTE_SPAN, latest)
  const samples: { offsetSeconds: number; messages: number | null }[] = []
  let gaps = 0
  for (let relative = first; relative <= last; relative += 1) {
    const row = rows.get(relative)
    if (!row || row.missing === true) gaps += 1
    samples.push({ offsetSeconds: Math.max(0, moment.offsetSeconds + relative * 60),
      messages: row && row.missing !== true && isCount(row.chatCount) ? row.chatCount : null })
  }
  return {
    provenance: 'snapshot',
    capturedAt: options.capturedAt,
    streamStartedAt: startMs,
    coverage: gaps ? 'partial' : 'complete',
    windowLabel: `±${MOMENT_MINUTE_SPAN} min`,
    samples,
    selectedMessages: isCount(selected.chatCount) ? selected.chatCount : null,
    selectedEmotes: isCount(selected.totalEmoteCount) ? selected.totalEmoteCount : null,
    selectedViewers: viewers(selected),
    topEmotes: topEmotes(selected.topEmotes, options.emoteImage),
  }
}
