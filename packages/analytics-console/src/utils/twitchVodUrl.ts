import { normalizeVodId } from '@streampulse/pulse-core'

const ANALYTICS_VOD_ID_PATTERN = /^\d{6,20}$/

/** Map an exact stream offset without substituting an archive boundary. */
export function alignedVodOffset(streamOffset: number, alignment?: number | null, duration?: number | null): number | undefined {
  if (!Number.isFinite(streamOffset) || streamOffset < 0 || typeof alignment !== 'number'
    || !Number.isFinite(alignment) || Math.abs(alignment) > 6 * 60 * 60) return undefined
  const offset = streamOffset + alignment
  if (!Number.isFinite(offset) || offset < 0) return undefined
  if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || offset >= duration)) return undefined
  return Math.floor(offset)
}

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
    availability?: { vodId?: string }
  },
  recapVodId?: string,
): string | undefined {
  return [detail?.availability?.vodId, detail?.vodId, detail?.stream?.vodId, recapVodId]
    .map(normalizeAnalyticsVodId)
    .find((id): id is string => Boolean(id))
}

export type VodLinkStatus = 'linked' | 'live' | 'syncing' | 'unavailable' | 'request_failed'

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
    stream?: { vodId?: string; endedAt?: string | null; lifecycleState?: 'unknown' | 'confirmed_live' | 'confirmed_ended' }
    availability?: {
      vodState?: string
      vodId?: string
      vodMessage?: string
      liveDvrState?: string
    }
  }
  recapVodId?: string
  fallbackVodId?: string
  isLiveCollector?: boolean
  channelIsLive?: boolean
}): VodLinkState {
  const authored = input.detail?.availability
  const authoredState = (authored?.vodState ?? '').trim().toLowerCase()
  const detailState = (input.detail?.state ?? '').trim().toLowerCase()
  const liveDvrState = (authored?.liveDvrState ?? '').trim().toLowerCase()
  const lifecycleState = input.detail?.stream?.lifecycleState
  const lifecycleUnknown = lifecycleState === 'unknown'
  const pastDetail = detailState === 'historical' || liveDvrState === 'ended'
  const pastEvidence = lifecycleState === 'confirmed_ended'
    || (lifecycleState !== 'confirmed_live' && pastDetail)
  const liveEvidence = lifecycleState === 'confirmed_live'
    || (lifecycleState == null && !pastDetail && (input.isLiveCollector === true || input.channelIsLive === true))
  // Archive copy can lag lifecycle status across independent polls. Once the
  // session is marked past, an older source message cannot assert live.
  const vodMessage = pastEvidence ? '' : (authored?.vodMessage?.trim() ?? '')
  const vodId =
    resolveAnalyticsVodId(input.detail, input.recapVodId)
    || normalizeAnalyticsVodId(input.fallbackVodId)
    || undefined

  // A concrete Twitch archive ID is stronger than a transient live/resolving
  // state. Twitch can publish the archive before the availability poll catches
  // up; keep the link usable instead of hiding it behind stale status text.
  if (vodId && (authoredState === 'pending_live' || authoredState === 'resolving')) {
    const liveArchive = liveEvidence
    return {
      status: 'linked',
      vodId,
      label: liveArchive ? 'Jump to VOD (live archive)' : 'Jump to VOD',
      detail:
        vodMessage
        || (liveArchive
          ? 'Twitch is archiving this broadcast. Timestamps track stream offset from go-live.'
          : ''),
    }
  }

  if (authoredState === 'pending_live') {
    if (lifecycleState === 'confirmed_ended') return {
      status: 'unavailable', label: 'VOD not linked',
      detail: 'This broadcast is confirmed ended. A fresh archive check has not verified a link yet.',
    }
    if (pastDetail) return {
      status: 'unavailable', label: 'VOD not linked',
      detail: 'This session is marked as past. A fresh archive check has not verified a link yet.',
    }
    if (lifecycleUnknown || !liveEvidence) return {
      status: 'unavailable', label: 'VOD not linked',
      detail: 'Analytics are available, but no verified archive link is available. Broadcast lifecycle and archive availability are unknown.',
    }
    return {
      status: 'live',
      label: 'Live — no VOD yet',
      detail:
        vodMessage
        || 'This session is still live. A timestamped VOD link appears once Twitch publishes a live archive for this stream (Helix stream match).',
    }
  }

  if (authoredState === 'resolving') {
    return {
      status: 'syncing',
      label: 'Waiting for Twitch VOD',
      detail: lifecycleUnknown ? 'Waiting for an archive link. Broadcast lifecycle remains unknown.' : vodMessage || 'Waiting for Twitch VOD publication.',
    }
  }

  if (authoredState === 'request_failed') {
    return {
      status: 'request_failed',
      label: 'VOD lookup failed',
      detail: vodMessage || 'Could not reach Twitch to resolve the archive. Retry later.',
    }
  }

  if (authoredState === 'unavailable') {
    return {
      status: 'unavailable',
      label: 'VOD unavailable',
      detail:
        vodMessage
        || 'No verified Twitch VOD link is available for this session. This does not establish whether an archive exists.',
    }
  }

  if (vodId) {
    const liveArchive = liveEvidence
    return {
      status: 'linked',
      vodId,
      label: liveArchive ? 'Jump to VOD (live archive)' : 'Jump to VOD',
      detail:
        vodMessage
        || (liveArchive
          ? 'Twitch is archiving this broadcast. Timestamps track stream offset from go-live.'
          : ''),
    }
  }

  const syncing =
    detailState === 'syncing'
    || Boolean(input.detail?.syncPhase?.trim())
  if (syncing) {
    return {
      status: 'syncing',
      label: 'VOD syncing…',
      detail: 'The VOD archive is still syncing. The Twitch link will appear once the VOD ID resolves.',
    }
  }

  const endedAt = input.detail?.stream?.endedAt?.trim()
  if (input.detail?.stream?.lifecycleState === 'unknown') return {
    status: 'unavailable', label: 'VOD not linked',
    detail: 'No verified archive link is available. Broadcast lifecycle and archive availability are unknown.',
  }
  const sessionEnded =
    Boolean(endedAt)
    || liveDvrState === 'ended'
    || detailState === 'historical'
  const channelLive = input.channelIsLive
  const isLive = !pastEvidence && (input.isLiveCollector ?? (
    channelLive !== false
    && liveDvrState !== 'ended'
    && detailState !== 'historical'
    && (detailState === 'live' || !endedAt)
  ))
  if (channelLive === false && !vodId && sessionEnded) {
    return {
      status: 'syncing',
      label: 'Waiting for Twitch VOD',
      detail: vodMessage || 'Stream ended — waiting for Twitch VOD publication.',
    }
  }
  if (isLive) {
    return {
      status: 'live',
      label: 'Live — no VOD yet',
      detail: 'This session is still live. A timestamped VOD link appears once Twitch publishes a live archive for this stream (Helix stream match).',
    }
  }

  return {
    status: 'unavailable',
    label: 'VOD not linked',
    detail: 'No verified Twitch VOD link is available for this session. This does not establish whether an archive exists.',
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
