import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Save, Scissors, Send, X } from 'lucide-react'
import {
  clipCandidateRangeLabel,
  clipCandidateStatus,
  clipJobDisplayStatus,
  fetchClipCandidates,
  refreshClipCandidateReplayForgeJob,
  sendClipCandidateToReplayForge,
  updateClipCandidateState,
  type ClipCandidate,
  type ClipCandidateJob,
  type ClipCandidateStatus,
} from '../../lib/clipCandidates'
import { Badge, Button, EmptyState, Skeleton } from '../../ui/primitives'
import './clips.css'

const STATUS_FILTERS: Array<{ label: string; value: ClipCandidateStatus | 'all' }> = [
  { label: 'New', value: 'new' },
  { label: 'Saved', value: 'saved' },
  { label: 'Dismissed', value: 'dismissed' },
  { label: 'All', value: 'all' },
]

function statusLabel(status: ClipCandidateStatus): string {
  if (status === 'saved') return 'Saved'
  if (status === 'dismissed') return 'Dismissed'
  return 'New'
}

function reasonLabel(reason: string): string {
  return reason
}

function sourceWarning(candidate: ClipCandidate): string | null {
  if (candidate.sourceStatus === 'missing') return 'Source unavailable'
  if (candidate.sourceStatus === 'restricted') return 'Source restricted'
  if (candidate.coverageState && candidate.coverageState !== 'ready') return `Coverage ${candidate.coverageState}`
  return null
}

function confidenceLabel(value?: number): string {
  if (!Number.isFinite(value ?? NaN)) return 'Confidence unknown'
  return `${Math.round((value ?? 0) * 100)}% confidence`
}

interface ClipCandidateCardProps {
  candidate: ClipCandidate
  job?: ClipCandidateJob
  busy: boolean
  sendBusy: boolean
  refreshBusy: boolean
  onSetStatus: (candidate: ClipCandidate, status: ClipCandidateStatus) => void
  onSendReplayForge: (candidate: ClipCandidate) => void
  onRefreshReplayForge: (candidate: ClipCandidate) => void
}

function replayForgeLabel(job?: ClipCandidateJob): string | null {
  if (!job) return null
  return clipJobDisplayStatus(job)
}

function ClipCandidateCard({
  candidate,
  job,
  busy,
  sendBusy,
  refreshBusy,
  onSetStatus,
  onSendReplayForge,
  onRefreshReplayForge,
}: ClipCandidateCardProps) {
  const status = clipCandidateStatus(candidate)
  const warning = sourceWarning(candidate)
  const title = candidate.state?.titleOverride || candidate.streamTitle || `${candidate.login} moment`
  const canSendReplayForge = candidate.sourceStatus === 'available' && Boolean(candidate.vodId)
  const replayForgeStatus = replayForgeLabel(job)

  return (
    <article className="clips-card" aria-label={`${candidate.login} clip candidate`}>
      <div className="clips-card__main">
        <div className="clips-card__meta">
          <Badge variant={status === 'saved' ? 'success' : status === 'dismissed' ? 'warning' : 'info'}>
            {statusLabel(status)}
          </Badge>
          <Badge variant="outline">{reasonLabel(candidate.reason)}</Badge>
          {warning ? <Badge variant="warning">{warning}</Badge> : null}
          {replayForgeStatus ? <Badge variant={job?.status === 'queued' ? 'info' : job?.status === 'ready' ? 'success' : 'warning'}>{replayForgeStatus}</Badge> : null}
        </div>
        <h2>{title}</h2>
        <div className="clips-card__subline">
          <span>{candidate.login}</span>
          {candidate.streamCategory ? <span>{candidate.streamCategory}</span> : null}
          <span>{clipCandidateRangeLabel(candidate)}</span>
        </div>
        <div className="clips-card__metrics" aria-label="Clip signal metrics">
          <span><b>{candidate.score}</b> score</span>
          <span>{confidenceLabel(candidate.confidence)}</span>
          {candidate.chatCount ? <span>{candidate.chatCount} chat/min</span> : null}
          {candidate.emoteCount ? <span>{candidate.emoteCount} emotes</span> : null}
        </div>
        {candidate.topEmotes?.length ? (
          <div className="clips-card__emotes" aria-label="Top emotes">
            {candidate.topEmotes.slice(0, 5).map((emote) => (
              <span key={`${emote.provider ?? 'emote'}:${emote.name}`} className="clips-emote">
                {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" /> : null}
                <span>{emote.name}</span>
                <b>{emote.count}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="clips-card__actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || status === 'saved'}
          onClick={() => onSetStatus(candidate, 'saved')}
        >
          <Save size={15} aria-hidden="true" />
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || status === 'dismissed'}
          onClick={() => onSetStatus(candidate, 'dismissed')}
        >
          <X size={15} aria-hidden="true" />
          Dismiss
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={sendBusy || !canSendReplayForge || job?.status === 'queued' || job?.status === 'ready'}
          title={canSendReplayForge ? 'Queue this candidate in ReplayForge' : 'Source video is unavailable'}
          onClick={() => onSendReplayForge(candidate)}
        >
          <Send size={15} aria-hidden="true" />
          {job?.status === 'queued' ? 'Queued' : canSendReplayForge ? 'Send to ReplayForge' : 'ReplayForge blocked'}
        </Button>
        {job?.status === 'queued' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={refreshBusy}
            title="Refresh ReplayForge job status"
            onClick={() => onRefreshReplayForge(candidate)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh ReplayForge
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled title="Rendering starts in Phase 2">
          <Scissors size={15} aria-hidden="true" />
          Render
        </Button>
        <Button size="sm" variant="outline" disabled title="Exports start in Phase 2">
          <Download size={15} aria-hidden="true" />
          Export
        </Button>
      </div>
    </article>
  )
}

export default function ClipsPage() {
  const [status, setStatus] = useState<ClipCandidateStatus | 'all'>('new')
  const [items, setItems] = useState<ClipCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyID, setBusyID] = useState<string | null>(null)
  const [sendBusyID, setSendBusyID] = useState<string | null>(null)
  const [refreshBusyID, setRefreshBusyID] = useState<string | null>(null)
  const [jobsByCandidate, setJobsByCandidate] = useState<Record<string, ClipCandidateJob>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchClipCandidates({
        status: status === 'all' ? undefined : status,
        limit: 50,
      })
      setItems(response.items)
      setJobsByCandidate(
        response.items.reduce<Record<string, ClipCandidateJob>>((next, item) => {
          if (item.job) next[item.id] = item.job
          return next
        }, {}),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clip candidates')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const visibleItems = useMemo(() => items, [items])

  async function setCandidateStatus(candidate: ClipCandidate, nextStatus: ClipCandidateStatus) {
    setBusyID(candidate.id)
    setError(null)
    try {
      const nextState = await updateClipCandidateState(candidate.id, { status: nextStatus })
      setItems((current) =>
        current.map((item) =>
          item.id === candidate.id ? { ...item, state: { ...item.state, ...nextState, status: nextStatus } } : item,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update clip candidate')
    } finally {
      setBusyID(null)
    }
  }

  async function sendCandidate(candidate: ClipCandidate) {
    setSendBusyID(candidate.id)
    setError(null)
    try {
      const job = await sendClipCandidateToReplayForge(candidate.id)
      setJobsByCandidate((current) => ({ ...current, [candidate.id]: job }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue ReplayForge job')
    } finally {
      setSendBusyID(null)
    }
  }

  async function refreshCandidateJob(candidate: ClipCandidate) {
    setRefreshBusyID(candidate.id)
    setError(null)
    try {
      const job = await refreshClipCandidateReplayForgeJob(candidate.id)
      setJobsByCandidate((current) => ({ ...current, [candidate.id]: job }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh ReplayForge job')
    } finally {
      setRefreshBusyID(null)
    }
  }

  return (
    <section className="clips-page" aria-labelledby="clips-title">
      <div className="clips-page__header">
        <div>
          <p className="clips-page__eyebrow">Private queue</p>
          <h1 id="clips-title">StreamPulse Clips</h1>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="clips-tabs" role="tablist" aria-label="Clip candidate status">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={status === option.value}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? <EmptyState tone="error" title={error} /> : null}

      {loading ? (
        <div className="clips-stack" aria-label="Loading clip candidates">
          <Skeleton height={132} />
          <Skeleton height={132} />
        </div>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title="No clip candidates yet"
          description="Candidates appear after tracked streams have enough chat and emote signal."
        />
      ) : (
        <div className="clips-stack">
          {visibleItems.map((candidate) => (
            <ClipCandidateCard
              key={candidate.id}
              candidate={candidate}
              job={jobsByCandidate[candidate.id]}
              busy={busyID === candidate.id}
              sendBusy={sendBusyID === candidate.id}
              refreshBusy={refreshBusyID === candidate.id}
              onSetStatus={setCandidateStatus}
              onSendReplayForge={sendCandidate}
              onRefreshReplayForge={refreshCandidateJob}
            />
          ))}
        </div>
      )}
    </section>
  )
}
