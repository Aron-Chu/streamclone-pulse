import type { HubCorpusPipeline, HubCoverage } from './publicHub'
import { compact } from '../ui/components/analytics/hubFormat'

export interface IrcSlotMetrics {
  label: string
  meta: string
  pct: number
  color: string
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** IRC collector slot utilization for Coverage health row 1. */
export function ircSlotMetrics(coverage: HubCoverage, pipeline?: HubCorpusPipeline): IrcSlotMetrics {
  const label = 'IRC collector slots'

  if (pipeline && pipeline.collectorMax > 0) {
    const active = Math.max(0, pipeline.collectorActive)
    const max = pipeline.collectorMax
    const tracking = Math.max(0, pipeline.roster.collectorTracking)
    const rosterLive = Math.max(0, pipeline.roster.live)
    const pct = clampPct((active / max) * 100)
    const deficit = pipeline.roster.liveCollectorDeficitRows > 0
    const atCapacity = active >= max && deficit
    const color = deficit || atCapacity
      ? 'hsl(var(--chart-4))'
      : 'hsl(var(--chart-3))'
    const meta = `${compact(active)}/${compact(max)} slots · ${compact(tracking)} with chat · ${compact(rosterLive)} live on roster`
    return { label, meta, pct, color }
  }

  const max = coverage.trackingMax
  if (max > 0) {
    const active = Math.min(Math.max(0, coverage.syncActive), max)
    const pct = clampPct((active / max) * 100)
    const meta =
      coverage.liveChannels > 0
        ? `${compact(active)}/${compact(max)} slots · ${compact(coverage.liveChannels)} live on roster`
        : `${compact(active)}/${compact(max)} slots`
    return {
      label,
      meta,
      pct,
      color: coverage.liveChannels > max ? 'hsl(var(--chart-4))' : 'hsl(var(--chart-3))',
    }
  }

  return {
    label,
    meta: coverage.liveChannels > 0 ? `${compact(coverage.liveChannels)} live on roster` : 'No collector capacity reported',
    pct: coverage.liveChannels > 0 ? 100 : 0,
    color: 'hsl(var(--chart-3))',
  }
}
