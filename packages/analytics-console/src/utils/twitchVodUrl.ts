import { normalizeVodId } from '@streampulse/pulse-core'

const ANALYTICS_VOD_ID_PATTERN = /^\d{6,20}$/

function normalizeAnalyticsVodId(raw: string | undefined): string | undefined {
  const normalized = normalizeVodId(raw)
  return normalized && ANALYTICS_VOD_ID_PATTERN.test(normalized) ? normalized : undefined
}

/** Twitch VOD watch URL with optional seek offset (seconds from stream start). */
export function formatTwitchVodTimeParam(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${m}m${sec}s`
  if (m > 0) return `${m}m${sec}s`
  return `${sec}s`
}

export function buildTwitchVodUrl(vodId: string, offsetSeconds = 0): string {
  const id = normalizeAnalyticsVodId(vodId)
  if (!id) return 'https://www.twitch.tv'
  const base = `https://www.twitch.tv/videos/${encodeURIComponent(id)}`
  const offset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0
  if (offset <= 0) return base
  return `${base}?t=${formatTwitchVodTimeParam(offset)}`
}

export function resolveAnalyticsVodId(
  detail?: {
    vodId?: string
    stream?: { vodId?: string }
  },
  recapVodId?: string,
): string | undefined {
  return [detail?.vodId, detail?.stream?.vodId, recapVodId]
    .map(normalizeAnalyticsVodId)
    .find((id): id is string => Boolean(id))
}

export type VodLinkStatus = 'linked' | 'live' | 'syncing' | 'unavailable'

export interface VodLinkState {
  status: VodLinkStatus
  vodId?: string
  /** Short label for the action chip in Selected Moment. */
  label: string
  /** Longer explanation when no link is available. */
  detail: string
}

export function resolveVodLinkState(input: {
  detail?: {
    vodId?: string
    state?: string
    syncPhase?: string
    stream?: { vodId?: string; endedAt?: string | null }
  }
  recapVodId?: string
  fallbackVodId?: string
  isLiveCollector?: boolean
  channelIsLive?: boolean
}): VodLinkState {
  const vodId =
    resolveAnalyticsVodId(input.detail, input.recapVodId)
    || normalizeAnalyticsVodId(input.fallbackVodId)
    || undefined
  if (vodId) {
    const liveArchive = input.isLiveCollector === true
    return {
      status: 'linked',
      vodId,
      label: liveArchive ? 'Jump to VOD (live archive)' : 'Jump to VOD',
      detail: liveArchive
        ? 'Twitch is archiving this broadcast. Timestamps track stream offset from go-live.'
        : '',
    }
  }

  const syncing =
    input.detail?.state === 'syncing'
    || Boolean(input.detail?.syncPhase?.trim())
  if (syncing) {
    return {
      status: 'syncing',
      label: 'VOD syncing…',
      detail: 'The VOD archive is still syncing. The Twitch link will appear once the VOD ID resolves.',
    }
  }

  const endedAt = input.detail?.stream?.endedAt?.trim()
  const channelLive = input.channelIsLive
  const isLive = input.isLiveCollector ?? (
    channelLive !== false && (input.detail?.state === 'live' || !endedAt)
  )
  if (isLive) {
    return {
      status: 'live',
      label: 'Live — no VOD yet',
      detail: 'This session is still live. A timestamped VOD link appears once Twitch publishes a live archive for this stream (Helix stream match).',
    }
  }

  return {
    status: 'unavailable',
    label: 'VOD unavailable',
    detail: 'No Twitch VOD exists for this session — it may have been deleted, expired, or was never archived.',
  }
}

/** VOD id for the active session only — never another sidebar row. */
export function resolveSessionFallbackVodId(input: {
  sidebarStreams: Array<{ streamId?: string; id?: string; vodId?: string }>
  targetQueryStreamId?: string
  detail?: {
    vodId?: string
    stream?: { vodId?: string }
  }
}): string | undefined {
  const currentRow = input.sidebarStreams.find(
    (row) => String(row.streamId ?? row.id ?? '') === String(input.targetQueryStreamId ?? ''),
  )
  const id =
    normalizeAnalyticsVodId(currentRow?.vodId)
    || normalizeAnalyticsVodId(input.detail?.stream?.vodId)
    || normalizeAnalyticsVodId(input.detail?.vodId)
  return id
}
