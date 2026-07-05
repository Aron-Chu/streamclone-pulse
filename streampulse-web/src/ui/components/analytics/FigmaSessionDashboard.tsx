import { useMemo, useState } from 'react'
import {
  isValidPeakOffsetSeconds,
  nearestMomentForOffset,
  type FigmaEmoteBurst,
  type FigmaSessionViewModel,
} from '../../../lib/figmaSessionAnalytics'
import { CoverageTruthPanel } from './CoverageTruthPanel'
import { FigmaLiveSessionsTable } from './FigmaLiveSessionsTable'
import { FigmaMomentInspector } from './FigmaMomentInspector'
import { FigmaSignalChart, type PlottedEmote } from './FigmaSignalChart'
import { MostReactedMinutesTable } from './MostReactedMinutesTable'
import { TopEmoteBurstsPanel } from './TopEmoteBurstsPanel'
import type { HubLiveChannel } from '../../../lib/publicHub'

export interface FigmaSessionDashboardProps {
  model: FigmaSessionViewModel
  compactTable?: boolean
  liveChannels?: HubLiveChannel[]
}

const FEATURED_EMPTY_MESSAGES: Record<string, string> = {
  no_qualifying_session:
    'No live channel currently qualifies. StreamPulse picks the busiest room with at least 1 chat/min, a stored stream ID, and minute rollups with detected peaks.',
  store_unavailable: 'Analytics store is unavailable on this backend — featured session needs Postgres rollups.',
  stream_unavailable: 'The picked live stream could not be loaded from the database.',
  rollup_unavailable: 'Minute rollups are missing for the picked channel — IRC collector may still be warming up.',
  insufficient_peaks: 'Rollups exist but no peaks were detected yet. Give the stream a few minutes of chat activity.',
  insufficient_data: 'Not enough chart or peak data to render a preview.',
  waiting: 'Waiting for hub data…',
}

function featuredEmptyMessage(reason?: string): string {
  const key = reason?.trim() || 'no_qualifying_session'
  return FEATURED_EMPTY_MESSAGES[key] ?? FEATURED_EMPTY_MESSAGES.no_qualifying_session
}

export function FigmaSessionDashboard({ model, compactTable, liveChannels = [] }: FigmaSessionDashboardProps) {
  const [selectedOffset, setSelectedOffset] = useState<number | undefined>(
    model.moments[0]?.offsetSeconds,
  )
  const [plottedEmote, setPlottedEmote] = useState<PlottedEmote | undefined>(undefined)

  const selectedMoment = useMemo(
    () => model.moments.find((m) => m.offsetSeconds === selectedOffset) ?? model.moments[0] ?? null,
    [model.moments, selectedOffset],
  )

  const handleChartSelectOffset = (offsetSeconds: number) => {
    const nearest = nearestMomentForOffset(model.moments, offsetSeconds)
    if (nearest) setSelectedOffset(nearest.offsetSeconds)
  }

  const handleSelectBurst = (burst: FigmaEmoteBurst) => {
    if (!isValidPeakOffsetSeconds(burst.peakOffsetSeconds)) return
    if (plottedEmote?.code === burst.code) {
      setPlottedEmote(undefined)
      return
    }
    setPlottedEmote({
      code: burst.code,
      label: `${burst.code} @ ${burst.peakOffset ?? 'peak'}`,
      peakOffsetSeconds: burst.peakOffsetSeconds,
    })
    const nearest = nearestMomentForOffset(model.moments, burst.peakOffsetSeconds)
    setSelectedOffset(nearest?.offsetSeconds ?? burst.peakOffsetSeconds)
  }

  if (model.state === 'loading') {
    return <div className="figma-session figma-session--loading" aria-busy="true" />
  }

  if (model.state === 'empty') {
    return (
      <section className="figma-session figma-session--empty" aria-label="Featured session">
        <div className="figma-panel" style={{ margin: '1rem 1.25rem' }}>
          <div className="figma-panel__body">
            <h2 style={{ margin: '0 0 0.35rem', fontSize: '0.94rem' }}>Featured session</h2>
            <p className="muted" style={{ margin: '0 0 0.5rem' }}>
              {featuredEmptyMessage(model.reason)}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
              Search a channel above to open full analytics, or wait for a live room with IRC rollups and chat spikes.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const title = model.displayName?.trim() || model.login || 'Featured session'

  return (
    <section className="figma-session" aria-label="Featured session analytics">
      <FigmaSignalChart
        points={model.chartPoints}
        selectedOffset={selectedOffset}
        onSelectOffset={handleChartSelectOffset}
        title={model.category ? `${title} / ${model.category}` : title}
        plottedEmote={plottedEmote}
        onClearPlottedEmote={() => setPlottedEmote(undefined)}
      />

      <div className={`figma-session__grid${compactTable ? ' figma-session__grid--compact' : ''}`}>
        <div className="figma-session__grid-col">
          <FigmaLiveSessionsTable channels={liveChannels} compact={compactTable} />
          <CoverageTruthPanel rows={model.coverageTruth} />
        </div>
        <MostReactedMinutesTable
          moments={model.moments}
          selectedOffset={selectedOffset}
          onSelect={(moment) => setSelectedOffset(moment.offsetSeconds)}
          vodId={model.vodId}
          plottedEmoteCode={plottedEmote?.code}
        />
        <div className="figma-session__grid-col">
          <FigmaMomentInspector
            moment={selectedMoment}
            vodId={model.vodId}
            sessionHref={model.demo ? undefined : model.sessionHref}
            liveChannels={liveChannels}
          />
          <TopEmoteBurstsPanel
            bursts={model.bursts}
            selectedCode={plottedEmote?.code}
            onSelectBurst={handleSelectBurst}
          />
        </div>
      </div>
    </section>
  )
}
