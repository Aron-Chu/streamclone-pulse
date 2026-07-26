import { useState } from 'react'
import {
  resolveConfiguredRosterDisplay,
  type HubCorpusPipeline,
  type HubIngest,
} from '../../../lib/publicHub'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { compact } from './hubFormat'

export interface HubCoverageTrustStripProps {
  pipeline: HubCorpusPipeline
  ingest?: HubIngest
  loading?: boolean
  updatedAgo?: string
}

function coverageStateLabel(state: string): string {
  if (state === 'healthy') return 'healthy'
  if (state === 'degraded') return 'partial coverage'
  if (state === 'critical') return 'critical'
  return state
}

function coverageStateSentence(pipeline: HubCorpusPipeline, ingest?: HubIngest): string {
  const chat5m = ingest?.chatActive5m
  if (pipeline.state === 'healthy') {
    if (chat5m != null && ingest?.activeCollectors) {
      return `Live IRC tracking is active; ${compact(chat5m)} of ${compact(ingest.activeCollectors)} collectors saw chat in the last 5 minutes.`
    }
    return 'Live chat tracking is active across the top live streams by viewer rank.'
  }
  if (pipeline.state === 'degraded') {
    return 'Live tracking is running with reduced coverage; some channels are not being followed right now.'
  }
  if (pipeline.state === 'critical' && (pipeline.roster.warming > 0 || (pipeline.roster.connectedQuiet ?? 0) > 0)) {
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
  ingest,
  loading,
  updatedAgo,
}: HubCoverageTrustStripProps) {
  const labels = useCommandCenterLabels()
  const [expanded, setExpanded] = useState(false)
  const ircActive = ingest?.activeCollectors ?? pipeline.collectorActive
  const ircMax = ingest?.desiredCollectors
    ? Math.max(ingest.desiredCollectors, pipeline.collectorMax)
    : pipeline.collectorMax
  const bound = ingest?.boundCollectors ?? ircActive
  const chat5m = ingest?.chatActive5m
  const quiet5m =
    ingest?.connectedQuiet ??
    (chat5m != null ? Math.max(0, ircActive - chat5m) : undefined)
  const rosterDisplay = resolveConfiguredRosterDisplay(pipeline.roster)
  const { confirmed, unresolved, warming, connectedQuiet, consistent } = rosterDisplay
  const collectorPct =
    ircMax > 0 ? Math.min(100, Math.round((ircActive / ircMax) * 100)) : 0
  const tone =
    !consistent
      ? 'critical'
      : pipeline.state === 'critical'
        ? 'critical'
        : pipeline.state === 'degraded'
          ? 'partial'
          : 'healthy'

  return (
    <section
      id="section-coverage"
      className="hub-coverage-trust"
      aria-label={labels.coverage}
      data-roster-consistent={consistent ? 'true' : 'false'}
    >
      <div className="hub-coverage-trust__strip">
        <div className="hub-coverage-trust__summary">
          <span className={`hub-coverage-trust__pill hub-coverage-trust__pill--${tone}`}>
            {consistent ? coverageStateLabel(pipeline.state) : 'coverage data inconsistent'}
          </span>
          <span>
            <strong>IRC collectors:</strong>{' '}
            {loading ? '…' : `${compact(ircActive)} / ${compact(ircMax)}`}
          </span>
          <span>
            <strong>Bound to streams:</strong> {loading ? '…' : compact(bound)}
          </span>
          {chat5m != null ? (
            <span>
              <strong>Chat seen last 5m:</strong> {loading ? '…' : compact(chat5m)}
              {quiet5m != null ? ` · Quiet ${compact(quiet5m)}` : null}
            </span>
          ) : null}
          <span>
            <strong>Configured roster:</strong>{' '}
            {loading
              ? '…'
              : `${compact(confirmed)} confirmed · ${compact(unresolved)} unresolved`}
          </span>
          {!consistent && rosterDisplay.inconsistencyReason ? (
            <span className="hub-coverage-trust__inconsistent" role="status">
              <strong>Roster check:</strong> {rosterDisplay.inconsistencyReason}
            </span>
          ) : null}
          <span>
            <strong>State:</strong> {coverageStateSentence(pipeline, ingest)}
          </span>
          {formatMetadataSampledAgo(pipeline.metadataSampledAgoSeconds) ? (
            <span>
              <strong>Metadata sampled:</strong> {formatMetadataSampledAgo(pipeline.metadataSampledAgoSeconds)}
            </span>
          ) : null}
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
              <dt>IRC collectors</dt>
              <dd aria-label={`${ircActive} of ${ircMax} IRC collectors`}>
                {compact(ircActive)} / {compact(ircMax)}
              </dd>
            </div>
            <div>
              <dt>Bound to streams</dt>
              <dd>{compact(bound)}</dd>
            </div>
            <div>
              <dt>Chat seen last 5m</dt>
              <dd>{chat5m != null ? compact(chat5m) : '—'}</dd>
            </div>
            <div>
              <dt>Quiet last 5m</dt>
              <dd>{quiet5m != null ? compact(quiet5m) : '—'}</dd>
            </div>
            <div>
              <dt>Configured roster confirmed</dt>
              <dd>{compact(confirmed)}</dd>
            </div>
            <div>
              <dt>Warming</dt>
              <dd>{compact(warming)}</dd>
            </div>
            <div>
              <dt>Connected quiet</dt>
              <dd>{compact(connectedQuiet)}</dd>
            </div>
            <div>
              <dt>Unresolved</dt>
              <dd>{compact(unresolved)}</dd>
            </div>
            <div>
              <dt>Metadata only — no chat coverage</dt>
              <dd>{compact(pipeline.roster.metadataOnly)}</dd>
            </div>
            <div>
              <dt>Uncovered live</dt>
              <dd>{compact(pipeline.roster.liveCollectorDeficitRows)}</dd>
            </div>
          </dl>
          <p className="hub-coverage-trust__note muted">
            IRC collectors count admitted joins. Bound means a stream ID is attached. Chat seen last 5m is
            pool-wide IRC activity; configured roster confirmed is Top-N metadata rows with chat/emote
            rollups. Warming and connected quiet are diagnostic subcategories of unresolved — they are
            never added into the unresolved total. Unresolved means IRC is active but rollups could not
            be matched to the roster stream ID. Confirmed + unresolved must equal live roster count.
          </p>
        </div>
      ) : null}
    </section>
  )
}
