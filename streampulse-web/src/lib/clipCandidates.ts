import { apiClient } from './apiClient'

export type ClipCandidateStatus = 'new' | 'saved' | 'dismissed'
export type ClipSourceStatus = 'unknown' | 'available' | 'missing' | 'restricted'
export type ClipInboxState = 'moment_candidate' | 'needs_source' | 'low_confidence' | 'queueable'
export type ClipRenderabilityStatus =
  | 'not_renderable'
  | 'queueable'
  | 'render_queued'
  | 'worker_ready_unverified'
  | 'render_failed'
export type ClipConfidenceBand = 'high' | 'medium' | 'low'
export type ClipPickReason = string

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
  pickReason?: ClipPickReason
  confidenceBand?: ClipConfidenceBand
  inboxState?: ClipInboxState
  renderabilityStatus?: ClipRenderabilityStatus
  statusCopy?: string
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

export function clipCandidatePickReason(candidate: ClipCandidate): string {
  if (candidate.pickReason?.trim()) return candidate.pickReason.trim()
  if (
    candidate.reason === 'emote_spike'
    && (candidate.chatCount ?? 0) > 0
    && (candidate.emoteCount ?? 0) >= (candidate.chatCount ?? 0) * 2
  ) {
    return 'emote_spike_only'
  }
  if ((candidate.chatCount ?? 0) <= 0 && (candidate.emoteCount ?? 0) > 0) {
    return 'emote_spike_only'
  }
  return candidate.reason
}

export function clipCandidateResolvedInboxState(candidate: ClipCandidate): ClipInboxState {
  if (candidate.inboxState) return candidate.inboxState
  if (candidate.sourceStatus === 'missing' || candidate.sourceStatus === 'restricted' || candidate.sourceStatus === 'unknown') {
    return 'needs_source'
  }
  if (clipCandidatePickReason(candidate) === 'emote_spike_only' || candidate.confidenceBand === 'low') {
    return 'low_confidence'
  }
  if (candidate.sourceStatus === 'available') return 'queueable'
  return 'moment_candidate'
}

export function clipCandidateResolvedRenderability(candidate: ClipCandidate): ClipRenderabilityStatus | undefined {
  if (candidate.renderabilityStatus) return candidate.renderabilityStatus
  if (candidate.job?.status === 'queued') return 'render_queued'
  if (candidate.job?.status === 'ready') return 'worker_ready_unverified'
  if (candidate.job?.status === 'failed') return 'render_failed'
  if (candidate.job?.status === 'source_unavailable') return 'not_renderable'
  if (candidate.sourceStatus === 'missing' || candidate.sourceStatus === 'restricted' || candidate.sourceStatus === 'unknown') {
    return 'not_renderable'
  }
  if (candidate.sourceStatus === 'available') return 'queueable'
  return undefined
}

export function clipCandidateResolvedStatusCopy(candidate: ClipCandidate): string | null {
  if (candidate.statusCopy?.trim()) return candidate.statusCopy.trim()
  if (candidate.sourceStatus === 'missing') {
    return 'High-scoring moment, but no VOD source is linked for rendering.'
  }
  if (clipCandidatePickReason(candidate) === 'emote_spike_only') {
    return 'Emote-heavy minute with weak chat hook. Treat as a lower-confidence editorial pick.'
  }
  return null
}

export function clipCandidateInboxLabel(state?: ClipInboxState): string {
  switch (state) {
    case 'needs_source':
      return 'Needs source'
    case 'low_confidence':
      return 'Low confidence'
    case 'queueable':
      return 'Ready to queue'
    case 'moment_candidate':
      return 'Moment candidate'
    default:
      return 'Moment candidate'
  }
}

export function clipCandidateRenderabilityLabel(status?: ClipRenderabilityStatus): string | null {
  switch (status) {
    case 'not_renderable':
      return 'Not renderable'
    case 'queueable':
      return 'Source available'
    case 'render_queued':
      return 'Render queued'
    case 'worker_ready_unverified':
      return 'Worker ready (playback not verified)'
    case 'render_failed':
      return 'Render failed'
    default:
      return null
  }
}

export function clipCandidateReasonLabel(reason: string): string {
  switch (reason.trim().toLowerCase()) {
    case 'chat_spike':
      return 'Chat spike'
    case 'emote_spike':
      return 'Emote spike'
    case 'emote_spike_only':
      return 'Emote spike only'
    case 'viewer_spike':
      return 'Viewer spike'
    default:
      return reason.replace(/_/g, ' ')
  }
}

export function clipCandidateConfidenceLabel(value?: number, band?: ClipConfidenceBand): string {
  if (band === 'low') return 'Low confidence pick'
  if (band === 'medium') return 'Medium confidence'
  if (band === 'high') return 'High confidence'
  if (!Number.isFinite(value ?? NaN)) return 'Confidence unknown'
  return `${Math.round((value ?? 0) * 100)}% confidence`
}

export function clipCandidateCanQueueReplayForge(candidate: ClipCandidate): boolean {
  const renderability = clipCandidateResolvedRenderability(candidate)
  return candidate.sourceStatus === 'available'
    && Boolean(candidate.vodId)
    && renderability !== 'not_renderable'
    && renderability !== 'render_failed'
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
