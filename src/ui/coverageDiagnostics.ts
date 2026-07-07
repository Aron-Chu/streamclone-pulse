import { formatHeatOffset } from '@streamclone/pulse-core'
import type { PulseBackfillJob } from '../shared/messages.ts'
import { isPulseBackfillTerminal, backendResolvedVod, resolvePulseCoverage, type PulseCoverageSource } from './missedMoments.ts'

export interface CoverageCheckItem {
  label: string
  ok: boolean
  detail: string
}

export interface CoverageDiagnostics {
  checks: CoverageCheckItem[]
  /** Actionable hint when blocked or failed */
  fixHint?: string
  /** Short status line for the card footer */
  statusLine?: string
}

export function coverageDiagnostics(
  source: PulseCoverageSource & { tracking?: boolean; streamId?: string },
  job?: PulseBackfillJob | null,
  lastCheckedAt?: number | null,
): CoverageDiagnostics {
  const coverage = resolvePulseCoverage(source)
  const checks: CoverageCheckItem[] = []
  const tracking = Boolean(source.tracking)
  const hasVod = Boolean(String(source.vodId ?? '').trim())
  const backendVod = backendResolvedVod(source)
  const hasStream = Boolean(String(source.streamId ?? '').trim())

  checks.push({
    label: 'Live tracking',
    ok: tracking,
    detail: tracking ? 'Streamclone is collecting chat' : 'Track this channel to collect chat',
  })

  checks.push({
    label: 'Twitch VOD link',
    ok: hasVod || backendVod,
    detail: hasVod
      ? `VOD ${String(source.vodId).slice(0, 8)}… linked`
      : backendVod
        ? 'Backend linked VOD via Helix — local page discovery is optional'
        : 'Waiting for Twitch to assign a VOD ID (needed for earlier chat)',
  })

  const backfillActive = job != null && !isPulseBackfillTerminal(job.status)
  const backfillFailed = job?.status === 'failed' || coverage?.state === 'backfill_failed'
  const backfillDone = job?.status === 'done' || job?.status === 'already_available'

  if (coverage?.state === 'backfill_running' || backfillActive) {
    checks.push({
      label: 'Backfill',
      ok: true,
      detail: job?.message ?? 'Loading missed chat replay…',
    })
  } else if (backfillFailed) {
    checks.push({
      label: 'Backfill',
      ok: false,
      detail: job?.error ?? job?.message ?? 'Backfill failed',
    })
  } else if (backfillDone) {
    checks.push({
      label: 'Backfill',
      ok: true,
      detail: 'Missed moments loaded',
    })
  } else if (coverage && coverage.coverageStartOffsetSeconds > 120 && !coverage.hasFullStreamCoverage) {
    checks.push({
      label: 'Early stream chat',
      ok: hasVod || backendVod,
      detail: hasVod || backendVod
        ? `Ready to load before ${formatHeatOffset(coverage.coverageStartOffsetSeconds)}`
        : 'Needs VOD link before backfill can run',
    })
  }

  let fixHint: string | undefined
  if (!tracking) {
    fixHint = 'Tap Track this channel in the header so Streamclone collects live chat.'
  } else if (!hasVod && source.isLive) {
    fixHint =
      'Twitch assigns a VOD ID during live streams. Pulse checks automatically — or tap Check for VOD. If this persists after 30+ minutes, verify Twitch API credentials on your Streamclone backend.'
  } else if (backfillFailed) {
    fixHint = job?.error?.includes('capacity')
      ? 'Another backfill may be running — wait a minute and tap Retry.'
      : 'Try Retry, or open full analytics to sync from Streamclone.'
  } else if (job?.status === 'waiting_for_vod') {
    fixHint = 'Backfill queued but VOD chat is not published yet. Pulse will retry when the VOD link appears.'
  }

  let statusLine: string | undefined
  if (lastCheckedAt) {
    const secs = Math.max(0, Math.round((Date.now() - lastCheckedAt) / 1000))
    statusLine = secs < 5 ? 'Checked just now' : `Last checked ${secs}s ago`
  }
  if (backfillActive && typeof job?.progress?.percent === 'number' && job.progress.percent > 0) {
    statusLine = `Backfilling… ${job.progress.percent}%`
  } else if (job?.message && backfillActive) {
    statusLine = job.message
  }

  return { checks, fixHint, statusLine }
}
