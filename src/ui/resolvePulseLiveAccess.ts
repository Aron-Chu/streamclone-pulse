import type { ExtensionCoverageTierResponse, PulsePayload } from '../shared/messages.ts'
import { isPulseTop500Supported } from './pulseEligibility.ts'
import { PULSE_STREAM_START_TOLERANCE_SEC } from './coverageStartHint.ts'

export { PULSE_STREAM_START_TOLERANCE_SEC }
export const COVERAGE_TIER_ACTIVE_LIVE = 'active_live_coverage'

export type PulseLiveAccessState =
  | 'not_in_roster'
  | 'full_live'
  | 'not_tracked'
  | 'not_irc_tracked'
  | 'late_session'
  | 'offline'

export interface PulseLiveAccessInput {
  payload: PulsePayload | null
  coverageTier?: ExtensionCoverageTierResponse | null
  alwaysTrackedLogins?: readonly string[]
  sessionOpenedAtMs?: number | null
  pageIsLive?: boolean
  /** When true, only active_live_coverage + tracking yields full_live. */
  hosted?: boolean
}

export interface PulseLiveAccessResult {
  state: PulseLiveAccessState
  coverageStartOffsetSeconds: number
  hostedActiveCount: number | null
  hostedActiveLimit: number | null
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase()
}

function isAlwaysTracked(login: string, alwaysTrackedLogins: readonly string[] | undefined): boolean {
  if (!alwaysTrackedLogins?.length) return false
  const normalized = normalizeLogin(login)
  return alwaysTrackedLogins.some(item => normalizeLogin(item) === normalized)
}

/** Seconds from stream start to when the user opened this channel tab (null if unknown). */
export function secondsSinceStreamStartAt(
  startedAt: string | undefined,
  openedAtMs: number | null | undefined,
): number | null {
  if (!startedAt || openedAtMs == null || !Number.isFinite(openedAtMs)) return null
  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs)) return null
  return Math.max(0, Math.round((openedAtMs - startMs) / 1000))
}

function isLiveContext(payload: PulsePayload | null, pageIsLive: boolean): boolean {
  if (!payload) return pageIsLive
  if (payload.recap && !payload.isLive) return false
  return Boolean(payload.isLive || pageIsLive)
}

function trackedFromStreamStart(coverageStartOffsetSeconds: number): boolean {
  return coverageStartOffsetSeconds <= PULSE_STREAM_START_TOLERANCE_SEC
}

function canShowFullLive(args: {
  payload: PulsePayload
  alwaysTrackedLogins: readonly string[] | undefined
  sessionOpenedAtMs: number | null | undefined
}): boolean {
  const { payload, alwaysTrackedLogins, sessionOpenedAtMs } = args
  if (!payload.tracking || !isPulseTop500Supported(payload)) return false

  const coverageStart = Math.max(0, payload.coverageStartOffsetSeconds ?? 0)
  if (!trackedFromStreamStart(coverageStart)) return false

  if (isAlwaysTracked(payload.login, alwaysTrackedLogins)) {
    return true
  }

  const openedOffset = secondsSinceStreamStartAt(payload.startedAt, sessionOpenedAtMs)
  if (openedOffset != null && openedOffset <= PULSE_STREAM_START_TOLERANCE_SEC) {
    return true
  }

  return false
}

function baseResult(
  state: PulseLiveAccessState,
  coverageStartOffsetSeconds: number,
  coverageTier: ExtensionCoverageTierResponse | null | undefined,
): PulseLiveAccessResult {
  return {
    state,
    coverageStartOffsetSeconds,
    hostedActiveCount: coverageTier?.hostedCap?.activeCount ?? null,
    hostedActiveLimit: coverageTier?.hostedCap?.activeLimit ?? null,
  }
}

function resolveHostedPulseLiveAccess(input: PulseLiveAccessInput): PulseLiveAccessResult {
  const { payload, coverageTier, pageIsLive = false } = input
  const coverageStartOffsetSeconds = Math.max(
    0,
    payload?.coverageStartOffsetSeconds ?? payload?.coverage?.coverageStartOffsetSeconds ?? 0,
  )

  if (!payload || !isPulseTop500Supported(payload)) {
    return baseResult('not_in_roster', coverageStartOffsetSeconds, coverageTier)
  }

  if (!isLiveContext(payload, pageIsLive)) {
    return baseResult('offline', coverageStartOffsetSeconds, coverageTier)
  }

  if (coverageTier?.coverageTier === COVERAGE_TIER_ACTIVE_LIVE && payload.tracking) {
    return baseResult('full_live', coverageStartOffsetSeconds, coverageTier)
  }

  return baseResult('not_tracked', coverageStartOffsetSeconds, coverageTier)
}

function resolveLocalPulseLiveAccess(input: PulseLiveAccessInput): PulseLiveAccessResult {
  const { payload, coverageTier, alwaysTrackedLogins, sessionOpenedAtMs, pageIsLive = false } = input
  const coverageStartOffsetSeconds = Math.max(
    0,
    payload?.coverageStartOffsetSeconds ?? payload?.coverage?.coverageStartOffsetSeconds ?? 0,
  )

  if (!payload || !isPulseTop500Supported(payload)) {
    return baseResult('not_in_roster', coverageStartOffsetSeconds, coverageTier)
  }

  if (!isLiveContext(payload, pageIsLive)) {
    return baseResult('offline', coverageStartOffsetSeconds, coverageTier)
  }

  if (canShowFullLive({ payload, alwaysTrackedLogins, sessionOpenedAtMs })) {
    return baseResult('full_live', coverageStartOffsetSeconds, coverageTier)
  }

  if (payload.tracking && trackedFromStreamStart(coverageStartOffsetSeconds)) {
    return baseResult('late_session', coverageStartOffsetSeconds, coverageTier)
  }

  return baseResult('not_irc_tracked', coverageStartOffsetSeconds, coverageTier)
}

export function resolvePulseLiveAccess(input: PulseLiveAccessInput): PulseLiveAccessResult {
  if (input.hosted) {
    return resolveHostedPulseLiveAccess(input)
  }
  return resolveLocalPulseLiveAccess(input)
}

export function pulseLiveAccessAllowsChart(state: PulseLiveAccessState): boolean {
  return state === 'full_live'
}
