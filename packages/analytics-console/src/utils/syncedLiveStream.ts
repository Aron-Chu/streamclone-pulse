import type { AnalyticsStream } from '../api.ts'
import { GOOD_COVERAGE_PCT, type AnalyticsQualityLabel } from './streamQuality.ts'

export type StreamSyncBadge = 'synced' | 'partial' | 'stats_only' | 'unknown' | 'syncing'

export interface StreamSyncEvidence {
  hasViewerMinutes?: boolean
  hasChatMinutes?: boolean
  /** The share of the stream's minutes with data (the backend's data coverage), never the chat-only share. */
  coveragePct?: number
  syncHealthState?: string
  /** The open session's "Data: <label>": the selected row says Synced exactly when it says Good (pick 11A review, 10-30). */
  quality?: AnalyticsQualityLabel
}

/** Stream list row has both viewer and chat minute rollups synced into analytics DB. */
export function streamHasSyncedMinutes(stream: AnalyticsStream): boolean {
  return (stream.viewerSamples ?? 0) > 0 && (stream.chatMessages ?? 0) > 0
}

/**
 * What a row's badge and its hover text both read: the list row's counts, plus
 * the open session's own minutes when the row is the selected one (pick 11A, 10-30).
 */
function streamSyncSignals(stream: AnalyticsStream, evidence?: StreamSyncEvidence) {
  const coveragePct = evidence?.coveragePct
  return {
    hasViewers: (stream.viewerSamples ?? 0) > 0 || evidence?.hasViewerMinutes === true,
    hasChat: (stream.chatMessages ?? 0) > 0 || evidence?.hasChatMinutes === true,
    coveragePct: coveragePct != null && Number.isFinite(coveragePct) ? coveragePct : undefined,
    health: evidence?.syncHealthState?.trim().toLowerCase() ?? '',
  }
}

export function streamSyncBadgeState(
  stream: AnalyticsStream,
  syncing = false,
  evidence?: StreamSyncEvidence,
): StreamSyncBadge {
  if (syncing) return 'syncing'
  // One verdict with the header, whatever the row's own counts say (pick 11A review, 10-30).
  if (evidence?.quality === 'Good') return 'synced'
  const { hasViewers, hasChat, coveragePct, health } = streamSyncSignals(stream, evidence)
  // With no header verdict: the header's and the backend's 80% line, not a stricter 99.5% (pick 11A, 10-30).
  // The open session's row always passes `quality`, so there the verdict above or below decides.
  const hasPartialCoverage =
    (coveragePct != null && coveragePct < GOOD_COVERAGE_PCT)
    || ['partial', 'viewer_only', 'chat_only', 'degraded', 'limited'].includes(health)
    || evidence?.quality != null
  if (hasViewers && hasChat) return hasPartialCoverage ? 'partial' : 'synced'
  if (hasViewers || hasChat) return 'partial'
  if (health === 'stats_only' || health === 'none') return 'stats_only'
  if (
    stream.viewerSamples === undefined
    && stream.chatMessages === undefined
    && evidence?.hasViewerMinutes === undefined
    && evidence?.hasChatMinutes === undefined
  ) return 'unknown'
  return 'stats_only'
}

export function streamSyncBadgeLabel(badge: StreamSyncBadge): string {
  switch (badge) {
    case 'syncing':
      return 'Syncing'
    case 'synced':
      return 'Synced'
    case 'partial':
      return 'Partial'
    case 'unknown':
      return 'Check status'
    default:
      return 'Stats only'
  }
}

/**
 * Hover text for a row's badge. Pass the badge's own evidence: the selected
 * row's chat minutes are then never called missing (pick 11A, 10-30).
 */
export function streamSyncBadgeTitle(
  badge: StreamSyncBadge,
  stream: AnalyticsStream,
  evidence?: StreamSyncEvidence,
): string {
  switch (badge) {
    case 'syncing':
      return 'Sync in progress — partial chart data may already be visible.'
    case 'synced':
      // Synced on the header's verdict while this page has none of the session's minutes: the minute read failed.
      if (evidence && evidence.hasViewerMinutes === false && evidence.hasChatMinutes === false) {
        return 'Data synced; the minute chart did not load on this page.'
      }
      return 'Minute-level viewer, chat, and emote rollups are synced for charts.'
    case 'partial': {
      const { hasViewers, hasChat, coveragePct } = streamSyncSignals(stream, evidence)
      if (hasViewers && !hasChat) return 'Viewer minutes synced; chat rollups missing or partial.'
      if (!hasViewers && hasChat) return 'Chat rollups synced; viewer minutes missing or partial.'
      if (coveragePct != null && coveragePct < GOOD_COVERAGE_PCT) {
        // Rounded down, so 79.6 never reads as the line itself (pick 11A, 10-30).
        const shown = coveragePct < 1 ? 'less than 1%' : `${Math.floor(coveragePct)}%`
        return `Data in ${shown} of this stream's minutes; under ${GOOD_COVERAGE_PCT}% counts as partial.`
      }
      return 'Partial minute coverage — chart may be incomplete.'
    }
    case 'unknown':
      return 'The stream list did not include minute-sync counts. Open this session to load its current coverage.'
    default:
      return 'Session stats only (duration, title). Open the stream detail page to see minute charts.'
  }
}

/** Sidebar row is navigable when it has minute data or TwitchTracker session stats. */
export function streamIsSidebarVisible(stream: AnalyticsStream, syncedOnly: boolean): boolean {
  if (!syncedOnly) return true
  if (streamHasSyncedMinutes(stream)) return true
  if (stream.endedAt?.trim()) return true
  return (stream.peakViewers ?? 0) > 0 || (stream.avgViewers ?? 0) > 0
}

export function getAnalyticsStreamDateSlug(startedAt?: string): string {
  if (!startedAt) return ''
  const date = new Date(startedAt)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** New links always use immutable stream identity. Date slugs remain read-only legacy aliases. */
export function analyticsStreamPathSlug(
  stream: AnalyticsStream,
  _allStreams: AnalyticsStream[],
): string {
  return stream.streamId
}

/**
 * When the live collector route has no chart minutes but a synced session exists,
 * pick the sidebar stream to open instead of the empty live placeholder row.
 * With server-side dedupe, this mainly handles legacy rows and live-endpoint mismatches.
 */
export function pickSyncedLiveStreamTarget(
  combinedStreams: AnalyticsStream[],
  opts?: { liveStreamId?: string; channelLive?: boolean },
): AnalyticsStream | undefined {
  const visible = combinedStreams.filter(
    stream => !stream.canonicalStreamId || stream.canonicalStreamId === stream.streamId,
  )
  const synced = visible.filter(streamHasSyncedMinutes)
  if (synced.length === 0) return undefined

  const liveStreamId = opts?.liveStreamId?.trim()
  const channelLive = opts?.channelLive ?? false

  if (liveStreamId) {
    const same = synced.find(stream => stream.streamId === liveStreamId)
    if (same) return same
  }

  const openSynced = synced.filter(stream => !stream.endedAt)
  if (openSynced.length > 0) return openSynced[0]

  if (channelLive) {
    const liveRow = liveStreamId
      ? visible.find(stream => stream.streamId === liveStreamId)
      : visible[0]
    const collectorIsStale = !liveRow || !streamHasSyncedMinutes(liveRow)
    const newestSynced = synced[0]
    const referenceMs = streamReferenceTimeMs(liveRow) ?? newestStreamReferenceTimeMs(visible) ?? Date.now()
    if (collectorIsStale && newestSynced && isRecentSyncedSession(newestSynced, referenceMs)) {
      return newestSynced
    }
    return undefined
  }

  return synced[0]
}

/** Canonical session row for `/analytics/:login` → `/analytics/:login/:slug` redirects. */
export function resolveCanonicalLiveSessionTarget(
  combinedStreams: AnalyticsStream[],
  opts?: {
    liveStreamId?: string
    channelLive?: boolean
    channelLogin?: string
    startedAt?: string
  },
): AnalyticsStream | undefined {
  const liveStreamId = opts?.liveStreamId?.trim()
  const channelLive = opts?.channelLive ?? false

  if (liveStreamId) {
    const visible = combinedStreams.find(
      (stream) =>
        stream.streamId === liveStreamId
        && (!stream.canonicalStreamId || stream.canonicalStreamId === stream.streamId),
    )
    if (visible) return visible
    if (channelLive) {
      return {
        streamId: liveStreamId,
        login: opts?.channelLogin ?? '',
        startedAt: opts?.startedAt ?? '',
      }
    }
  }

  return pickSyncedLiveStreamTarget(combinedStreams, {
    liveStreamId,
    channelLive,
  })
}

/** Long streams stay "live" for many hours; allow redirect for recent synced sessions. */
function isRecentSyncedSession(stream: AnalyticsStream, referenceMs = Date.now()): boolean {
  if (!stream.startedAt) return false
  const started = Date.parse(stream.startedAt)
  if (Number.isNaN(started)) return false
  return referenceMs-started < 48 * 60 * 60 * 1000
}

function streamReferenceTimeMs(stream?: AnalyticsStream): number | undefined {
  for (const value of [stream?.endedAt, stream?.lastSeenAt, stream?.startedAt]) {
    if (!value) continue
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function newestStreamReferenceTimeMs(streams: AnalyticsStream[]): number | undefined {
  let newest: number | undefined
  for (const stream of streams) {
    const parsed = streamReferenceTimeMs(stream)
    if (parsed === undefined) continue
    if (newest === undefined || parsed > newest) newest = parsed
  }
  return newest
}
