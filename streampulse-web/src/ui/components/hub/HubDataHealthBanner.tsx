import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { HubActivity, HubCorpusPipeline } from '../../../lib/publicHub'
import type { PublicHubLoadSource } from '../../../lib/publicHub'
import { backendSourceCaption, resolveBackendSource } from '../../../lib/backendSource'
import type { ActivitySummary } from '../../../lib/hubActivitySummary'

export interface HubDataHealthBannerProps {
  loadSource?: PublicHubLoadSource | null
  hubEndpointOk: boolean
  activitySummary: ActivitySummary
  pipeline?: HubCorpusPipeline
  activity?: HubActivity
  liveRosterCount: number
  error?: string | null
  backendUrl?: string
  /** When true, suppress coverage/gap noise until the first hub payload settles. */
  loading?: boolean
}

type HealthMessage = { tone: 'warn' | 'info'; text: string; detail?: string }

export function HubDataHealthBanner({
  loadSource,
  hubEndpointOk,
  activitySummary,
  pipeline,
  activity,
  liveRosterCount: _liveRosterCount,
  error,
  backendUrl,
  loading = false,
}: HubDataHealthBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const messages: HealthMessage[] = []

  if (error) {
    messages.push({
      tone: 'warn',
      text: 'Could not refresh hub data. Showing the last loaded snapshot if available.',
      detail: error,
    })
  }

  if (loadSource === 'stats-fallback') {
    messages.push({
      tone: 'warn',
      text: 'Hub temporarily unavailable — showing aggregate stats only.',
    })
  } else if (!loading && hubEndpointOk && activitySummary.pointCount < 2) {
    messages.push({
      tone: 'info',
      text: 'Hub connected but no activity yet — the chart fills as tracked channels send chat and emotes.',
    })
  }

  // Coverage / IRC details — only after load settles (avoid false 0/240 on first paint).
  if (!loading) {
    if (
      activity?.state === 'degraded' &&
      activity.source === 'live_pool_fallback' &&
      activity.reason === 'historical_projection_unavailable'
    ) {
      const available = activity.availableWindowMinutes ?? 0
      messages.unshift({
        tone: 'warn',
        text: `Historical activity is unavailable — showing about ${available || 30} minutes of live pool data inside the ${activitySummary.windowLabel} frame.`,
        detail: 'The empty stretches are missing history, not measured zero activity. Use a shorter supported window for a trustworthy trend.',
      })
    } else if (activity?.state === 'degraded' && activity.reason) {
      messages.unshift({
        tone: 'warn',
        text: `Activity data is degraded for this ${activitySummary.windowLabel} window.`,
        detail: activity.reason,
      })
    }

    if (activitySummary.gapCount > 0) {
      messages.push({
        tone: 'info',
        text: `${activitySummary.gapCount} gap${activitySummary.gapCount === 1 ? '' : 's'} in this window (minutes with no stored activity).`,
        detail:
          'Gaps usually mean collector downtime or a sparse tracking pool — not that Twitch itself was quiet.',
      })
    }

    if (activitySummary.expectedBuckets > 0 && activitySummary.missingBuckets > 0) {
      const pct = Math.round(activitySummary.coveragePct)
      messages.push({
        tone: 'warn',
        text: `Activity coverage ${pct}% for this window (${activitySummary.pointCount}/${activitySummary.expectedBuckets} buckets).`,
        detail: `${activitySummary.missingBuckets} bucket${activitySummary.missingBuckets === 1 ? '' : 's'} missing from stored rollups.`,
      })
    }

    const pipelineCritical =
      pipeline?.state === 'critical' || (pipeline?.roster.collectorTracking ?? 0) <= 0
    if (pipelineCritical) {
      const tracking = pipeline?.roster.collectorTracking ?? 0
      const expected = Math.max(
        pipeline?.roster.expectedCollectorRows ?? 0,
        pipeline?.collectorMax ?? 0,
      )
      messages.push({
        tone: 'warn',
        text:
          tracking <= 0
            ? 'Live tracking is limited — charts and moments reflect the tracked pool only.'
            : `Live tracking covers ${tracking}${expected > 0 ? ` of ${expected}` : ''} channels in the pool.`,
        detail: 'Not all of Twitch is monitored; historical backfill may still fill gaps.',
      })
    }
  }

  if (messages.length === 0) return null

  const showBackendCaption = backendUrl && resolveBackendSource(backendUrl) !== 'hosted'
  const caption = showBackendCaption ? backendSourceCaption(backendUrl) : null
  const primary = messages[0]!
  const extras = messages.slice(1)
  const PrimaryIcon = primary.tone === 'warn' ? AlertTriangle : Info

  return (
    <div className="hx-health-banner" role="status" aria-live="polite">
      <div className={`hx-health-banner__row hx-health-banner__row--${primary.tone}`}>
        <PrimaryIcon aria-hidden="true" size={16} />
        <div className="hx-health-banner__body">
          <span>{primary.text}</span>
          {primary.detail ? (
            <span className="hx-health-banner__detail">{primary.detail}</span>
          ) : null}
        </div>
        {extras.length > 0 ? (
          <button
            type="button"
            className="hx-health-banner__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            <span>{expanded ? 'Less' : `${extras.length} more`}</span>
          </button>
        ) : null}
      </div>
      {expanded
        ? extras.map((message, index) => {
            const Icon = message.tone === 'warn' ? AlertTriangle : Info
            return (
              <div
                key={index}
                className={`hx-health-banner__row hx-health-banner__row--${message.tone}`}
              >
                <Icon aria-hidden="true" size={16} />
                <div className="hx-health-banner__body">
                  <span>{message.text}</span>
                  {message.detail ? (
                    <span className="hx-health-banner__detail">{message.detail}</span>
                  ) : null}
                </div>
              </div>
            )
          })
        : null}
      {caption ? <div className="hx-health-banner__caption muted">{caption}</div> : null}
    </div>
  )
}
