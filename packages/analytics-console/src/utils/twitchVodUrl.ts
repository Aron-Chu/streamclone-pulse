/** Twitch VOD watch URL with optional seek offset (seconds from stream start). */
export function formatTwitchVodTimeParam(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${m}m${sec}s`
  if (m > 0) return `${m}m${sec}s`
  return `${sec}s`
}

export function buildTwitchVodUrl(vodId: string, offsetSeconds = 0): string {
  const id = vodId.trim()
  if (!id) return 'https://www.twitch.tv'
  const base = `https://www.twitch.tv/videos/${encodeURIComponent(id)}`
  if (offsetSeconds <= 0) return base
  return `${base}?t=${formatTwitchVodTimeParam(offsetSeconds)}`
}

export function resolveAnalyticsVodId(
  detail?: {
    vodId?: string
    stream?: { vodId?: string }
  },
  recapVodId?: string,
): string | undefined {
  const id = detail?.vodId?.trim() || detail?.stream?.vodId?.trim() || recapVodId?.trim()
  return id || undefined
}

export type VodLinkStatus =
  | 'linked'
  | 'live'
  | 'syncing'
  | 'unavailable'
  | 'request_failed'

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
    availability?: {
      vodState?: string
      vodId?: string
      vodMessage?: string
    }
  }
  recapVodId?: string
  fallbackVodId?: string
  isLiveCollector?: boolean
  channelIsLive?: boolean
}): VodLinkState {
  const authored = input.detail?.availability
  const authoredState = (authored?.vodState ?? '').toLowerCase()
  const vodId =
    authored?.vodId?.trim()
    || resolveAnalyticsVodId(input.detail, input.recapVodId)
    || input.fallbackVodId?.trim()
    || undefined

  if (authoredState === 'linked' || (authoredState === '' && vodId)) {
    if (vodId) {
      const liveArchive = input.isLiveCollector === true || authoredState === '' && input.isLiveCollector
      return {
        status: 'linked',
        vodId,
        label: input.isLiveCollector ? 'Jump to VOD (live archive)' : 'Jump to VOD',
        detail: authored?.vodMessage
          || (input.isLiveCollector
            ? 'Twitch is archiving this broadcast. Timestamps track stream offset from go-live.'
            : ''),
      }
    }
  }

  if (authoredState === 'pending_live') {
    return {
      status: 'live',
      label: 'Live — no VOD yet',
      detail: authored?.vodMessage
        || 'This session is still live. A timestamped VOD link appears automatically after the broadcast ends.',
    }
  }
  if (authoredState === 'resolving') {
    return {
      status: 'syncing',
      label: 'Waiting for Twitch VOD',
      detail: authored?.vodMessage
        || 'Stream ended — waiting for Twitch VOD publication.',
    }
  }
  if (authoredState === 'request_failed') {
    return {
      status: 'request_failed',
      label: 'VOD lookup failed',
      detail: authored?.vodMessage
        || 'Could not reach Twitch to resolve the archive. Retry later.',
    }
  }
  if (authoredState === 'unavailable') {
    return {
      status: 'unavailable',
      label: 'VOD unavailable',
      detail: authored?.vodMessage
        || 'No Twitch VOD exists for this session — it may have been deleted, expired, or was never archived.',
    }
  }

  if (vodId) {
    return {
      status: 'linked',
      vodId,
      label: input.isLiveCollector ? 'Jump to VOD (live archive)' : 'Jump to VOD',
      detail: input.isLiveCollector
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
  // External offline + no VOD yet: never claim unavailable while still resolving.
  if (channelLive === false && !vodId) {
    return {
      status: 'syncing',
      label: 'Waiting for Twitch VOD',
      detail: authored?.vodMessage
        || 'Stream ended — waiting for Twitch VOD publication.',
    }
  }
  if (isLive) {
    return {
      status: 'live',
      label: 'Live — no VOD yet',
      detail: 'This session is still live. A timestamped VOD link appears automatically after the broadcast ends.',
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
    currentRow?.vodId?.trim()
    || input.detail?.stream?.vodId?.trim()
    || input.detail?.vodId?.trim()
  return id || undefined
}
