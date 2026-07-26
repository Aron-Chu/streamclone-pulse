import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, CheckCircle2, Clock, MessageSquare, TrendingUp, Zap } from 'lucide-react'
import type { HubEmote, HubMoment, HubMomentKind } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact } from './hubFormat'
import { EmoteImg } from './EmoteImg'

interface MomentsFeedProps {
  moments: HubMoment[]
  loading?: boolean
}

function MomentEmoteChips({ emotes }: { emotes?: HubEmote[] }) {
  if (!emotes || emotes.length === 0) return null
  return (
    <div className="dash-feed__emotes" aria-label="Moment top emotes">
      {emotes.slice(0, 4).map((emote, index) => (
        <span className="dash-feed__emote" key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}>
          <EmoteImg src={emote.imageUrl} name={emote.name} />
          <span>{emote.name}</span>
          {emote.count > 0 ? <small>{compact(emote.count)}</small> : null}
        </span>
      ))}
    </div>
  )
}

function kindMeta(kind: HubMomentKind): { icon: ReactNode; color: string; tone: string } {
  switch (kind) {
    case 'live_attach':
      return { icon: <Zap aria-hidden="true" />, color: 'hsl(var(--sc-chart-2))', tone: 'hsl(var(--sc-chart-2) / 0.15)' }
    case 'chat_spike':
      return { icon: <MessageSquare aria-hidden="true" />, color: 'hsl(var(--sc-chart-1))', tone: 'hsl(var(--sc-chart-1) / 0.15)' }
    case 'emote_spike':
      return { icon: <TrendingUp aria-hidden="true" />, color: 'hsl(var(--sc-chart-5))', tone: 'hsl(var(--sc-chart-5) / 0.15)' }
    case 'backfill_queued':
      return { icon: <Clock aria-hidden="true" />, color: 'hsl(var(--sc-chart-4))', tone: 'hsl(var(--sc-chart-4) / 0.15)' }
    case 'backfill_done':
      return { icon: <CheckCircle2 aria-hidden="true" />, color: 'hsl(var(--sc-chart-3))', tone: 'hsl(var(--sc-chart-3) / 0.15)' }
    default:
      return { icon: <Activity aria-hidden="true" />, color: 'hsl(var(--sc-muted-foreground))', tone: 'hsl(var(--sc-muted) / 0.6)' }
  }
}

function relativeTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const ms = at > 1e12 ? at : at * 1000
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

export function MomentsFeed({ moments, loading = false }: MomentsFeedProps) {
  return (
    <section className="dash-card" aria-labelledby="dash-mf-h">
      <div className="dash-card-header row">
        <div className="dash-card-title" id="dash-mf-h">
          Moments feed
        </div>
        <span className="dash-badge dash-badge--secondary">
          <span className="dot pulse" style={{ background: 'hsl(var(--sc-chart-5))' }} aria-hidden="true" />
          Live
        </span>
      </div>
      <div className="dash-card-content dash-feed">
        {loading && moments.length === 0 ? (
          <Skeleton height={200} radius="var(--sc-radius)" />
        ) : moments.length === 0 ? (
          <div className="dash-empty">
            <Activity aria-hidden="true" />
            <span>No recent activity — events appear as channels go live and chat spikes.</span>
          </div>
        ) : (
          moments.slice(0, 6).map((moment, index) => {
            const meta = kindMeta(moment.kind)
            const name = moment.displayName?.trim() || moment.login?.trim() || ''
            const login = moment.login?.trim().toLowerCase() ?? ''
            const streamId = moment.streamId?.trim() ?? ''
            const streamHref = login
              ? streamId
                ? `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
                : `/analytics/${encodeURIComponent(login)}`
              : ''
            const rawLabel = moment.label ?? ''
            const label =
              name && rawLabel.toLowerCase().startsWith(name.toLowerCase())
                ? rawLabel.slice(name.length).replace(/^[\s:·–-]+/, '')
                : rawLabel
            return (
              <div className="ev" key={`${moment.kind}-${moment.at}-${index}`}>
                <span className="ic" style={{ background: meta.tone, color: meta.color }}>
                  {meta.icon}
                </span>
                <div className="body">
                  <div className="t">
                    {name ? <b>{name} </b> : null}
                    {label}
                    {moment.detail ? <span style={{ color: 'hsl(var(--sc-muted-foreground))' }}> · {moment.detail}</span> : null}
                    {moment.magnitude != null && moment.magnitude > 0 ? (
                      <span style={{ color: 'hsl(var(--sc-muted-foreground))' }}> · +{Math.round(moment.magnitude)}%</span>
                    ) : null}
                  </div>
                  <div className="tm">
                    {relativeTime(moment.at)}
                    {streamHref ? (
                      <>
                        {' · '}
                        <Link to={streamHref} className="dash-feed__open">Open stream</Link>
                      </>
                    ) : null}
                  </div>
                  <MomentEmoteChips emotes={moment.topEmotes} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
