import { useState } from 'react'
import type { HubCorpusPipeline } from '../../../lib/publicHub'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { compact } from './hubFormat'

export interface HubCoverageTrustStripProps {
  pipeline: HubCorpusPipeline
  loading?: boolean
  updatedAgo?: string
}

function coverageStateLabel(state: string): string {
  if (state === 'healthy') return 'healthy'
  if (state === 'degraded') return 'partial coverage'
  if (state === 'critical') return 'critical'
  return state
}

function coverageStateSentence(pipeline: HubCorpusPipeline): string {
  if (pipeline.state === 'healthy') return 'Live chat tracking is active across the top live streams by viewer rank.'
  if (pipeline.state === 'degraded') return 'Live tracking is running with reduced coverage; some channels are not being followed right now.'
  if (pipeline.state === 'critical' && pipeline.roster.warming > 0) {
    return 'IRC collectors are active on some channels, but metadata freshness or coverage checks are failing.'
  }
  if (pipeline.state === 'critical') return 'Live tracking is currently offline — historical corpus data is still available.'
  return 'Live tracking coverage is updating.'
}

function formatMetadataSampledAgo(seconds: number | undefined): string | null {
  if (seconds == null || seconds <= 0) return null
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

export function HubCoverageTrustStrip({
  pipeline,
  loading,
  updatedAgo,
}: HubCoverageTrustStripProps) {
  const labels = useCommandCenterLabels()
  const [expanded, setExpanded] = useState(false)
  const collectorPct =
    pipeline.collectorMax > 0
      ? Math.min(100, Math.round((pipeline.collectorActive / pipeline.collectorMax) * 100))
      : 0
  const tone =
    pipeline.state === 'critical'
      ? 'critical'
      : pipeline.state === 'degraded'
        ? 'partial'
        : 'healthy'

  return (
    <section
      id="section-coverage"
      className="hub-coverage-trust"
      aria-label={labels.coverage}
    >
      <div className="hub-coverage-trust__strip">
        <div className="hub-coverage-trust__summary">
          <span className={`hub-coverage-trust__pill hub-coverage-trust__pill--${tone}`}>
            {coverageStateLabel(pipeline.state)}
          </span>
          <span>
            <strong>{labels.coverage}:</strong>{' '}
            {loading ? '…' : `${compact(pipeline.collectorActive)} / ${compact(pipeline.collectorMax)} collector cells active`}
          </span>
          <span>
            <strong>State:</strong> {coverageStateSentence(pipeline)}
          </span>
          {formatMetadataSampledAgo(pipeline.metadataSampledAgoSeconds) ? (
            <span>
              <strong>Metadata sampled:</strong> {formatMetadataSampledAgo(pipeline.metadataSampledAgoSeconds)}
            </span>
          ) : null}
          <span>
            <strong>Configured roster:</strong>{' '}
            {loading ? '…' : `${compact(pipeline.roster.live)} live · ${compact(pipeline.topN)} roster slots`}
          </span>
          {updatedAgo ? (
            <span>
              <strong>Updated:</strong> {updatedAgo}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="hub-coverage-trust__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide coverage detail' : 'View data coverage'}
        </button>
      </div>
      {expanded ? (
        <div className="hub-coverage-trust__detail">
          <div className="hub-coverage-trust__bar" aria-hidden="true">
            <span style={{ width: `${collectorPct}%` }} />
          </div>
          <dl className="hub-coverage-trust__grid">
            <div>
              <dt>Collecting chat</dt>
              <dd>{compact(pipeline.roster.collecting)}</dd>
            </div>
            <div>
              <dt>Warming (IRC connected)</dt>
              <dd>{compact(pipeline.roster.warming)}</dd>
            </div>
            <div>
              <dt>Metadata only</dt>
              <dd>{compact(pipeline.roster.metadataOnly)}</dd>
            </div>
            <div>
              <dt>Stale metadata</dt>
              <dd>{compact(pipeline.roster.metadataStale)}</dd>
            </div>
            <div>
              <dt>Viewer-only</dt>
              <dd>{compact(pipeline.roster.viewerOnly)}</dd>
            </div>
            <div>
              <dt>Admission disabled</dt>
              <dd>{compact(pipeline.roster.admissionDisabled)}</dd>
            </div>
            <div>
              <dt>Uncovered live</dt>
              <dd>{compact(pipeline.roster.liveCollectorDeficitRows)}</dd>
            </div>
          </dl>
          <p className="hub-coverage-trust__note muted">
            Only channels with an active IRC collector contribute chat and emote lines. Warming means a collector lease
            is active but chat rollups are not shown on this summary yet. Viewer-only channels still appear in live lists
            but may lack minute rollups.
          </p>
        </div>
      ) : null}
    </section>
  )
}
