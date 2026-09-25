import type { ReactNode } from 'react'
import { Zap, PieChart, Smile, TrendingUp } from 'lucide-react'
import type { HubEmoteIntel } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact } from './hubFormat'

interface EmoteIntelKpisProps {
  intel: HubEmoteIntel
  topEmoteName?: string
  peakLogin?: string
  loading?: boolean
}

interface Kpi {
  key: string
  label: string
  value: string
  accent: string
  tone: string
  icon: ReactNode
  meta: ReactNode
}

export function EmoteIntelKpis({ intel, topEmoteName, peakLogin, loading = false }: EmoteIntelKpisProps) {
  if (loading) {
    return (
      <div className="dash-kpis" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} height={132} radius="calc(var(--sc-radius) + 0.25rem)" />
        ))}
      </div>
    )
  }

  const peakAvailable = intel.scope === 'tracked_live_pool'
    && intel.windowMinutes === 30
    && intel.biggestPeakUnit === 'emote_uses_per_channel_minute'
    && typeof intel.asOf === 'string'
    && Number.isFinite(Date.parse(intel.asOf))
  const peakAsOf = peakAvailable
    ? new Date(intel.asOf!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  const kpis: Kpi[] = [
    {
      key: 'epm',
      label: 'Emotes / min (global)',
      value: compact(intel.emotesPerMin),
      accent: 'hsl(var(--sc-chart-2))',
      tone: 'hsl(var(--sc-chart-2) / 0.15)',
      icon: <Zap aria-hidden="true" />,
      meta: <span className="muted">across live rooms</span>,
    },
    {
      key: 'share',
      label: 'Top emote share of measured sends',
      value: `${intel.topEmoteSharePct.toFixed(1)}%`,
      accent: 'hsl(var(--sc-chart-1))',
      tone: 'hsl(var(--sc-chart-1) / 0.15)',
      icon: <PieChart aria-hidden="true" />,
      meta: <span className="muted">{topEmoteName ? `${topEmoteName} · served window` : 'served-window denominator'}</span>,
    },
    {
      key: 'unique',
      label: 'Unique emotes used',
      value: compact(intel.uniqueEmotes),
      accent: 'hsl(var(--sc-chart-3))',
      tone: 'hsl(var(--sc-chart-3) / 0.15)',
      icon: <Smile aria-hidden="true" />,
      meta: <span className="muted">distinct codes seen</span>,
    },
    {
      key: 'peak',
      label: 'Peak emotes / channel / min',
      value: peakAvailable ? compact(intel.biggestPeakPerMin) : '—',
      accent: 'hsl(var(--sc-chart-5))',
      tone: 'hsl(var(--sc-chart-5) / 0.15)',
      icon: <TrendingUp aria-hidden="true" />,
      meta: <span className="muted">{peakAvailable
        ? `${peakLogin ? `${peakLogin} · ` : ''}Tracked live pool · 30 min · through ${peakAsOf}`
        : 'Recent live-pool peak unavailable · scope not declared'}</span>,
    },
  ]

  return (
    <div className="dash-kpis">
      {kpis.map((kpi) => (
        <div className="dash-card dash-kpi" key={kpi.key}>
          <div className="top">
            <span className="lab">{kpi.label}</span>
            <span className="ic" style={{ background: kpi.tone, color: kpi.accent }}>
              {kpi.icon}
            </span>
          </div>
          <div className="big">{kpi.value}</div>
          <div className="meta">{kpi.meta}</div>
        </div>
      ))}
    </div>
  )
}
