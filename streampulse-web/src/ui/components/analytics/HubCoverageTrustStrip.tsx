import { useState } from 'react'
import type { HubCorpusPipeline } from '../../../lib/publicHub'
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

function coverageStateSentence(state: string): string {
  if (state === 'healthy') return 'Live chat tracking is active across the top-N roster.'
  if (state === 'degraded') return 'Live tracking is running with reduced coverage; some channels are not being followed right now.'
  if (state === 'critical') return 'Live tracking is currently offline — historical corpus data is still available.'
  return 'Live tracking coverage is updating.'
}

export function HubCoverageTrustStrip({
  pipeline,
  loading,
  updatedAgo,
}: HubCoverageTrustStripProps) {
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
      aria-label="Data coverage and trust"
    >
      <div className="hub-coverage-trust__strip">
        <div className="hub-coverage-trust__summary">
          <span className={`hub-coverage-trust__pill hub-coverage-trust__pill--${tone}`}>
            {coverageStateLabel(pipeline.state)}
          </span>
          <span>
            <strong>Coverage:</strong>{' '}
            {loading ? '…' : `${compact(pipeline.collectorActive)} / ${compact(pipeline.collectorMax)} collector cells active`}
          </span>
          <span>
            <strong>State:</strong> {coverageStateSentence(pipeline.state)}
          </span>
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
            Only channels with an active IRC collector contribute chat and emote lines. Viewer-only channels still
            appear in live lists but may lack minute rollups.
          </p>
        </div>
      ) : null}
    </section>
  )
}
