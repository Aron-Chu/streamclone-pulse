import type { AnalyticsStreamDetail, SyncStatus } from '../../apiTypes.ts'
import { formatCoveragePercent } from '@streampulse/pulse-core'
import { formatDateTime, relativeTime } from '../../utils/consoleFormat.ts'
import type { StreamSummaryMetrics } from '../../utils/streamQuality.ts'
import { DataQualityWarnIcon, deriveSessionDataQuality, SourcePills } from './ConsoleBits.tsx'

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'completed':
      return 'Collection complete'
    case 'failed':
      return 'Collection failed'
    case 'fetching_comments':
      return 'Fetching VOD chat'
    case 'writing_rollups':
      return 'Writing minute rollups'
    case 'scraping_tracker':
    case 'parsing_tracker':
      return 'Resolving viewer minutes'
    case 'resolving_vod':
      return 'Resolving VOD'
    case 'starting':
      return 'Starting'
    default:
      return phase.replace(/_/g, ' ')
  }
}

export function SyncStatusPanel({
  detail,
  syncStatus,
  summaryMetrics,
}: {
  detail?: AnalyticsStreamDetail
  syncStatus?: SyncStatus | null
  /** Stream summary metrics: coverage and viewer-sample counts for the quality facts. */
  summaryMetrics?: StreamSummaryMetrics
}) {
  const quality = deriveSessionDataQuality(detail, summaryMetrics)
  const coverage = detail?.chatCoverage
  const chatPct = quality.chatPct
  const sources = detail?.sources ?? []

  return (
    <div className="grid gap-3 p-3" data-session-status-panel>
      {syncStatus && !syncStatus.stale ? (
        <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <div className="text-xs font-black uppercase text-zinc-400">Collection status</div>
          <div
            className={`mt-1 text-sm font-black ${
              syncStatus.phase === 'failed' ? 'text-red-300' : 'text-zinc-100'
            }`}
          >
            {phaseLabel(syncStatus.phase)}
          </div>
          {syncStatus.message ? (
            <div className="mt-1 text-xs font-semibold text-zinc-400">{syncStatus.message}</div>
          ) : null}
          {syncStatus.error ? (
            <div className="mt-1 text-xs font-bold text-red-300">{syncStatus.error}</div>
          ) : null}
          {syncStatus.updatedAt ? (
            <div className="mt-1 text-xs font-semibold text-zinc-600">
              Updated {relativeTime(syncStatus.updatedAt)}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* d3-v2 session-original: the header's data-quality facts, one quiet list. */}
      <dl className="m-0 grid gap-2.5 text-xs leading-4" data-data-quality-facts>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold text-zinc-400">Data quality</dt>
          <dd className="m-0 text-right font-semibold text-zinc-100">
            <span className="inline-flex items-center gap-1.5" data-quality-label={quality.label}>
              {quality.label !== 'Good' ? <DataQualityWarnIcon className="h-3.5 w-3.5 text-zinc-300" /> : null}
              {quality.label}
            </span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold text-zinc-400">Chat coverage</dt>
          <dd className="m-0 text-right font-semibold text-zinc-100">
            {chatPct != null && Number.isFinite(chatPct) ? `${formatCoveragePercent(chatPct)} of stream minutes` : '-'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold text-zinc-400">Viewer samples</dt>
          <dd className="m-0 text-right font-semibold text-zinc-100">
            {quality.viewerSamples != null && quality.viewerSamples > 0
              ? quality.viewerSamples.toLocaleString('en-US')
              : 'unavailable'}
            {quality.viewerSourceLabel ? ` · ${quality.viewerSourceLabel}` : ''}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold text-zinc-400">VOD</dt>
          <dd className="m-0 text-right font-semibold text-zinc-100">{quality.vodState}</dd>
        </div>
      </dl>
      {coverage?.partial ? (
        <p className="m-0 text-xs font-semibold leading-4 text-amber-200/90">
          Partial coverage — chat spans {coverage.chatSpanMinutes ?? 0} of {coverage.streamSpanMinutes ?? 0} minutes.
        </p>
      ) : null}
      {detail?.stream?.lifecycleState === 'confirmed_ended' ? (
        <p className="m-0 text-xs leading-4 text-zinc-400" data-broadcast-end-window>
          Last confirmed live: {formatDateTime(detail.stream.lifecycleObservedAt)}. Offline confirmed:{' '}
          {formatDateTime(detail.stream.lifecycleDetectedAt)}. The exact end time is not measured.
        </p>
      ) : null}
      <p className="m-0 text-xs leading-4 text-zinc-400">Every figure is measured; untracked minutes aren&rsquo;t estimated.</p>

      {/* One source is always "Tracked" and tells a viewer nothing (mockup C24). */}
      {sources.length > 1 ? (
        <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <div className="mb-2 text-xs font-black uppercase text-zinc-400">Data sources</div>
          <SourcePills sources={sources} />
        </div>
      ) : null}
    </div>
  )
}
