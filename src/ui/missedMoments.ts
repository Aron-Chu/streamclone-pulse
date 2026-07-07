import { formatHeatOffset } from '@streamclone/pulse-core'
import type { PulseBackfillJob, PulseCoverage } from '../shared/messages.ts'

const LATE_START_SEC = 120
const GAP_TAIL_SEC = 60

/** Pulse payload fields used to derive backfill / load-from-start UI. */
export type PulseCoverageSource = {
  coverage?: PulseCoverage
  coverageStartOffsetSeconds?: number
  vodId?: string | null
  isLive?: boolean
}

function normalizedVodId(source: PulseCoverageSource): string {
  return String(source.vodId ?? '').trim()
}

const BACKEND_VOD_READY_STATUSES = new Set(['available', 'linked', 'published', 'ready'])

/** Backend Helix / payload linked a VOD — local page GQL discovery is non-authoritative. */
export function backendResolvedVod(source: PulseCoverageSource): boolean {
  if (normalizedVodId(source)) return true
  const status = String(source.coverage?.vodStatus ?? '').trim().toLowerCase()
  return BACKEND_VOD_READY_STATUSES.has(status)
}

/** Backend sent authoritative coverage copy — skip legacy client derivation. */
function isBackendCoverageAuthoritative(coverage: PulseCoverage): boolean {
  if (coverage.copyKey?.trim()) return true
  if (!coverage.message?.trim()) return false
  return (
    coverage.trackedFromStart !== undefined
    || Boolean(coverage.vodStatus?.trim())
    || coverage.manualRetryAllowed !== undefined
    || Boolean(coverage.chatSource?.trim())
  )
}

function mergeCoverageStart(source: PulseCoverageSource, base: PulseCoverage): PulseCoverage {
  const topStart = Math.max(0, source.coverageStartOffsetSeconds ?? 0)
  const start = Math.max(topStart, base.coverageStartOffsetSeconds ?? 0)
  return { ...base, coverageStartOffsetSeconds: start }
}

/** G2: load CTA only when backend approves backfill and a VOD id (or fresh hint) exists. */
export function canShowVodBackfillCTA(
  source: PulseCoverageSource,
  explicitHint?: string | null,
): boolean {
  const coverage = resolvePulseCoverage(source)
  if (!coverage?.canBackfill) return false
  const vodId = normalizedVodId(source)
  const hint = String(explicitHint ?? '').trim()
  return Boolean(vodId || hint)
}

/** Backend may omit nested coverage — derive it from top-level rollup start + vod. */
export function resolvePulseCoverage(source: PulseCoverageSource): PulseCoverage | undefined {
  const topStart = Math.max(0, source.coverageStartOffsetSeconds ?? 0)
  const base = source.coverage
  const start = Math.max(topStart, base?.coverageStartOffsetSeconds ?? 0)
  const hasVod = Boolean(normalizedVodId(source))

  if (base && isBackendCoverageAuthoritative(base)) {
    return mergeCoverageStart(source, base)
  }

  if (base?.hasFullStreamCoverage) {
    return base
  }
  if (
    base?.state === 'backfill_running'
    || base?.state === 'waiting_for_vod'
    || base?.state === 'backfill_failed'
  ) {
    return { ...base, coverageStartOffsetSeconds: start }
  }
  if (base?.canBackfill || base?.hasGaps) {
    return { ...base, coverageStartOffsetSeconds: start }
  }
  if (start <= 60) {
    return base?.state ? { ...base, coverageStartOffsetSeconds: start } : undefined
  }

  // Legacy fallback when backend omits nested coverage truth fields.
  const missingEnd = Math.max(0, start - GAP_TAIL_SEC)
  return {
    state: hasVod ? 'missing_ranges_detected' : source.isLive ? 'waiting_for_vod' : 'partial_tracking',
    coverageStartOffsetSeconds: start,
    coverageEndOffsetSeconds: base?.coverageEndOffsetSeconds ?? 0,
    hasFullStreamCoverage: false,
    hasGaps: true,
    missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: missingEnd }],
    canBackfill: hasVod && start > LATE_START_SEC,
    backfillReason: hasVod ? 'vod_available' : source.isLive ? 'waiting_vod' : undefined,
    message: hasVod
      ? `Chat activity starts at ${formatHeatOffset(start)} — load earlier minutes to fill the graph.`
      : source.isLive
        ? 'VOD chat not available yet — load after Twitch publishes the archive.'
        : `Showing chat from ${formatHeatOffset(start)}`,
  }
}

export type MissedMomentsButtonState =
  | 'hidden'
  | 'load'
  | 'loading'
  | 'check_vod'
  | 'waiting_vod'
  | 'backfilling'
  | 'refreshed'
  | 'failed'
  | 'unavailable'

export function missedMomentsButtonState(
  source: PulseCoverageSource,
  busy: boolean,
  refreshed: boolean,
  explicitHint?: string | null,
): MissedMomentsButtonState {
  const coverage = resolvePulseCoverage(source)
  if (!coverage) return 'hidden'
  if (refreshed) return 'refreshed'
  if (busy || coverage.state === 'backfill_running') return 'backfilling'
  if (coverage.state === 'waiting_for_vod') return 'check_vod'
  if (coverage.state === 'vod_unavailable') return 'unavailable'
  if (coverage.state === 'backfill_failed') return 'failed'
  if (coverage.hasFullStreamCoverage) return 'hidden'
  if (canShowVodBackfillCTA(source, explicitHint)) return 'load'
  if (coverage.canBackfill && !normalizedVodId(source)) return 'check_vod'
  return 'hidden'
}

export function missedMomentsButtonLabel(state: MissedMomentsButtonState, job?: PulseBackfillJob | null): string {
  switch (state) {
    case 'load':
      return 'Fill from Twitch VOD'
    case 'loading':
      return 'Loading VOD chat…'
    case 'check_vod':
      return 'Check for VOD'
    case 'waiting_vod':
      return 'Waiting for VOD'
    case 'backfilling': {
      const pct = job?.progress?.percent
      if (typeof pct === 'number' && pct > 0) {
        return `Loading VOD chat… ${pct}%`
      }
      return job?.message ?? 'Loading VOD chat via Twitch…'
    }
    case 'refreshed':
      return 'Moments refreshed'
    case 'failed':
      return "Couldn't backfill"
    case 'unavailable':
      return 'Chat replay unavailable'
    default:
      return ''
  }
}

export function isPulseBackfillTerminal(status: string | undefined): boolean {
  return status === 'done'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'already_available'
}

export type BackfillRefreshOutcome = 'full' | 'partial' | 'none'

function coverageStartSeconds(source: PulseCoverageSource | null | undefined): number {
  const resolved = source ? resolvePulseCoverage(source) : undefined
  if (resolved?.coverageStartOffsetSeconds != null) {
    return resolved.coverageStartOffsetSeconds
  }
  return Math.max(0, source?.coverageStartOffsetSeconds ?? source?.coverage?.coverageStartOffsetSeconds ?? 0)
}

export function evaluateBackfillRefresh(
  before: PulseCoverageSource | null | undefined,
  after: PulseCoverageSource | null | undefined,
): BackfillRefreshOutcome {
  const afterCoverage = after ? resolvePulseCoverage(after) : undefined
  if (!afterCoverage) return 'none'
  if (afterCoverage.hasFullStreamCoverage) return 'full'

  const beforeStart = coverageStartSeconds(before)
  const afterStart = coverageStartSeconds(after)
  if (beforeStart < Number.POSITIVE_INFINITY && afterStart + GAP_TAIL_SEC < beforeStart) {
    return 'partial'
  }
  if (afterCoverage.canBackfill === false && !afterCoverage.hasGaps && afterStart <= LATE_START_SEC) {
    return 'full'
  }
  return 'none'
}

export function shouldShowMissedMomentsBanner(source: PulseCoverageSource): boolean {
  const coverage = resolvePulseCoverage(source)
  if (!coverage) return false
  if (coverage.hasFullStreamCoverage) return false
  if (canShowVodBackfillCTA(source)) return true
  return coverage.state === 'backfill_running'
    || coverage.state === 'waiting_for_vod'
    || coverage.state === 'backfill_failed'
}

/** Show “From stream start” only when there is a real late-join or VOD/backfill path — not on every live stream. */
export function shouldShowStreamStartAction(
  source: PulseCoverageSource & { tracking?: boolean },
): boolean {
  if (!source.tracking) return false
  const coverage = resolvePulseCoverage(source)
  const start = coverageStartSeconds(source)
  const hasVod = Boolean(normalizedVodId(source))
  if (start > LATE_START_SEC) return true
  if (hasVod) return true
  if (coverage?.canBackfill) return true
  if (coverage?.hasGaps && hasVod) return true
  if (
    coverage?.state === 'backfill_running'
    || coverage?.state === 'waiting_for_vod'
    || coverage?.state === 'backfill_failed'
  ) {
    return true
  }
  return false
}

export interface CoverageCardCopy {
  title: string
  body: string
  detail?: string
}

export function coverageCardCopy(source: PulseCoverageSource): CoverageCardCopy | null {
  const coverage = resolvePulseCoverage(source)
  if (!coverage) return null

  if (coverage.copyKey?.trim() && coverage.message?.trim()) {
    return {
      title: coverageTitleFromCopyKey(coverage.copyKey),
      body: coverage.message,
      detail: coverage.chatSourceDetail?.trim() || undefined,
    }
  }

  const start = formatHeatOffset(coverage.coverageStartOffsetSeconds)
  const missingEnd = coverage.missingRanges?.[0]?.toOffsetSeconds
  const missingMinutes = missingEnd != null ? formatHeatOffset(missingEnd) : null

  if (coverage.hasFullStreamCoverage || coverage.coverageStartOffsetSeconds <= 60) {
    return {
      title: 'Full stream tracked',
      body: 'Moments from 00:00 → live',
    }
  }

  if (coverage.state === 'waiting_for_vod' && source.isLive) {
    const missingEnd = coverage.missingRanges?.[0]?.toOffsetSeconds
    const missingLabel = missingEnd != null ? formatHeatOffset(missingEnd) : start
    return {
      title: 'Partial coverage',
      body: `Live IRC tracking from ${start} → now`,
      detail: `Chat before ${missingLabel} needs a Twitch VOD archive — not IRC. Use “From stream start” to seek the player (DVR); it does not fill the chart without a VOD.`,
    }
  }

  if (canShowVodBackfillCTA(source)) {
    return {
      title: 'Partial coverage',
      body: 'Fill missing start from Twitch VOD',
      detail: missingMinutes
        ? `Missing first ${missingMinutes.replace(/^00:/, '')} — loads Twitch VOD chat, not live IRC.`
        : `Missing first ${start.replace(/^00:/, '')} — loads Twitch VOD chat, not live IRC.`,
    }
  }

  return {
    title: 'Partial coverage',
    body: `Showing moments from ${start} → live`,
    detail: missingMinutes
      ? `Missing first ${missingMinutes.replace(/^00:/, '')}`
      : `Missing first ${start.replace(/^00:/, '')}`,
  }
}

function coverageTitleFromCopyKey(copyKey: string): string {
  switch (copyKey.trim()) {
    case 'full_stream_tracked':
      return 'Full stream tracked'
    case 'partial_tracking':
    case 'missing_ranges_detected':
      return 'Partial coverage'
    case 'waiting_for_vod':
      return 'Waiting for VOD'
    case 'backfill_running':
      return 'Loading missed chat'
    case 'backfill_failed':
      return 'Backfill failed'
    case 'vod_unavailable':
      return 'Chat replay unavailable'
    default:
      return 'Coverage'
  }
}
