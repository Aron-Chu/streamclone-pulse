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

/** Backend may omit nested coverage — derive it from top-level rollup start + vod. */
export function resolvePulseCoverage(source: PulseCoverageSource): PulseCoverage | undefined {
  const topStart = Math.max(0, source.coverageStartOffsetSeconds ?? 0)
  const base = source.coverage
  const start = Math.max(topStart, base?.coverageStartOffsetSeconds ?? 0)
  const hasVod = Boolean(String(source.vodId ?? '').trim())

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
): MissedMomentsButtonState {
  const coverage = resolvePulseCoverage(source)
  if (!coverage) return 'hidden'
  if (refreshed) return 'refreshed'
  if (busy || coverage.state === 'backfill_running') return 'backfilling'
  if (coverage.state === 'waiting_for_vod') return 'check_vod'
  if (coverage.state === 'vod_unavailable') return 'unavailable'
  if (coverage.state === 'backfill_failed') return 'failed'
  if (coverage.hasFullStreamCoverage) return 'hidden'
  if (coverage.canBackfill) return 'load'
  if (coverage.coverageStartOffsetSeconds > 60 || coverage.hasGaps) return 'load'
  return 'hidden'
}

export function missedMomentsButtonLabel(state: MissedMomentsButtonState, job?: PulseBackfillJob | null): string {
  switch (state) {
    case 'load':
      return 'Load missed moments'
    case 'loading':
      return 'Loading missed moments…'
    case 'check_vod':
      return 'Check for VOD'
    case 'waiting_vod':
      return 'Waiting for VOD'
    case 'backfilling': {
      const pct = job?.progress?.percent
      if (typeof pct === 'number' && pct > 0) {
        return `Backfilling missed moments… ${pct}%`
      }
      return job?.message ?? 'Backfilling missed moments…'
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
  return coverage.coverageStartOffsetSeconds > 60
    || coverage.hasGaps
    || coverage.canBackfill
    || coverage.state === 'backfill_running'
    || coverage.state === 'waiting_for_vod'
    || coverage.state === 'backfill_failed'
}

export interface CoverageCardCopy {
  title: string
  body: string
  detail?: string
}

export function coverageCardCopy(source: PulseCoverageSource): CoverageCardCopy | null {
  const coverage = resolvePulseCoverage(source)
  if (!coverage) return null

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
      body: `Live tracking from ${start} → now`,
      detail: `Chat before ${missingLabel} needs a Twitch archive to backfill. Pulse keeps collecting live chat now. Use “From stream start” to seek the player (DVR); it does not fill the chart without a VOD.`,
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
