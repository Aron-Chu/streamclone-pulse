import type { ActivitySummary } from '../../../lib/hubActivitySummary'
import { formatActivityWindowLabel } from '../../../lib/hubActivitySummary'
import type { PublicHub } from '../../../lib/publicHub'
import { compact } from './hubFormat'

export interface HubCommandHeaderProps {
  hub: PublicHub
  activitySummary: ActivitySummary
  loading?: boolean
}

export function HubCommandHeader({ hub, activitySummary, loading }: HubCommandHeaderProps) {
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes)
  const peakViewers = hub.activity.points.reduce((max, point) => Math.max(max, point.viewers), 0)
  const peakChat = hub.activity.points.reduce((max, point) => Math.max(max, point.chat), 0)

  const kpis = [
    {
      label: 'Live in pool',
      value: compact(hub.liveChannels.length),
      tone: 'accent' as const,
    },
    {
      label: 'Tracked streams',
      value: compact(hub.corpus.streamsTracked),
      tone: 'neutral' as const,
    },
    {
      label: 'Peak viewers',
      value: peakViewers > 0 ? compact(peakViewers) : '—',
      tone: 'viewers' as const,
      sub: `last ${windowLabel}`,
    },
    {
      label: 'Peak chat/min',
      value: peakChat > 0 ? compact(peakChat) : '—',
      tone: 'chat' as const,
      sub: `last ${windowLabel}`,
    },
    {
      label: 'Emotes/min',
      value: hub.emoteIntel.emotesPerMin > 0 ? compact(hub.emoteIntel.emotesPerMin) : '—',
      tone: 'chat' as const,
    },
    {
      label: 'Activity buckets',
      value: loading ? '…' : `${activitySummary.pointCount}/${activitySummary.expectedBuckets}`,
      tone: 'neutral' as const,
      sub: `${Math.round(activitySummary.coveragePct)}% filled`,
    },
  ]

  return (
    <header className="hub-command-header" aria-labelledby="hub-command-title">
      <div className="hub-command-header__copy">
        <p className="hub-command-header__eyebrow">Stream intelligence</p>
        <h1 id="hub-command-title" className="hub-command-header__title">
          Command center
        </h1>
        <p className="hub-command-header__lede">
          What is happening across tracked Twitch channels right now — live spikes, network activity, and emote
          velocity from the hosted API.
        </p>
      </div>
      <div className="hub-command-header__kpis" aria-label="Network snapshot">
        {kpis.map(({ label, value, tone, sub }) => (
          <div key={label} className={`hub-command-header__kpi hub-command-header__kpi--${tone}`}>
            <span className="hub-command-header__kpi-label">
              {label === 'Live in pool' ? (
                <span className="hub-command-header__kpi-live" aria-hidden="true" />
              ) : null}
              {label}
            </span>
            <strong className="hub-command-header__kpi-value">{loading ? '…' : value}</strong>
            {sub ? <span className="hub-command-header__kpi-sub">{sub}</span> : null}
          </div>
        ))}
      </div>
    </header>
  )
}
