import { apiClient } from './apiClient'

export type ClipCandidateStatus = 'new' | 'saved' | 'dismissed'
export type ClipSourceStatus = 'unknown' | 'available' | 'missing' | 'restricted'

export interface ClipCandidateEmote {
  provider?: string
  id?: string
  name: string
  count: number
  imageUrl?: string
}

export interface ClipCandidateState {
  id?: string
  candidateId?: string
  status: ClipCandidateStatus
  titleOverride?: string
  startSecondsOverride?: number
  endSecondsOverride?: number
  notes?: string
}

export interface ClipCandidate {
  id: string
  login: string
  streamId: string
  vodId?: string
  streamTitle?: string
  streamCategory?: string
  offsetSeconds: number
  startSeconds: number
  endSeconds: number
  score: number
  confidence?: number
  reason: string
  chatCount?: number
  emoteCount?: number
  viewerCount?: number
  topEmotes?: ClipCandidateEmote[]
  sourceKind: string
  sourceStatus: ClipSourceStatus
  coverageState?: string
  state?: ClipCandidateState
  job?: ClipCandidateJob
  createdAt?: string
  updatedAt?: string
}

export interface ClipCandidateListResponse {
  items: ClipCandidate[]
  nextCursor?: string
}

export type ClipCandidateJobStatus = 'queued' | 'ready' | 'failed' | 'source_unavailable'

export interface ClipCandidateJob {
  id: string
  candidateId: string
  status: ClipCandidateJobStatus
  replayForgeJobId?: string
  replayForgeState?: string
  errorCode?: string
  errorMessage?: string
  submittedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface ClipCandidateQuery {
  login?: string
  streamId?: string
  status?: ClipCandidateStatus
  limit?: number
}

export interface ClipCandidateStatePatch {
  status?: ClipCandidateStatus
  titleOverride?: string
  startSecondsOverride?: number
  endSecondsOverride?: number
  notes?: string
}

function clipPath(path = ''): string {
  return `/v1/pulse/clips${path}`
}

function queryString(query: ClipCandidateQuery): string {
  const params = new URLSearchParams()
  if (query.login?.trim()) params.set('login', query.login.trim().toLowerCase())
  if (query.streamId?.trim()) params.set('streamId', query.streamId.trim())
  if (query.status) params.set('status', query.status)
  if (query.limit && query.limit > 0) params.set('limit', String(query.limit))
  const value = params.toString()
  return value ? `?${value}` : ''
}

export async function fetchClipCandidates(
  query: ClipCandidateQuery = {},
): Promise<ClipCandidateListResponse> {
  const result = await apiClient<ClipCandidateListResponse>(`${clipPath()}${queryString(query)}`, {
    gated: true,
  })
  return result.data
}

export async function updateClipCandidateState(
  id: string,
  patch: ClipCandidateStatePatch,
): Promise<ClipCandidateState> {
  const result = await apiClient<ClipCandidateState>(clipPath(`/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    gated: true,
    body: patch as Record<string, unknown>,
  })
  return result.data
}

export async function sendClipCandidateToReplayForge(id: string): Promise<ClipCandidateJob> {
  const result = await apiClient<ClipCandidateJob>(clipPath(`/${encodeURIComponent(id)}/replayforge`), {
    method: 'POST',
    gated: true,
  })
  return result.data
}

export async function refreshClipCandidateReplayForgeJob(id: string): Promise<ClipCandidateJob> {
  const result = await apiClient<ClipCandidateJob>(clipPath(`/${encodeURIComponent(id)}/replayforge`), {
    gated: true,
  })
  return result.data
}

export function clipCandidateStatus(candidate: ClipCandidate): ClipCandidateStatus {
  return candidate.state?.status ?? 'new'
}

/** User-visible ReplayForge job label — worker ready is not portal playable. */
export function clipJobDisplayStatus(job: ClipCandidateJob): string {
  if (job.status === 'queued') return 'Rendering queued'
  if (job.status === 'ready') return 'Worker ready (playback not verified)'
  if (job.status === 'source_unavailable') return 'Source unavailable'
  if (job.status === 'failed') return 'Render failed'
  return job.status
}

export function clipCandidateRangeLabel(candidate: Pick<ClipCandidate, 'startSeconds' | 'endSeconds'>): string {
  return `${formatOffset(candidate.startSeconds)} - ${formatOffset(candidate.endSeconds)}`
}

export function formatOffset(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}
