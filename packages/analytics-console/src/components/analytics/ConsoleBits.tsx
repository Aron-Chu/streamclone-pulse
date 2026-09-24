import { useEffect, useRef, useState } from 'react'
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
    <div className="sc-stat-card rounded border border-white/10 bg-white/[0.035] p-3" data-value-changed={pulse ? 'true' : undefined}>
      <div className="text-xs font-black uppercase text-zinc-400">{label}</div>
      <div className={`sc-stat-card__value mt-1 truncate text-xl font-black ${tone || 'text-white'}`}>{value}</div>
    </div>
  )
}

export function DataQualityDisclosure({
  detail,
  summaryMetrics,
}: {
  detail?: AnalyticsStreamDetail
  summaryMetrics?: StreamSummaryMetrics
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
