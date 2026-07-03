import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import {
  fetchPortalStreamRecap,
  formatStreamOffset,
  type PortalRecapMoment,
  type PortalStreamRecapResponse,
} from '../../../lib/streamcloneAnalytics'
import { compact } from './hubFormat'

export interface PortalMomentInspectorProps {
  streamId?: string
}

export function PortalMomentInspector({ streamId }: PortalMomentInspectorProps) {
  const [recap, setRecap] = useState<PortalStreamRecapResponse | null>(null)
  const [selected, setSelected] = useState<PortalRecapMoment | null>(null)
  const [loading, setLoading] = useState(Boolean(streamId))

  useEffect(() => {
    if (!streamId) {
      setRecap(null)
      setSelected(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchPortalStreamRecap(streamId).then((data) => {
      if (cancelled) return
      setRecap(data)
      setSelected(data?.topMoments?.[0] ?? null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [streamId])

  const moments = useMemo(() => recap?.topMoments ?? [], [recap?.topMoments])

  if (!streamId) {
    return (
      <aside className="hub-moment-inspector hub-moment-inspector--empty" aria-label="Moment inspector">
        <p className="muted">Select a stream in the console to inspect backend-ranked peaks.</p>
      </aside>
    )
  }

  if (loading) {
    return <aside className="hub-moment-inspector" aria-busy="true" aria-label="Moment inspector" />
  }

  if (moments.length === 0) {
    return (
      <aside className="hub-moment-inspector hub-moment-inspector--empty" aria-label="Moment inspector">
        <p className="muted">No recap moments yet for this session. Sync chat or wait for rollups to populate.</p>
      </aside>
    )
  }

  const active = selected ?? moments[0]
  const topEmote = active.topEmotes?.[0]

  return (
    <aside className="hub-moment-inspector" aria-label="Moment inspector">
      <div className="hub-moment-inspector__head">
        <Activity size={14} aria-hidden="true" />
        <span>Moment inspector</span>
      </div>
      <div className="hub-moment-inspector__time">{formatStreamOffset(active.offsetSeconds)}</div>
      <p className="hub-moment-inspector__label">{active.reasons?.join(' · ') || 'Backend-detected spike'}</p>
      <dl className="hub-moment-inspector__grid">
        <div><dt>Score</dt><dd>{active.score}</dd></div>
        <div><dt>Chat</dt><dd>{compact(active.chatCount ?? 0)}</dd></div>
        <div><dt>Emotes</dt><dd>{compact(active.emoteCount ?? 0)}</dd></div>
        <div><dt>Top emote</dt><dd>{topEmote?.code ?? '—'}</dd></div>
      </dl>
      <ul className="hub-moment-inspector__list" aria-label="Most reacted minutes">
        {moments.slice(0, 6).map((moment) => (
          <li key={moment.offsetSeconds}>
            <button
              type="button"
              className={moment.offsetSeconds === active.offsetSeconds ? 'is-active' : undefined}
              onClick={() => setSelected(moment)}
            >
              <span className="t">{formatStreamOffset(moment.offsetSeconds)}</span>
              <span className="s">{moment.reasons?.[0] ?? `Score ${moment.score}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
