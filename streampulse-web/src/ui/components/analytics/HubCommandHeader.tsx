import type { ActivitySummary } from '../../../lib/hubActivitySummary'
import {
  formatActivityWindowLabel,
  peakActivityChatPerMin,
  peakActivityViewers,
} from '../../../lib/hubActivitySummary'
import { livePoolViewerSum } from '../../../lib/hubMetricHelpers'
import type { PublicHub } from '../../../lib/publicHub'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { compact } from './hubFormat'
import { KpiCard } from './primitives/KpiCard'

export interface HubCommandHeaderProps {
  hub: PublicHub
  activitySummary: ActivitySummary
  loading?: boolean
}

export function HubCommandHeader({ hub, activitySummary, loading }: HubCommandHeaderProps) {
  const labels = useCommandCenterLabels()
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes)
  const peakViewers = peakActivityViewers(hub.activity.points, hub.activity.windowMinutes)
  const peakChat = peakActivityChatPerMin(hub.activity.points, hub.activity.windowMinutes)
  const liveInPool = hub.poolSize > 0 ? hub.poolSize : hub.liveChannels.length
  const ircLabel =
    hub.corpusPipeline.collectorMax > 0
      ? `${hub.corpusPipeline.collectorActive}/${hub.corpusPipeline.collectorMax} IRC`
      : null

  const kpis = [
    {
      label: 'Live in pool',
      value: compact(liveInPool),
      tone: 'accent' as const,
      showLiveDot: true,
      title: 'Channels currently live in the bounded rollup pool (not corpus lifetime total).',
    },
    {
      label: 'Corpus streams',
      value: compact(hub.corpus.streamsTracked),
      tone: 'neutral' as const,
      title: 'Historical streams tracked in the analytics corpus — not all live right now.',
    },
    {
      label: 'Peak viewers',
      value: peakViewers > 0 ? compact(peakViewers) : '—',
      tone: 'viewers' as const,
      sub: `last ${windowLabel}`,
      title:
        'Peak concurrent viewers from corpus minute rollups, merged with Top-500 Helix snapshots when higher (not all of Twitch).',
    },
    {
      label: 'Live pool viewers',
      value: livePoolViewerSum(hub) > 0 ? compact(livePoolViewerSum(hub)) : '—',
      tone: 'viewers' as const,
      title: 'Sum of viewer counts on hub live-channel rows right now (sanity check vs chart peak).',
    },
    {
      label: 'Peak chat/min',
      value: peakChat > 0 ? compact(peakChat) : '—',
      tone: 'chat' as const,
      sub: ircLabel ?? `last ${windowLabel}`,
      title: 'Peak IRC chat messages per minute across channels with active collectors.',
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
        <div className="hub-command-header__copy-top">
          <p className="hub-command-header__eyebrow">{labels.hubEyebrow}</p>
        </div>
        <h1 id="hub-command-title" className="hub-command-header__title">
          {labels.hubTitle}
        </h1>
        <p className="hub-command-header__lede">{labels.hubLede}</p>
      </div>
      <div className="hub-command-header__kpis" aria-label="Network snapshot">
        {kpis.map(({ label, value, tone, sub, title, showLiveDot }) => (
          <KpiCard
            key={label}
            label={label}
            value={value}
            tone={tone}
            sub={sub}
            title={title}
            loading={loading}
            showLiveDot={showLiveDot}
          />
        ))}
      </div>
    </header>
  )
}
