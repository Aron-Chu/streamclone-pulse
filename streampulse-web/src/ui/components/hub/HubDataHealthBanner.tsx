import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Info, RefreshCw } from 'lucide-react'
import type { HubCorpusPipeline } from '../../../lib/publicHub'
import type { PublicHubLoadSource } from '../../../lib/publicHub'
import { backendSourceCaption, resolveBackendSource } from '../../../lib/backendSource'
import type { ActivitySummary } from '../../../lib/hubActivitySummary'
import './hub-public-audit.css'

export interface HubDataHealthBannerProps {
  loadSource?: PublicHubLoadSource | null
  hubEndpointOk: boolean
  activitySummary: ActivitySummary
  pipeline?: HubCorpusPipeline
  /** Coverage from the displayed hub copy; omitted when no hub data is available. */
  coverageState?: string
  /** Database check from the same displayed copy, not a current health probe. */
  coverageDatabaseOk?: boolean
  liveRosterCount: number
  error?: string | null
  backendUrl?: string
  /** When true, suppress coverage/gap noise until the first hub payload settles. */
  loading?: boolean
  /** Re-requests the hub now instead of waiting for the next poll. */
  onRetry?: () => void
  /** A hub request is already in flight; Try again stays in place but cannot restart it. */
  retryDisabled?: boolean
  /** The hub read still runs with no answer on screen. */
  pending?: boolean
  /** The read has missed its deadline. */
  late?: boolean
}

type HealthMessage = { tone: 'warn' | 'info'; text: string; detail?: string }

export function formatCoveragePercent(pointCount: number, expectedBuckets: number): string {
  const expected = Math.max(0, Math.floor(expectedBuckets))
  const measured = Math.max(0, Math.floor(pointCount))
  if (expected === 0) return '0%'
  if (measured >= expected) return '100%'
  return `${(Math.floor((measured / expected) * 1_000) / 10).toFixed(1)}%`
}

/** From this share of the window's buckets on, a few missing ones are a grey note, not an amber warning. */
export const QUIET_COVERAGE_RATIO = 0.95

/** The one grey line that replaces the amber buckets line at or above QUIET_COVERAGE_RATIO. */
export const MINUTES_MISSING_NOTE = 'A few minutes are missing from this chart.'

export function isQuietCoverage(pointCount: number, expectedBuckets: number): boolean {
  const expected = Math.floor(expectedBuckets)
  if (!(expected > 0)) return false
  return Math.max(0, Math.floor(pointCount)) >= expected * QUIET_COVERAGE_RATIO
}

export function HubDataHealthBanner({
  loadSource,
  hubEndpointOk,
  activitySummary,
  pipeline,
  coverageState,
  coverageDatabaseOk,
  liveRosterCount: _liveRosterCount,
  error,
  backendUrl,
  loading = false,
  onRetry,
  retryDisabled = false,
  pending = false,
  late = false,
}: HubDataHealthBannerProps) {
  const [expanded, setExpanded] = useState(false)
  // Preserve the slow-read behavior when no snapshot is available. A known
  // snapshot must still expose its coverage while its refresh is pending.
  if (coverageState == null && pending && !error && loadSource !== 'stats-fallback') return null
  if (coverageState == null && pending && late) {
    return (
      <div className="hx-health-banner" role="status" aria-live="polite">
        <div className="hx-health-banner__row hx-health-banner__row--info">
          <Info aria-hidden="true" size={16} />
          <div className="hx-health-banner__body"><span>Live data is slow — still loading…</span></div>
        </div>
      </div>
    )
  }
  const messages: HealthMessage[] = []
  const slowPending = pending && late
  if (coverageState != null && slowPending) messages.push({ tone: 'info', text: 'Live data is slow — still loading…' })

  // Batch 3 suppresses an earlier error while the current slow read is still
  // in flight. Keep that read-status behavior alongside snapshot warnings.
  if (error && !slowPending) {
    messages.push({
      tone: 'warn',
      text: loadSource == null
        ? 'Live data is unavailable right now.'
        : 'Could not refresh hub data. Showing the last loaded snapshot if available.',
      detail: error,
    })
  }

  if (!slowPending && loadSource === 'stats-fallback') {
    messages.push({
      tone: 'warn',
      text: 'Hub temporarily unavailable — showing aggregate stats only.',
    })
  } else if (!slowPending && !loading && hubEndpointOk && activitySummary.pointCount < 2) {
    messages.push({
      tone: 'info',
      text: 'Hub connected but no activity yet — the chart fills as tracked channels send chat and emotes.',
    })
  }

  // Coverage / IRC details — only after load settles (avoid false 0/240 on first paint).
  let minutesMissingNote = false
  if (!loading && !slowPending) {
    if (activitySummary.gapCount > 0) {
      messages.push({
        tone: 'info',
        text: `${activitySummary.gapCount} gap${activitySummary.gapCount === 1 ? '' : 's'} in this window (minutes with no stored activity).`,
        detail:
          'Gaps usually mean collector downtime or a sparse tracking pool — not that Twitch itself was quiet.',
      })
    }

    if (activitySummary.expectedBuckets > 0 && activitySummary.missingBuckets > 0) {
      if (isQuietCoverage(activitySummary.pointCount, activitySummary.expectedBuckets)) {
        // 95% or more of the window is there: one grey line below the rest, and none
        // when the gap row above already says minutes are missing.
        minutesMissingNote = activitySummary.gapCount <= 0
      } else {
        const pct = formatCoveragePercent(activitySummary.pointCount, activitySummary.expectedBuckets)
        messages.push({
          tone: 'warn',
          text: `Activity coverage ${pct} for this window (${activitySummary.pointCount}/${activitySummary.expectedBuckets} buckets).`,
          detail: `${activitySummary.missingBuckets} bucket${activitySummary.missingBuckets === 1 ? '' : 's'} missing from stored rollups.`,
        })
      }
    }

    // The normalizer uses a zero-filled defensive shape when the pipeline is
    // absent; that is not evidence that live tracking is limited.
    const knownPipeline = pipeline && pipeline.available !== false &&
      ['healthy', 'operational', 'degraded', 'critical'].includes(pipeline.state)
    const pipelineCritical = Boolean(knownPipeline &&
      (pipeline.state === 'critical' || (pipeline.roster?.collectorTracking != null && pipeline.roster.collectorTracking <= 0)))
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

  // Keep coverage visible even when another warning occupies the primary row.
  // The normalized state combines coverage with pipeline health and belongs to the
  // displayed copy, not necessarily the current origin.
  const pipelineUnknown = !loading && coverageState != null &&
    (pipeline?.available === false || !['healthy', 'operational', 'degraded', 'critical'].includes(pipeline?.state ?? ''))

  const coverageText = !loading && coverageState != null
    ? coverageState === 'critical'
      ? 'Tracking or coverage is critical in this snapshot — analytics may be incomplete.'
      : coverageState === 'degraded'
        ? 'Tracking or coverage is degraded in this snapshot — analytics may be incomplete.'
        : coverageState === 'operational' && coverageDatabaseOk !== false && !pipelineUnknown
          ? 'Coverage was operational in this snapshot; current status may have changed.'
          : coverageState === 'operational'
            ? null
          : 'Coverage status is unknown in this snapshot — analytics may be incomplete.'
    : null

  const databaseWarning = !loading && coverageState != null && coverageDatabaseOk === false

  if (messages.length === 0 && !coverageText && !pipelineUnknown && !databaseWarning && !minutesMissingNote) return null

  const showBackendCaption = backendUrl && resolveBackendSource(backendUrl) !== 'hosted'
  const caption = showBackendCaption ? backendSourceCaption(backendUrl) : null
  const primary = messages[0]!
  const extras = messages.slice(1)
  const PrimaryIcon = primary?.tone === 'warn' ? AlertTriangle : Info
  const canRetry = Boolean(onRetry && !slowPending && (error || loadSource === 'stats-fallback'))

  return (
    <div className="hx-health-banner" role="status" aria-live="polite">
      {databaseWarning ? (
        <div className="hx-health-banner__row hx-health-banner__row--warn">
          <AlertTriangle aria-hidden="true" size={16} />
          <div className="hx-health-banner__body"><span>Database check failed in this snapshot — analytics may be incomplete.</span></div>
        </div>
      ) : null}
      {coverageText ? (
        <div className={`hx-health-banner__row hx-health-banner__row--${coverageState === 'operational' ? 'info' : 'warn'}`}>
          {coverageState === 'operational' ? <Info aria-hidden="true" size={16} /> : <AlertTriangle aria-hidden="true" size={16} />}
          <div className="hx-health-banner__body"><span>{coverageText}</span></div>
        </div>
      ) : null}
      {pipelineUnknown ? (
        <div className="hx-health-banner__row hx-health-banner__row--warn">
          <AlertTriangle aria-hidden="true" size={16} />
          <div className="hx-health-banner__body"><span>Tracking status is unknown in this snapshot — analytics may be incomplete.</span></div>
        </div>
      ) : null}
      {primary ? <div className={`hx-health-banner__row hx-health-banner__row--${primary.tone}`}>
        <PrimaryIcon aria-hidden="true" size={16} />
        <div className="hx-health-banner__body">
          <span>{primary.text}</span>
          {primary.detail ? (
            <span className="hx-health-banner__detail">{primary.detail}</span>
          ) : null}
        </div>
        {canRetry ? (
          <button type="button" className="hx-health-banner__toggle" onClick={onRetry} disabled={loading || retryDisabled}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>Try again</span>
          </button>
        ) : null}
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
      </div> : null}
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
      {minutesMissingNote ? (
        <div className="hx-health-banner__row hx-health-banner__row--info" data-testid="hub-minutes-missing-note">
          <Info aria-hidden="true" size={16} />
          <div className="hx-health-banner__body"><span>{MINUTES_MISSING_NOTE}</span></div>
        </div>
      ) : null}
      {caption ? <div className="hx-health-banner__caption muted">{caption}</div> : null}
    </div>
  )
}
