import type { PastVodAnalyticsStatus, PastVodRow } from './messages.ts'

export interface MetadataStreamHistoryItem {
  id: string
  videoId?: string
  title: string
  category?: string
  thumbnailUrl?: string
  startedAt?: string
  endedAt?: string
  durationMinutes?: number
  avgViewers?: number
  peakViewers?: number
}

export interface AnalyticsStreamListItem {
  streamId: string
  title?: string
  category?: string
  thumbnailUrl?: string
  startedAt?: string
  endedAt?: string
  avgViewers?: number
  peakViewers?: number
  viewerSamples?: number
  chatMessages?: number
  vodId?: string
}

export function vodThumbnailUrl(value: string | undefined, width = 72, height = 40): string {
  if (!value) return ''
  return value
    .replace(/%\{width\}/g, String(width))
    .replace(/%\{height\}/g, String(height))
    .replace(/\{width\}/g, String(width))
    .replace(/\{height\}/g, String(height))
}

export function buildTwitchVodUrl(vodId: string, offsetSeconds = 0): string {
  const id = vodId.trim()
  if (!id) return 'https://www.twitch.tv'
  const base = `https://www.twitch.tv/videos/${encodeURIComponent(id)}`
  if (offsetSeconds <= 0) return base
  return `${base}?t=${formatTwitchVodTimeParam(offsetSeconds)}`
}

function formatTwitchVodTimeParam(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${m}m${sec}s`
  if (m > 0) return `${m}m${sec}s`
  return `${sec}s`
}

export function resolvePastVodAnalyticsStatus(
  streamId: string,
  analyticsStreams: AnalyticsStreamListItem[] | undefined,
  liveStreamId?: string | null,
): PastVodAnalyticsStatus {
  const stream = analyticsStreams?.find(item => item.streamId === streamId)
  if (!stream) return 'unknown'
  if (liveStreamId && stream.streamId === liveStreamId) return 'current-live'
  if ((stream.viewerSamples ?? 0) > 0 || (stream.chatMessages ?? 0) > 0) return 'synced'
  return 'stats-only'
}

export function pastVodAnalyticsStatusLabel(status: PastVodAnalyticsStatus): string {
  switch (status) {
    case 'current-live':
      return 'Current live'
    case 'synced':
      return 'Synced'
    case 'stats-only':
      return 'Stats only'
    case 'sync-interrupted':
      return 'Sync interrupted'
    default:
      return 'No pulse'
  }
}

export function pastVodAnalyticsStatusClass(status: PastVodAnalyticsStatus): string {
  switch (status) {
    case 'current-live':
      return 'pulse-past-vod-status pulse-past-vod-status-live'
    case 'synced':
      return 'pulse-past-vod-status pulse-past-vod-status-synced'
    case 'stats-only':
      return 'pulse-past-vod-status pulse-past-vod-status-stats'
    case 'sync-interrupted':
      return 'pulse-past-vod-status pulse-past-vod-status-interrupted'
    default:
      return 'pulse-past-vod-status pulse-past-vod-status-unknown'
  }
}

export function formatPastVodDate(startedAt?: string): string {
  if (!startedAt) return ''
  const date = new Date(startedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatPastVodDuration(durationMinutes?: number): string {
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return ''
  const total = Math.round(durationMinutes)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function durationMinutesFromAnalytics(item: AnalyticsStreamListItem): number | undefined {
  if (!item.startedAt || !item.endedAt) return undefined
  const start = new Date(item.startedAt).getTime()
  const end = new Date(item.endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined
  return Math.round((end - start) / 60_000)
}

function sortByStartedAtDesc(rows: PastVodRow[]): PastVodRow[] {
  return [...rows].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
    return bTime - aTime
  })
}

/** Merge metadata history + analytics streams; pin current live at top when provided. */
export function mergePastVodRows(
  history: MetadataStreamHistoryItem[] | undefined,
  analytics: AnalyticsStreamListItem[] | undefined,
  options?: { liveStreamId?: string | null; isLive?: boolean },
): PastVodRow[] {
  const analyticsById = new Map((analytics ?? []).map(item => [item.streamId, item]))
  const seen = new Set<string>()
  const rows: PastVodRow[] = []

  for (const item of history ?? []) {
    if (!item.id) continue
    seen.add(item.id)
    const analyticsItem = analyticsById.get(item.id)
    rows.push({
      streamId: item.id,
      videoId: item.videoId ?? analyticsItem?.vodId,
      title: item.title || analyticsItem?.title || 'Untitled stream',
      category: item.category ?? analyticsItem?.category,
      thumbnailUrl: item.thumbnailUrl ?? analyticsItem?.thumbnailUrl,
      startedAt: item.startedAt ?? analyticsItem?.startedAt,
      durationMinutes: item.durationMinutes ?? durationMinutesFromAnalytics(analyticsItem ?? { streamId: item.id }),
      avgViewers: item.avgViewers ?? analyticsItem?.avgViewers,
      peakViewers: item.peakViewers ?? analyticsItem?.peakViewers,
      analyticsStatus: resolvePastVodAnalyticsStatus(item.id, analytics, options?.liveStreamId),
    })
  }

  for (const item of analytics ?? []) {
    if (!item.streamId || seen.has(item.streamId)) continue
    rows.push({
      streamId: item.streamId,
      videoId: item.vodId,
      title: item.title || 'Untitled stream',
      category: item.category,
      thumbnailUrl: item.thumbnailUrl,
      startedAt: item.startedAt,
      durationMinutes: durationMinutesFromAnalytics(item),
      avgViewers: item.avgViewers,
      peakViewers: item.peakViewers,
      analyticsStatus: resolvePastVodAnalyticsStatus(item.streamId, analytics, options?.liveStreamId),
    })
  }

  const sorted = sortByStartedAtDesc(rows)
  const liveStreamId = options?.isLive ? options.liveStreamId?.trim() : undefined
  if (!liveStreamId) return sorted

  const liveIdx = sorted.findIndex(row => row.streamId === liveStreamId)
  if (liveIdx < 0) return sorted

  const liveRow: PastVodRow = {
    ...sorted[liveIdx],
    analyticsStatus: 'current-live',
  }
  if (liveIdx === 0) {
    return [liveRow, ...sorted.slice(1)]
  }
  return [liveRow, ...sorted.filter(row => row.streamId !== liveStreamId)]
}
