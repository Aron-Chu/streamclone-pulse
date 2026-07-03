import { type ReactNode } from 'react'
import type { HubEmote, HubEmoteIntel } from '../../../lib/publicHub'
import { EmoteEconomyPanel } from './HubRail'
import { Card, CardContent, CardHeader, KpiCard } from './primitives'

export interface EmoteSignalSectionProps {
  intel: HubEmoteIntel
  topEmotes: HubEmote[]
  spark: number[]
  loading?: boolean
  kpiIcons: {
    emotes: ReactNode
    unique: ReactNode
    seventv: ReactNode
    peak: ReactNode
  }
  kpiValues: {
    emotesPerMin: string
    uniqueEmotes: string
    seventvShare: string
    biggestPeak: string
  }
}

export function EmoteSignalSection({
  intel,
  topEmotes,
  spark,
  loading,
  kpiIcons,
  kpiValues,
}: EmoteSignalSectionProps) {
  return (
    <section className="hx-emote-signal" id="hx-emotes" aria-labelledby="emote-signal-title">
      <div className="hx-emote-signal__head">
        <h2 id="emote-signal-title">Emote signal</h2>
        <p>Provider mix and velocity from rollup emote counts across live tracked channels.</p>
      </div>

      <section className="hx-sec hx-kpis" aria-label="Emote intelligence KPIs" style={{ marginTop: 0 }}>
        <KpiCard
          label="Emotes / min"
          value={kpiValues.emotesPerMin}
          meta={<span className="muted">live aggregate velocity</span>}
          spark={spark}
          accent="chart-4"
          icon={kpiIcons.emotes}
          loading={loading}
        />
        <KpiCard
          label="Unique emotes"
          value={kpiValues.uniqueEmotes}
          meta={<span className="muted">current corpus view</span>}
          spark={spark}
          accent="chart-2"
          icon={kpiIcons.unique}
          loading={loading}
        />
        <KpiCard
          label="7TV share"
          value={kpiValues.seventvShare}
          meta={<span className="muted">subset of emote traffic</span>}
          spark={spark}
          accent="chart-3"
          icon={kpiIcons.seventv}
          loading={loading}
        />
        <KpiCard
          label="Biggest peak"
          value={kpiValues.biggestPeak}
          meta={<span className="muted">backend detected</span>}
          spark={spark}
          accent="chart-5"
          icon={kpiIcons.peak}
          loading={loading}
        />
      </section>

      <Card ariaLabelledby="hub-economy-title">
        <CardHeader
          title="Emote economy"
          titleId="hub-economy-title"
          desc="Provider mix and current velocity from aggregate backend counts. The live directory below lists every tracked channel."
        />
        <CardContent>
          <EmoteEconomyPanel intel={intel} topEmotes={topEmotes} loading={loading} />
        </CardContent>
      </Card>
    </section>
  )
}
