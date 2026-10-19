import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { formatCoveragePercent } from '@streampulse/pulse-core'
import type { AnalyticsStreamDetail, SourceStatus } from '../../apiTypes.ts'
import { emoteProviderLabel, emoteProviderTone } from '../../emoteUtils.ts'
import { formatDateTime, sourceTone } from '../../utils/consoleFormat.ts'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import { mapViewerSourceBadge, viewerSourceBadgeClass } from '../../utils/sourceBadge.ts'
import { resolveAnalyticsVodId } from '../../utils/twitchVodUrl.ts'
import {
  analyticsQualityChipClass,
  deriveAnalyticsQualityLabel,
  type AnalyticsQualityLabel,
  type StreamSummaryMetrics,
} from '../../utils/streamQuality.ts'

export function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { motionEnabled } = useConsoleMotion()
  const [pulse, setPulse] = useState(false)
  const prevValue = useRef(value)

  useEffect(() => {
    if (prevValue.current === value) return
    prevValue.current = value
    if (!motionEnabled) return
    setPulse(true)
    const timer = window.setTimeout(() => setPulse(false), 220)
    return () => window.clearTimeout(timer)
  }, [value, motionEnabled])

  return (
    <div className="sc-stat-card flex flex-col rounded border border-white/10 bg-white/[0.035] p-3" data-value-changed={pulse ? 'true' : undefined}>
      {/* d3-v2 session-original: plain-case labels (12px, 600). */}
      <div className="sc-stat-card__label text-xs font-semibold text-zinc-400">{label}</div>
      <div className={`sc-stat-card__value mt-auto truncate pt-1 text-xl font-black ${tone || 'text-white'}`}>{value}</div>
    </div>
  )
}

/**
 * The session's data-quality verdict and the facts behind it, shared by the
 * meta line's "Data: <label>" button and the Status tab's list (d3-v2
 * session-original moved the header's Data quality disclosure there).
 */
export interface SessionDataQuality {
  label: AnalyticsQualityLabel
  chatPct?: number
  chatSpanMinutes?: number
  streamSpanMinutes?: number
  viewerSamples?: number
  viewerSourceLabel?: string
  vodState: string
}

export function deriveSessionDataQuality(
  detail?: AnalyticsStreamDetail,
  summaryMetrics?: StreamSummaryMetrics,
): SessionDataQuality {
  const label = deriveAnalyticsQualityLabel({
    analyticsQuality: detail?.analyticsQuality,
    summaryMetrics,
    rollupCount: detail?.timelineMinutes ?? detail?.rollups?.length,
    chatMessages: detail?.stream?.chatMessages,
    vodId: detail?.vodId ?? detail?.stream?.vodId,
    chartState: detail?.availability?.chartState,
    chartUsable: detail?.availability?.chartUsable,
  })
  const vodState = (detail?.availability?.vodState ?? '').toLowerCase()
  const hasVod = Boolean(resolveAnalyticsVodId(detail))
  return {
    label,
    chatPct: detail?.chatCoveragePct ?? detail?.chatCoverage?.coveragePct ?? summaryMetrics?.data_coverage_pct,
    chatSpanMinutes: detail?.chatCoverage?.chatSpanMinutes,
    streamSpanMinutes: detail?.chatCoverage?.streamSpanMinutes,
    viewerSamples: summaryMetrics?.viewerSampleCount ?? detail?.stream?.viewerSamples,
    viewerSourceLabel: mapViewerSourceBadge(detail?.viewerSource)?.label,
    // A stale live-archive status must not claim the broadcast is live when
    // lifecycle evidence is unavailable (or confirms that it ended).
    vodState: hasVod ? 'linked'
      : vodState === 'pending_live' && detail?.stream?.lifecycleState !== 'confirmed_live' ? 'unavailable'
        : vodState ? vodState.replace(/_/g, ' ') : 'unavailable',
  }
}

/** The mockup's neutral warning mark for a data-quality label other than Good. */
export function DataQualityWarnIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-data-quality-warn
    >
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.5v.01" />
    </svg>
  )
}

/**
 * "Data: <label>" in the session meta line. It opens the Status tab, which
 * holds the facts; a label other than Good carries a neutral warning mark.
 */
export function DataQualityButton({
  detail,
  summaryMetrics,
  pending = false,
  onOpen,
}: {
  detail?: AnalyticsStreamDetail
  summaryMetrics?: StreamSummaryMetrics
  /** Still loading or failed: a neutral placeholder, never a "No data" verdict. */
  pending?: boolean
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  if (pending) {
    return (
      <span className="ssp-dqb" data-data-quality-pending aria-label="Data quality: not known yet">
        Data: —
      </span>
    )
  }
  const { label } = deriveSessionDataQuality(detail, summaryMetrics)
  return (
    <button
      type="button"
      className="ssp-dqb"
      data-data-quality
      data-quality-label={label}
      aria-controls="session-panel-status"
      title="Coverage, viewer samples and the VOD link, in the Status tab"
      onClick={onOpen}
    >
      {label !== 'Good' ? <DataQualityWarnIcon /> : null}
      Data: {label}
    </button>
  )
}

/** The leading untracked span, as the meta line prints it: "54s", "2m", "2m 5s". */
export function formatCoverageLead(seconds: number): string {
  const t = Math.round(seconds)
  if (t < 60) return `${t}s`
  const mins = Math.floor(t / 60)
  const secs = t % 60
  return secs ? `${mins}m ${secs}s` : `${mins}m`
}

/** Seconds at the start of the stream that were not tracked, or null. */
export function resolveCoverageLeadSeconds(
  offsetSeconds?: number,
  missingRanges?: Array<{ fromOffsetSeconds: number; toOffsetSeconds: number }>,
): number | null {
  const start = missingRanges?.[0]?.toOffsetSeconds ?? offsetSeconds
  return start == null || !Number.isFinite(start) || start <= 0 ? null : start
}

/**
 * "First 54s not tracked" in the session meta line (was the amber coverage
 * banner). The backend's own wording stays available as the title.
 */
export function CoverageStartMetaItem({
  offsetSeconds,
  missingRanges,
  message,
}: {
  offsetSeconds?: number
  missingRanges?: Array<{ fromOffsetSeconds: number; toOffsetSeconds: number }>
  message?: string
}) {
  const start = resolveCoverageLeadSeconds(offsetSeconds, missingRanges)
  if (start == null) return null
  return (
    <span className="mi" data-coverage-start title={message?.trim() || undefined}>
      {`First ${formatCoverageLead(start)} not tracked`}
    </span>
  )
}

export function DataQualityDisclosure({
  detail,
  summaryMetrics,
  pending = false,
}: {
  detail?: AnalyticsStreamDetail
  summaryMetrics?: StreamSummaryMetrics
  /**
   * The session is still loading or its request failed. There is no data to
   * judge, so show a neutral placeholder instead of a "No data" verdict.
   */
  pending?: boolean
}) {
  const quality = deriveAnalyticsQualityLabel({
    analyticsQuality: detail?.analyticsQuality,
    summaryMetrics,
    rollupCount: detail?.timelineMinutes ?? detail?.rollups?.length,
    chatMessages: detail?.stream?.chatMessages,
    vodId: detail?.vodId ?? detail?.stream?.vodId,
    chartState: detail?.availability?.chartState,
    chartUsable: detail?.availability?.chartUsable,
  })
  const chatPct = detail?.chatCoveragePct ?? detail?.chatCoverage?.coveragePct ?? summaryMetrics?.data_coverage_pct
  const chatSpan = detail?.chatCoverage?.chatSpanMinutes
  const streamSpan = detail?.chatCoverage?.streamSpanMinutes
  const viewerSamples = summaryMetrics?.viewerSampleCount ?? detail?.stream?.viewerSamples
  const viewerSource = mapViewerSourceBadge(detail?.viewerSource)
  const vodState = (detail?.availability?.vodState ?? '').toLowerCase()
  const hasVod = Boolean(resolveAnalyticsVodId(detail))
  // A stale live-archive status must not claim the broadcast is live when
  // lifecycle evidence is unavailable (or confirms that it ended).
  const displayedVodState = hasVod ? 'linked'
    : vodState === 'pending_live' && detail?.stream?.lifecycleState !== 'confirmed_live' ? 'unavailable'
      : vodState ? vodState.replace(/_/g, ' ') : 'status unavailable'

  if (pending) {
    return (
      <div className="text-xs normal-case">
        <span
          className="flex min-h-11 items-center rounded border border-white/10 bg-white/[0.04] px-3 py-2 font-black uppercase text-zinc-500"
          data-data-quality-pending
          aria-label="Data quality: not known yet"
        >
          Data quality: —
        </span>
      </div>
    )
  }

  return (
    <details className="relative text-xs normal-case" data-data-quality-disclosure>
      <summary
        className={`min-h-11 cursor-pointer list-none rounded border px-3 py-2 font-black uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${analyticsQualityChipClass(quality)}`}
      >
        Data quality: {quality}
      </summary>
      <div className="absolute left-0 z-20 mt-2 min-w-64 rounded border border-white/15 bg-zinc-950 p-3 font-semibold leading-5 text-zinc-200 shadow-xl">
        <dl className="space-y-2">
          <div><dt className="inline text-zinc-400">Chat measured: </dt><dd className="inline">{chatPct != null ? `${formatCoveragePercent(chatPct)} of the timeline` : 'coverage unavailable'}{chatSpan != null && streamSpan != null ? ` (${chatSpan} of ${streamSpan} minutes)` : ''}</dd></div>
          <div><dt className="inline text-zinc-400">Viewer measurements: </dt><dd className="inline">{viewerSamples && viewerSamples > 0 ? `${viewerSamples} samples` : 'unavailable'}{viewerSource ? ` · ${viewerSource.label}` : ''}</dd></div>
          <div><dt className="inline text-zinc-400">VOD: </dt><dd className="inline">{displayedVodState}</dd></div>
          {detail?.stream?.lifecycleState === 'confirmed_ended' ? <div>
            <dt className="text-zinc-400">Broadcast end window</dt>
            <dd>Last confirmed live: {formatDateTime(detail.stream.lifecycleObservedAt)}. Offline confirmed: {formatDateTime(detail.stream.lifecycleDetectedAt)}. The exact end time is not measured.</dd>
          </div> : null}
        </dl>
        <p className="mt-2 text-zinc-400">Quality reflects measured coverage and backend-reported availability; missing spans are not estimated.</p>
      </div>
    </details>
  )
}

export function ChatCoverageBadge({ detail }: { detail?: AnalyticsStreamDetail }) {
  const pct = detail?.chatCoveragePct ?? detail?.chatCoverage?.coveragePct
  if (pct === undefined) return null
  const partial = detail?.chatCoverage?.partial
  const title = partial
    ? `Chat spans ${detail?.chatCoverage?.chatSpanMinutes ?? 0} of ${detail?.chatCoverage?.streamSpanMinutes ?? 0} stream minutes — re-sync later for more`
    : 'Chat rollups cover most of the stream timeline'
  return (
    <span
      title={title}
      className={`rounded border px-2 py-1 text-xs font-black uppercase ${
        partial
          ? 'border-amber-400/25 bg-amber-500/10 text-amber-200'
          : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
      }`}
    >
      {formatCoveragePercent(pct)} chat coverage
    </span>
  )
}

const SOURCE_PILL_LABELS: Record<string, string> = {
  analytics_db: 'Tracked',
  live: 'Live',
  gql: 'Imported VOD',
  ivr: 'Legacy',
  mixed: 'Mixed',
}

function formatSourcePillLabel(source: SourceStatus): string {
  const custom = source.label?.trim()
  if (custom && !/^analytics\s*db$/i.test(custom)) return custom
  return SOURCE_PILL_LABELS[source.source] ?? source.source.replace(/_/g, ' ')
}

function formatSourcePillState(state: string): string {
  if (state === 'ready') return ''
  return state.replace(/_/g, ' ')
}

export function SourcePills({ sources }: { sources?: SourceStatus[] }) {
  if (!sources?.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source) => {
        const label = formatSourcePillLabel(source)
        const stateSuffix = formatSourcePillState(source.state)
        const text = stateSuffix ? `${label} ${stateSuffix}` : label
        return (
          <span
            key={`${source.source}-${source.state}-${source.label ?? ''}`}
            title={source.label}
            className={`rounded border px-2 py-1 text-xs font-black uppercase ${sourceTone(source.state)}`}
          >
            {text}
          </span>
        )
      })}
    </div>
  )
}

export function EmoteProviderBadge({ provider }: { provider?: string }) {
  if (!provider) return null
  return (
    <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-black uppercase ${emoteProviderTone(provider)}`}>
      {emoteProviderLabel(provider)}
    </span>
  )
}

export function ViewerSourceBadge({ source }: { source?: string }) {
  const badge = mapViewerSourceBadge(source)
  if (!badge) return null
  return (
    <span
      className={`rounded border px-2 py-1 text-xs font-black uppercase ${viewerSourceBadgeClass(badge.tone)}`}
    >
      {badge.label}
    </span>
  )
}

export function AnalyticsQualityChip({
  detail,
  summaryMetrics,
}: {
  detail?: AnalyticsStreamDetail
  summaryMetrics?: StreamSummaryMetrics
}) {
  const label = deriveAnalyticsQualityLabel({
    analyticsQuality: detail?.analyticsQuality,
    summaryMetrics,
    rollupCount: detail?.timelineMinutes ?? detail?.rollups?.length,
    chatMessages: detail?.stream?.chatMessages,
    vodId: detail?.vodId ?? detail?.stream?.vodId,
    chartState: detail?.availability?.chartState,
    chartUsable: detail?.availability?.chartUsable,
  })
  return (
    <span
      className={`rounded border px-2 py-1 text-xs font-black uppercase ${analyticsQualityChipClass(label)}`}
      title="Derived from coverage, sync health, and rollup availability"
    >
      Analytics {label}
    </span>
  )
}

export function CoverageFacets({
  detail,
  summaryMetrics,
}: {
  detail?: AnalyticsStreamDetail
  summaryMetrics?: StreamSummaryMetrics
}) {
  const chatPct = detail?.chatCoveragePct ?? summaryMetrics?.data_coverage_pct
  const viewerSamples = summaryMetrics?.viewerSampleCount ?? detail?.stream?.viewerSamples
  if (chatPct == null && !viewerSamples) return null
  const parts: string[] = []
  if (chatPct != null && chatPct > 0) parts.push(`Chat ${Math.round(chatPct)}%`)
  if (viewerSamples != null && viewerSamples > 0) parts.push(`Viewer samples ${viewerSamples}`)
  if (parts.length === 0) return null
  return (
    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs font-semibold normal-case text-zinc-400">
      {parts.join(' · ')}
    </span>
  )
}

export function CoverageStartBanner({
  offsetSeconds,
  missingRanges,
  message,
}: {
  offsetSeconds?: number
  missingRanges?: Array<{ fromOffsetSeconds: number; toOffsetSeconds: number }>
  message?: string
}) {
  const start = missingRanges?.[0]?.toOffsetSeconds ?? offsetSeconds
  if (start == null || start <= 0) return null
  const mins = Math.floor(start / 60)
  const secs = start % 60
  const label = secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  // Say what is missing in viewer terms; the backend's own wording stays available as a tooltip.
  // No percentage here: the backend coverage figure is not a share of the whole broadcast.
  return (
    <div
      className="rounded border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs font-semibold text-amber-100/90"
      role="status"
      title={message?.trim() || undefined}
    >
      {`The first ${label} weren't tracked`}
    </div>
  )
}

export function VodAvailabilityChip({ detail }: { detail?: AnalyticsStreamDetail }) {
  const state = (detail?.availability?.vodState ?? '').toLowerCase()
  if (!state || state === 'none' || state === 'linked' || resolveAnalyticsVodId(detail)) return null
  const label =
    state === 'pending_live'
      ? 'VOD pending (live)'
      : state === 'resolving'
        ? 'Waiting for Twitch VOD'
        : state === 'request_failed'
          ? 'VOD lookup failed'
          : state === 'unavailable'
            ? 'VOD unavailable'
            : `VOD ${state.replace(/_/g, ' ')}`
  return (
    <span
      className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs font-black uppercase text-zinc-300"
      title={detail?.availability?.vodMessage}
    >
      {label}
    </span>
  )
}
