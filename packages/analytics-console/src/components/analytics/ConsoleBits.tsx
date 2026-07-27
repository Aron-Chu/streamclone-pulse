import { useEffect, useRef, useState } from 'react'
import type { AnalyticsStreamDetail, SourceStatus } from '../../apiTypes.ts'
import { emoteProviderLabel, emoteProviderTone } from '../../emoteUtils.ts'
import { sourceTone } from '../../utils/consoleFormat.ts'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import { mapViewerSourceBadge, viewerSourceBadgeClass } from '../../utils/sourceBadge.ts'
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
      <div className="text-[11px] font-black uppercase text-zinc-500">{label}</div>
      <div className={`sc-stat-card__value mt-1 truncate text-xl font-black ${tone || 'text-white'}`}>{value}</div>
    </div>
  )
}

export function ChatCoverageBadge({ detail }: { detail?: AnalyticsStreamDetail }) {
  const pct = detail?.chatCoveragePct ?? detail?.chatCoverage?.coveragePct
  if (pct === undefined || pct <= 0) return null
  const partial = detail?.chatCoverage?.partial
  const title = partial
    ? `Chat spans ${detail?.chatCoverage?.chatSpanMinutes ?? 0} of ${detail?.chatCoverage?.streamSpanMinutes ?? 0} stream minutes — re-sync later for more`
    : 'Chat rollups cover most of the stream timeline'
  return (
    <span
      title={title}
      className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${
        partial
          ? 'border-amber-400/25 bg-amber-500/10 text-amber-200'
          : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
      }`}
    >
      {Math.round(pct)}% chat coverage
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
            className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${sourceTone(source.state)}`}
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
    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase ${emoteProviderTone(provider)}`}>
      {emoteProviderLabel(provider)}
    </span>
  )
}

export function ViewerSourceBadge({ source }: { source?: string }) {
  const badge = mapViewerSourceBadge(source)
  if (!badge) return null
  return (
    <span
      className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${viewerSourceBadgeClass(badge.tone)}`}
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
    rollupCount: detail?.rollups?.length ?? detail?.timelineMinutes,
    chatMessages: detail?.stream?.chatMessages,
    vodId: detail?.vodId ?? detail?.stream?.vodId,
    chartState: detail?.availability?.chartState,
    chartUsable: detail?.availability?.chartUsable,
  })
  return (
    <span
      className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${analyticsQualityChipClass(label)}`}
      title={
        detail?.availability
          ? 'Backend-authored analytics quality'
          : 'Derived from backend analyticsQuality when present'
      }
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
  const dataPct =
    detail?.availability?.coveragePct
    ?? (detail as { dataCoveragePct?: number } | undefined)?.dataCoveragePct
    ?? summaryMetrics?.data_coverage_pct
  const chatPct = detail?.chatCoveragePct
  const viewerSamples = summaryMetrics?.viewerSampleCount ?? detail?.stream?.viewerSamples
  const corpus = detail?.availability?.corpusState
  const backfill = detail?.availability?.backfillState
  if (dataPct == null && chatPct == null && !viewerSamples && !corpus && !backfill) return null
  const parts: string[] = []
  if (dataPct != null && dataPct > 0) parts.push(`Data ${Math.round(dataPct)}%`)
  // Only label chat when chatCoveragePct is distinct chat evidence (not a data alias).
  if (chatPct != null && chatPct > 0 && (dataPct == null || Math.abs(chatPct - dataPct) > 0.5)) {
    parts.push(`Chat ${Math.round(chatPct)}%`)
  }
  if (viewerSamples != null && viewerSamples > 0) parts.push(`Viewer samples ${viewerSamples}`)
  if (corpus === 'ready') parts.push('Corpus ready')
  if (corpus === 'pending') parts.push('Corpus pending')
  if (corpus === 'failed' || corpus === 'absent') parts.push(`Corpus ${corpus}`)
  if (corpus === 'query_failed') parts.push('Corpus query failed')
  if (backfill && backfill !== 'idle') parts.push(`Backfill ${backfill}`)
  if (parts.length === 0) return null
  return (
    <span
      className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-semibold normal-case text-zinc-400"
      title={detail?.availability?.corpusMessage || detail?.availability?.coverageMessage}
    >
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
  const authoredEnd = missingRanges?.[0]?.toOffsetSeconds
  const start = authoredEnd ?? offsetSeconds
  // Keep 0–120 visible — do not suppress ranges ending at exactly 120.
  if (start == null || start <= 0) return null
  const mins = Math.floor(start / 60)
  const secs = start % 60
  const label = secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  return (
    <div
      className="rounded border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] font-semibold text-amber-100/90"
      role="status"
    >
      {message?.trim()
        || `Partial data coverage — missing 0:00–${label} (backend-authored)`}
    </div>
  )
}

export function VodAvailabilityChip({ detail }: { detail?: AnalyticsStreamDetail }) {
  const state = (detail?.availability?.vodState ?? '').toLowerCase()
  if (!state || state === 'none' || state === 'linked') return null
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
      className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-black uppercase text-zinc-300"
      title={detail?.availability?.vodMessage}
    >
      {label}
    </span>
  )
}
