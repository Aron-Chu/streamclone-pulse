import type { AnalyticsMinuteRollup, AnalyticsStream, AnalyticsStreamDetail } from '../apiTypes.ts'
import { resolveEmoteAssetUrl } from '../configureApi.ts'
import { parseEmoteKey } from '../emoteUtils.ts'
import { isPlaceholderStreamTitle } from './analyticsStreamRow.ts'
import { resolveEmoteImageUrl, preferResolvableEmoteUrl } from './emoteImageUrl.ts'

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export function relativeTime(value?: string | number): string {
  if (!value) return '-'
  const ts = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ts)) return '-'
  const diff = Date.now() - ts
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function rollupOffsetSeconds(rollup: AnalyticsMinuteRollup, startedAt?: string): number {
  if (!startedAt) return 0
  const startMs = new Date(startedAt).getTime()
  const minuteMs = new Date(rollup.minuteTs).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(minuteMs)) return 0
  return Math.max(0, Math.floor((minuteMs - startMs) / 1000))
}

export function formatDateTime(value?: string): string {
  if (!value) return '-'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '-'
  const date = new Date(ts)
  return (
    date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  )
}

function formatDurationMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total}m`
  return `${Math.floor(total / 60)}h ${total % 60}m`
}

export function duration(stream?: AnalyticsStream): string {
  if (!stream) return '-'
  const start = Date.parse(stream.startedAt)
  const end = stream.endedAt ? Date.parse(stream.endedAt) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '-'
  return formatDurationMinutes((end - start) / 60000)
}

/**
 * Prefer Pulse rollup / chat coverage span for the Duration KPI so late EndedAt
 * walls (zombie-live) do not report 18h when charts only cover ~9h of chat.
 */
export function durationFromDetail(detail?: AnalyticsStreamDetail | null): string {
  if (!detail) return '-'
  const coverageMinutes = detail.chatCoverage?.chatSpanMinutes
  if (coverageMinutes != null && coverageMinutes > 0) {
    const wallMinutes = detail.chatCoverage?.streamSpanMinutes ?? 0
    if (wallMinutes <= 0 || wallMinutes <= coverageMinutes + 5) {
      return formatDurationMinutes(coverageMinutes)
    }
    // Partial / trailing empty wall: show measured Pulse span.
    if (coverageMinutes < wallMinutes * 0.85) {
      return formatDurationMinutes(coverageMinutes)
    }
  }
  const rollups = detail.rollups ?? []
  if (rollups.length >= 2) {
    const first = Date.parse(rollups[0]!.minuteTs)
    const last = Date.parse(rollups[rollups.length - 1]!.minuteTs)
    if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
      return formatDurationMinutes((last - first) / 1000 / 60 + 1)
    }
  }
  if (detail.timelineMinutes != null && detail.timelineMinutes > 0) {
    return formatDurationMinutes(detail.timelineMinutes)
  }
  return duration(detail.stream)
}

export function formatVodOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join('')
}

export function getLocalDateString(startedAt?: string): string {
  if (!startedAt) return ''
  const date = new Date(startedAt)
  if (isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function displayStreamTitle(
  stream?: AnalyticsStream,
  login?: string,
  fallbacks: Array<string | undefined> = [],
): string {
  if (!isPlaceholderStreamTitle(stream?.title)) return stream!.title!.trim()
  for (const candidate of fallbacks) {
    const trimmed = candidate?.trim() ?? ''
    if (trimmed && !isPlaceholderStreamTitle(trimmed)) return trimmed
  }
  return `${login ?? stream?.login ?? 'Stream'} analytics`
}

export function streamStateLabel(
  state?: AnalyticsStreamDetail['state'] | 'not found' | 'loading',
  isHistoricalRoute = false,
): string {
  if (state === 'not found') return 'not found'
  if (state === 'live') return 'live'
  if (isHistoricalRoute && (state === 'loading' || !state)) return 'historical'
  if (state === 'syncing') return 'syncing'
  if (state === 'historical') return 'historical'
  if (state === 'not_collected') return 'stats only'
  return state || 'loading'
}

export function sourceTone(state: string): string {
  if (state === 'ready') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
  if (state === 'fallback') return 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100'
  if (state === 'blocked' || state === 'unavailable' || state === 'limited')
    return 'border-amber-300/20 bg-amber-400/10 text-amber-100'
  return 'border-red-400/20 bg-red-500/10 text-red-100'
}

export function getEmoteImageUrl(emote: {
  provider?: string
  id?: string
  imageUrl?: string
  image_url?: string
  key?: string
}): string | undefined {
  const parsed = emote.key ? parseEmoteKey(emote.key) : null
  const provider = emote.provider ?? (parsed && parsed.provider !== 'unknown' ? parsed.provider : undefined)
  const id = emote.id?.trim() || parsed?.id || undefined
  const imageUrl = emote.imageUrl ?? emote.image_url
  const directUrl = resolveEmoteImageUrl({
    provider,
    id,
    imageUrl,
    scale: '1x',
  })
  const synthesizedUrl = id
    ? resolveEmoteImageUrl({
        provider,
        id,
        scale: '1x',
      })
    : undefined
  const absDirect = directUrl ? resolveEmoteAssetUrl(directUrl) : undefined
  const absSynth = synthesizedUrl ? resolveEmoteAssetUrl(synthesizedUrl) : undefined
  const preferred = preferResolvableEmoteUrl(absDirect, absSynth)
  return preferred || undefined
}
