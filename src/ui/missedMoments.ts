import type { PulseBackfillJob, PulseCoverage } from '../shared/messages.ts'

export type MissedMomentsButtonState =
  | 'hidden'
  | 'load'
  | 'loading'
  | 'waiting_vod'
  | 'backfilling'
  | 'refreshed'
  | 'failed'
  | 'unavailable'

export function missedMomentsButtonState(
  coverage: PulseCoverage | undefined,
  busy: boolean,
  refreshed: boolean,
): MissedMomentsButtonState {
  if (!coverage) return 'hidden'
  if (refreshed) return 'refreshed'
  if (busy || coverage.state === 'backfill_running') return 'backfilling'
  if (coverage.state === 'waiting_for_vod') return 'waiting_vod'
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
    case 'waiting_vod':
      return 'Waiting for VOD'
    case 'backfilling': {
      const pct = job?.progress?.percent
      if (typeof pct === 'number' && pct > 0) {
        return `Backfilling… ${pct}%`
      }
      return job?.message ?? 'Backfilling…'
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

export function evaluateBackfillRefresh(
  before: { coverageStartOffsetSeconds?: number; coverage?: PulseCoverage } | null | undefined,
  after: { coverageStartOffsetSeconds?: number; coverage?: PulseCoverage } | null | undefined,
): BackfillRefreshOutcome {
  if (!after?.coverage) return 'none'
  if (after.coverage.hasFullStreamCoverage) return 'full'

  const beforeStart =
    before?.coverageStartOffsetSeconds
    ?? before?.coverage?.coverageStartOffsetSeconds
    ?? Number.POSITIVE_INFINITY
  const afterStart =
    after.coverageStartOffsetSeconds
    ?? after.coverage.coverageStartOffsetSeconds
    ?? beforeStart

  if (afterStart + 120 < beforeStart) return 'partial'
  return 'none'
}

export function shouldShowMissedMomentsBanner(coverage: PulseCoverage | undefined): boolean {
  if (!coverage) return false
  if (coverage.hasFullStreamCoverage) return false
  return coverage.coverageStartOffsetSeconds > 60
    || coverage.hasGaps
    || coverage.canBackfill
    || coverage.state === 'backfill_running'
    || coverage.state === 'waiting_for_vod'
    || coverage.state === 'backfill_failed'
}
