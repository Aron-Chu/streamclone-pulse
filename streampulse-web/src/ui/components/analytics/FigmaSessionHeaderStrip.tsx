import { Link } from 'react-router-dom'
import { Download, Play } from 'lucide-react'
import type { FigmaSessionViewModel } from '../../../lib/figmaSessionAnalytics'
import { compact } from './hubFormat'

export interface FigmaSessionHeaderStripProps {
  model: FigmaSessionViewModel
  isLive?: boolean
}

export function FigmaSessionHeaderStrip({ model, isLive = false }: FigmaSessionHeaderStripProps) {
  if (model.state !== 'ready') return null

  const label = model.displayName?.trim() || model.login || 'Featured session'
  const initials = label.slice(0, 2).toUpperCase()
  const login = model.login?.trim().toLowerCase()
  const twitchHref = login ? `https://www.twitch.tv/${encodeURIComponent(login)}` : undefined
  const started = model.startedAt
    ? new Date(model.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Session preview'

  const stats = [
    { label: 'viewers', value: compact(model.viewers ?? 0), suffix: '', tone: 'text' as const },
    { label: 'chat / min', value: compact(Math.round(model.chatPerMin ?? 0)), suffix: '/m', tone: 'accent' as const },
    { label: '7TV / min', value: compact(Math.round(model.seventvPerMin ?? 0)), suffix: '/m', tone: 'cyan' as const },
    { label: 'peaks', value: compact(model.peakCount ?? model.moments.length), suffix: '', tone: 'amber' as const },
    { label: 'VOD conf.', value: compact(Math.round(model.dataCoveragePct ?? 0)), suffix: '%', tone: 'good' as const },
  ]

  return (
    <header className="figma-session-bar" aria-label="Featured session header">
      <div className="figma-session-bar__id">
        <div className="figma-session-bar__av-wrap">
          <div className="figma-session-bar__av" aria-hidden="true">{initials}</div>
          {isLive ? <span className="figma-session-bar__live-dot" aria-label="Live" title="Live now" /> : null}
        </div>
        <div>
          <div className="figma-session-bar__title">
            {model.sessionHref ? (
              <Link to={model.sessionHref} style={{ color: 'inherit', textDecoration: 'none' }}>{label}</Link>
            ) : (
              label
            )}
            {twitchHref ? (
              <>
                {' · '}
                <a className="figma-session-bar__twitch" href={twitchHref} target="_blank" rel="noopener noreferrer">
                  Twitch
                </a>
              </>
            ) : null}
            {model.category ? ` — ${model.category}` : ''}
          </div>
          <div className="figma-session-bar__meta">
            {started}
            {model.demo ? ' · preview layout' : ' · vod synced'}
          </div>
        </div>
      </div>
      <div className="figma-session-bar__divider" aria-hidden="true" />
      <div className="figma-session-bar__stats">
        {stats.map((stat) => (
          <div key={stat.label} className={`figma-session-bar__stat is-${stat.tone}`}>
            <span className="lbl">{stat.label}</span>
            <strong>{stat.value}<small>{stat.suffix}</small></strong>
          </div>
        ))}
      </div>
      <div className="figma-session-bar__actions">
        <button type="button" className="figma-btn" disabled>
          <Download size={11} aria-hidden="true" /> Export
        </button>
        {model.vodHref ? (
          <a className="figma-btn figma-btn--primary" href={model.vodHref} target="_blank" rel="noreferrer">
            <Play size={11} aria-hidden="true" /> Open VOD
          </a>
        ) : model.sessionHref ? (
          <Link className="figma-btn figma-btn--primary" to={model.sessionHref}>
            <Play size={11} aria-hidden="true" /> Full session
          </Link>
        ) : null}
      </div>
    </header>
  )
}
