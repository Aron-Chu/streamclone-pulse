import type { ReactNode } from 'react'
import { Zap, PieChart, Smile, TrendingUp } from 'lucide-react'
import type { HubEmoteIntel } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact, deltaLabel } from './hubFormat'

interface EmoteIntelKpisProps {
  intel: HubEmoteIntel
  topEmoteName?: string
  peakLogin?: string
  loading?: boolean
}

/** Deterministic, decorative sparkline path (aria-hidden). */
function sparkPoints(seed: number, rising: boolean): string {
  const n = 8
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 100
    const base = rising ? 26 - (i / (n - 1)) * 20 : 14 + Math.sin(seed + i) * 3
    const jitter = Math.abs(Math.sin(seed * 1.7 + i * 0.8)) * 4
    const y = Math.max(2, Math.min(28, base - jitter))
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

interface Kpi {
  key: string
  label: string
  value: string
  accent: string
  tone: string
  icon: ReactNode
  meta: ReactNode
  rising: boolean
  seed: number
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

  const shareDelta = deltaLabel(intel.topEmoteSharePct > 0 ? intel.topEmoteSharePct : null)

  const kpis: Kpi[] = [
    {
      key: 'epm',
      label: 'Emotes / min (global)',
      value: compact(intel.emotesPerMin),
      accent: 'hsl(var(--sc-chart-2))',
      tone: 'hsl(var(--sc-chart-2) / 0.15)',
      icon: <Zap aria-hidden="true" />,
      meta: <span className="muted">across live rooms</span>,
      rising: true,
      seed: 1.2,
    },
    {
      key: 'share',
      label: 'Top emote share',
      value: `${intel.topEmoteSharePct.toFixed(1)}%`,
      accent: 'hsl(var(--sc-chart-1))',
      tone: 'hsl(var(--sc-chart-1) / 0.15)',
      icon: <PieChart aria-hidden="true" />,
      meta: <span className="muted">{topEmoteName ? `${topEmoteName} leads` : 'of all emotes sent'}</span>,
      rising: shareDelta.tone !== 'down',
      seed: 3.4,
    },
    {
      key: 'unique',
      label: 'Unique emotes used',
      value: compact(intel.uniqueEmotes),
      accent: 'hsl(var(--sc-chart-3))',
      tone: 'hsl(var(--sc-chart-3) / 0.15)',
      icon: <Smile aria-hidden="true" />,
      meta: <span className="muted">distinct codes seen</span>,
      rising: true,
      seed: 5.1,
    },
    {
      key: 'peak',
      label: 'Biggest peak today',
      value: compact(intel.biggestPeakPerMin),
      accent: 'hsl(var(--sc-chart-5))',
      tone: 'hsl(var(--sc-chart-5) / 0.15)',
      icon: <TrendingUp aria-hidden="true" />,
      meta: <span className="muted">{peakLogin ? `${peakLogin} · chat/min` : 'chat/min'}</span>,
      rising: true,
      seed: 7.7,
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
          <span className="spark" aria-hidden="true">
            <svg viewBox="0 0 100 30" preserveAspectRatio="none">
              <polyline points={sparkPoints(kpi.seed, kpi.rising)} fill="none" stroke={kpi.accent} strokeWidth={2} />
            </svg>
          </span>
        </div>
      ))}
    </div>
  )
}
