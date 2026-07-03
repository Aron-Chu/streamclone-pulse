import { useEffect, useState } from 'react'
import { Download, Play } from 'lucide-react'
import { fetchPortalStreamSummary, type PortalStreamSummary } from '../../../lib/streamcloneAnalytics'
import { compact } from './hubFormat'

export interface SessionHeaderBarProps {
  login: string
  streamId?: string
}

export function SessionHeaderBar({ login, streamId }: SessionHeaderBarProps) {
  const [summary, setSummary] = useState<PortalStreamSummary | null>(null)
  const [loading, setLoading] = useState(Boolean(streamId))

  useEffect(() => {
    if (!streamId) {
      setSummary(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchPortalStreamSummary(streamId).then((data) => {
      if (!cancelled) {
        setSummary(data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [streamId])

  const stream = summary?.stream
  const metrics = summary?.metrics
  const label = stream?.displayName?.trim() || login
  const category = stream?.category?.trim() || 'Channel analytics'
  const started = stream?.startedAt ? new Date(stream.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  const stats = streamId && metrics
    ? [
        { label: 'viewers', value: compact(stream?.currentViewers ?? stream?.peakViewers ?? 0), suffix: '', tone: 'text' },
        { label: 'chat / min', value: compact(Math.round(metrics.chat_per_min)), suffix: '/m', tone: 'accent' },
        { label: '7TV / min', value: compact(Math.round(metrics.seventv_per_min)), suffix: '/m', tone: 'cyan' },
        { label: 'reaction', value: compact(Math.round(metrics.reaction_score_0_100 ?? 0)), suffix: '', tone: 'amber' },
        { label: 'VOD conf.', value: compact(Math.round(metrics.data_coverage_pct ?? 0)), suffix: '%', tone: 'good' },
      ]
    : []

  return (
    <div className="hub-session-bar" aria-label="Session summary">
      <div className="hub-session-bar__id">
        <div className="hub-session-bar__av" aria-hidden="true">{label.slice(0, 2).toUpperCase()}</div>
        <div>
          <div className="hub-session-bar__title">{label} — {category}</div>
          <div className="hub-session-bar__meta">
            {started ? `${started}` : login}
            {streamId ? ` · session ${streamId.slice(0, 8)}…` : ' · pick a stream in the console'}
            {metrics?.sync_health_state ? ` · ${metrics.sync_health_state}` : ''}
          </div>
        </div>
      </div>
      {streamId ? (
        <>
          <div className="hub-session-bar__stats" aria-busy={loading}>
            {loading && stats.length === 0
              ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="hub-session-bar__stat hub-session-bar__stat--sk" />)
              : stats.map((stat) => (
                  <div key={stat.label} className={`hub-session-bar__stat is-${stat.tone}`}>
                    <span className="lbl">{stat.label}</span>
                    <strong>{stat.value}<small>{stat.suffix}</small></strong>
                  </div>
                ))}
          </div>
          <div className="hub-session-bar__actions">
            <button type="button" className="hub-openbtn hub-openbtn--ghost" disabled>
              <Download size={13} aria-hidden="true" /> Export
            </button>
            {stream?.vodId ? (
              <a className="hub-openbtn" href={`https://www.twitch.tv/videos/${stream.vodId}`} target="_blank" rel="noreferrer">
                <Play size={13} aria-hidden="true" /> Open VOD
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
