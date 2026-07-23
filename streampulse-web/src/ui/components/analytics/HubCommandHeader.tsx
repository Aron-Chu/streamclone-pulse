import { useMemo } from 'react'
import { formatActivityWindowLabel } from '../../../lib/hubActivitySummary'
import {
  deriveHubChartActivityModel,
  selectHubChartActivityInputs,
} from '../../../lib/hubChartActivityModel'
import { formatHubTrustLine, resolveHubTrustFreshness } from '../../../lib/hubTrustLine'
import type { PublicHub } from '../../../lib/publicHub'
import type { PoolWireEvent } from '../../../lib/poolWireReducer'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { compact } from './hubFormat'
import { PoolWire } from './PoolWire'
import { useAnimatedNumber } from './useAnimatedNumber'

export interface HubCommandHeaderProps {
  hub: PublicHub
  loading?: boolean
  lastSuccessfulPollAt?: number | null
  hubEndpointOk?: boolean
  error?: string | null
  poolWireEvents?: PoolWireEvent[]
  poolWireInitialized?: boolean
  /** Pulse live-channels primary when a new went_live arrives. */
  pulseLiveChannels?: boolean
}

function AnimatedCompact({ value, loading }: { value: number; loading?: boolean }) {
  const animated = useAnimatedNumber(loading ? 0 : value)
  if (loading) return <>…</>
  return <>{compact(Math.round(animated))}</>
}

export function HubCommandHeader({
  hub,
  loading,
  lastSuccessfulPollAt = null,
  hubEndpointOk = true,
  error = null,
  poolWireEvents = [],
  poolWireInitialized = false,
  pulseLiveChannels = false,
}: HubCommandHeaderProps) {
  const labels = useCommandCenterLabels()
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes)
  const chartInputs = selectHubChartActivityInputs(hub)
  // Peaks stay pinned to activity inputs — trust-line / lastSuccessfulPollAt updates do not rebuild.
  const chartModel = useMemo(
    () => deriveHubChartActivityModel(chartInputs),
    [chartInputs.points, chartInputs.windowMinutes, chartInputs.livePoolViewerSum],
  )
  const peakViewers = chartModel.peakViewers
  const peakChat = chartModel.peakChatPerMin
  const peakEmotes = chartModel.peakEmotesPerMin
  const trackedPoolSize = hub.poolSize > 0 ? hub.poolSize : hub.liveChannels.length
  const liveViewersNow = chartInputs.livePoolViewerSum
  const collectorActive = hub.corpusPipeline.collectorActive
  const collectorMax = hub.corpusPipeline.collectorMax

  const freshness = resolveHubTrustFreshness({
    lastSuccessfulPollAt,
    hubEndpointOk,
    hasError: Boolean(error),
  })
  const trustLine = formatHubTrustLine({
    collectorActive,
    collectorMax,
    lastSuccessfulPollAt,
    freshness,
  })

  return (
    <header
      className="hub-command-header hub-command-header--surface"
      aria-labelledby="hub-command-title"
      data-trust={freshness}
    >
      <div className="hub-command-header__top">
        <div className="hub-command-header__copy">
          <p className="hub-command-header__eyebrow">{labels.hubEyebrow}</p>
          <h1 id="hub-command-title" className="hub-command-header__title">
            {labels.hubTitle}
          </h1>
          <p className="hub-command-header__lede">{labels.hubLede}</p>
        </div>
        <p
          className={`hub-command-header__trust hub-command-header__trust--${freshness}`}
          data-testid="hub-command-trust"
          title="IRC collector coverage and last successful hub poll"
        >
          {trustLine}
        </p>
      </div>

      <div className="hub-command-header__body">
        <div className="hub-command-header__metrics">
          <div className="hub-command-header__primary" aria-label="Tracked pool scale">
            <div
              className={`hub-command-header__primary-stat${pulseLiveChannels ? ' hub-command-header__primary-stat--pulse' : ''}`}
              title="Channels in the hosted tracking pool — not the number currently live on Twitch."
            >
              <span className="hub-command-header__primary-label">
                <span className="hub-command-header__kpi-live" aria-hidden="true" />
                Tracked channels
              </span>
              <strong
                className="hub-command-header__primary-value hub-command-header__primary-value--accent"
                data-testid="live-pool-size"
              >
                <AnimatedCompact value={trackedPoolSize} loading={loading} />
              </strong>
            </div>
            <div
              className="hub-command-header__primary-stat"
              title="Sum of viewer counts on currently live rows in the tracked pool — not all of Twitch."
            >
              <span className="hub-command-header__primary-label">Tracked live viewers</span>
              <strong className="hub-command-header__primary-value hub-command-header__primary-value--viewers">
                <AnimatedCompact value={liveViewersNow} loading={loading} />
              </strong>
            </div>
          </div>

          <section
            className="hub-command-header__peaks"
            aria-label={`Activity peaks in the last ${windowLabel}`}
          >
            <h2 className="hub-command-header__peaks-label">Last {windowLabel} peaks</h2>
            <div className="hub-command-header__peaks-row">
              <div
                className="hub-command-header__peak"
                title="Highest network viewer total in the activity window from minute rollups. Not Twitch-wide."
              >
                <span className="hub-command-header__peak-label">Viewers</span>
                <strong className="hub-command-header__peak-value hub-command-header__peak-value--viewers">
                  {loading ? '…' : peakViewers > 0 ? compact(peakViewers) : '—'}
                </strong>
              </div>
              <div
                className="hub-command-header__peak"
                title="Peak IRC chat messages per minute summed across tracked channels in this window."
              >
                <span className="hub-command-header__peak-label">Chat/min</span>
                <strong className="hub-command-header__peak-value hub-command-header__peak-value--chat">
                  {loading ? '…' : peakChat > 0 ? compact(peakChat) : '—'}
                </strong>
              </div>
              <div
                className="hub-command-header__peak"
                title="Peak emote uses per minute summed across tracked channels in this window."
              >
                <span className="hub-command-header__peak-label">Emotes/min</span>
                <strong className="hub-command-header__peak-value hub-command-header__peak-value--chat">
                  {loading ? '…' : peakEmotes > 0 ? compact(peakEmotes) : '—'}
                </strong>
              </div>
            </div>
          </section>
        </div>

        <div className="hub-command-header__wire">
          <PoolWire
            events={poolWireEvents}
            loading={loading}
            initialized={poolWireInitialized}
          />
        </div>
      </div>
    </header>
  )
}
