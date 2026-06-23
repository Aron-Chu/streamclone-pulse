import type {
  CreatePulseBookmarkInput,
  ExtensionClip,
  ExtensionHealthResponse,
  PastVodRow,
  PulseBackfillJob,
  PulseBookmark,
  PulsePayload,
} from '../shared/messages.ts'
import { clipWindowBounds, pickTopClip } from '../shared/clips.ts'
import {
  mergePastVodRows,
  type AnalyticsStreamListItem,
  type MetadataStreamHistoryItem,
} from '../shared/pastVods.ts'
import { getBackendUrl } from '../shared/storage.ts'

export async function fetchExtensionHealth(baseUrl?: string): Promise<ExtensionHealthResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/extension/health`)
  if (!res.ok) {
    throw new Error(`health ${res.status}`)
  }
  return res.json() as Promise<ExtensionHealthResponse>
}

export async function fetchPulseChannel(
  login: string,
  options?: { window?: 'recent' | 'full'; baseUrl?: string },
): Promise<PulsePayload> {
  const root = options?.baseUrl ?? await getBackendUrl()
  const qs = options?.window === 'full' ? '?window=full' : ''
  const res = await fetch(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}${qs}`)
  if (!res.ok) {
    throw new Error(`pulse ${res.status}`)
  }
  return res.json() as Promise<PulsePayload>
}

export interface PulseBackfillRequest {
  streamId: string
  mode?: 'missed'
  fromOffsetSeconds?: number
  toOffsetSeconds?: number
}

export async function postPulseBackfill(
  login: string,
  body: PulseBackfillRequest,
  baseUrl?: string,
): Promise<PulseBackfillJob> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}/backfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'missed', ...body }),
  })
  if (!res.ok) {
    throw new Error(`backfill ${res.status}`)
  }
  return res.json() as Promise<PulseBackfillJob>
}

export async function fetchPulseBackfillStatus(jobId: string, baseUrl?: string): Promise<PulseBackfillJob> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/extension/pulse/backfill/${encodeURIComponent(jobId)}`)
  if (!res.ok) {
    throw new Error(`backfill_status ${res.status}`)
  }
  return res.json() as Promise<PulseBackfillJob>
}

export async function postWatchChannel(login: string, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/analytics/channels/${encodeURIComponent(login)}/watch`, {
    method: 'POST',
  })
  if (!res.ok && res.status !== 202) {
    throw new Error(`watch ${res.status}`)
  }
}

export async function fetchPulseBookmarks(
  params: { login?: string; streamId?: string; vodId?: string },
  baseUrl?: string,
): Promise<PulseBookmark[]> {
  const root = baseUrl ?? await getBackendUrl()
  const qs = new URLSearchParams()
  if (params.login) qs.set('login', params.login)
  if (params.streamId) qs.set('streamId', params.streamId)
  if (params.vodId) qs.set('vodId', params.vodId)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await fetch(`${root}/v1/pulse/bookmarks${suffix}`)
  if (!res.ok) {
    throw new Error(`bookmarks ${res.status}`)
  }
  const body = await res.json() as { items?: PulseBookmark[] }
  return body.items ?? []
}

export async function createPulseBookmark(
  bookmark: CreatePulseBookmarkInput,
  baseUrl?: string,
): Promise<PulseBookmark> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/pulse/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookmark),
  })
  if (!res.ok) {
    throw new Error(`bookmark ${res.status}`)
  }
  return res.json() as Promise<PulseBookmark>
}

export async function deletePulseBookmark(id: string, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/pulse/bookmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`delete_bookmark ${res.status}`)
  }
}

export async function fetchAlwaysTracked(baseUrl?: string): Promise<string[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/analytics/always-tracked`)
  if (!res.ok) {
    throw new Error(`always_tracked ${res.status}`)
  }
  const body = await res.json() as { channels?: string[] }
  return body.channels ?? []
}

export async function setAlwaysTracked(login: string, track: boolean, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/analytics/always-tracked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: login, track }),
  })
  if (!res.ok) {
    throw new Error(`always_tracked_set ${res.status}`)
  }
}

interface ClipsResponseBody {
  items?: ExtensionClip[]
}

interface StreamHistoryResponseBody {
  items?: MetadataStreamHistoryItem[]
}

interface AnalyticsStreamsResponseBody {
  items?: AnalyticsStreamListItem[]
}

export async function fetchChannelStreamHistory(
  login: string,
  period: '30d' | 'all' = '30d',
  baseUrl?: string,
): Promise<MetadataStreamHistoryItem[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(
    `${root}/v1/channels/${encodeURIComponent(login)}/streams/history?period=${encodeURIComponent(period)}`,
  )
  if (!res.ok) {
    throw new Error(`stream_history ${res.status}`)
  }
  const body = await res.json() as StreamHistoryResponseBody
  return body.items ?? []
}

export async function fetchAnalyticsStreams(
  login: string,
  limit = 20,
  baseUrl?: string,
): Promise<AnalyticsStreamListItem[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(
    `${root}/v1/analytics/channels/${encodeURIComponent(login)}/streams?limit=${encodeURIComponent(limit)}`,
  )
  if (!res.ok) {
    throw new Error(`analytics_streams ${res.status}`)
  }
  const body = await res.json() as AnalyticsStreamsResponseBody
  return body.items ?? []
}

/** Best-effort merge of metadata history + analytics streams (never throws). */
export async function fetchPastVodRows(
  login: string,
  options?: { liveStreamId?: string | null; isLive?: boolean },
  baseUrl?: string,
): Promise<PastVodRow[]> {
  const [historyResult, analyticsResult] = await Promise.allSettled([
    fetchChannelStreamHistory(login, '30d', baseUrl),
    fetchAnalyticsStreams(login, 20, baseUrl),
  ])
  const history = historyResult.status === 'fulfilled' ? historyResult.value : undefined
  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : undefined
  return mergePastVodRows(history, analytics, options)
}

/** Best-effort top clip by viewCount from metadata /clips (never throws). */
export async function fetchTopClip(
  login: string,
  options?: { startedAt?: string; isLive?: boolean },
  baseUrl?: string,
): Promise<ExtensionClip | null> {
  try {
    const root = baseUrl ?? await getBackendUrl()
    const { startedAt, endedAt } = clipWindowBounds(options?.startedAt, options?.isLive)
    const qs = new URLSearchParams({ startedAt, endedAt, cursor: '' })
    const res = await fetch(`${root}/v1/channels/${encodeURIComponent(login)}/clips?${qs}`)
    if (!res.ok) return null
    const body = await res.json() as ClipsResponseBody
    return pickTopClip(body.items ?? [])
  } catch {
    return null
  }
}
