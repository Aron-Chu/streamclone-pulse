/**
 * Backend-owned Channel Screener v1 contract.
 *
 * The browser only validates and presents these values. It must never derive
 * activity comparisons from client polling or reinterpret missing buckets as
 * measured zeroes.
 */

export type ChannelScreenerView = 'overview' | 'momentum' | 'coverage' | 'anomalies'

export type ScreenerMetricState =
  | 'ready'
  | 'new_activity'
  | 'warming'
  | 'partial'
  | 'unavailable'

export type ScreenerBaselineKind =
  | 'current_stream_measured_average'
  | 'current_stream_measured_average_before_event'

export interface ScreenerWindow {
  /** Unix milliseconds; inclusive. */
  start: number
  /** Unix milliseconds; exclusive. */
  end: number
  expectedMinutes: number
  measuredMinutes: number
  coveragePct?: number
}

export interface ScreenerEvidence {
  ircBound: boolean
  chatObservedLast5m: boolean
  rollupAvailable: boolean
  metadataSampledAt?: string
  metadataAgeSeconds?: number
}

export interface ScreenerMetricComparison {
  state: ScreenerMetricState
  reason?: string
  currentPerMin?: number
  baselinePerMin?: number
  absoluteDeltaPerMin?: number
  changePct?: number
  multiplier?: number
  currentMeasuredMinutes: number
  currentExpectedMinutes: number
  baselineMeasuredMinutes: number
  baselineExpectedMinutes: number
  baselineCoveragePct: number
}

export interface HubChannelScreenerV1 {
  version: 1
  streamId: string
  measuredAt: number
  baselineKind: 'current_stream_measured_average'
  state: ScreenerMetricState
  reason?: string
  currentWindow: ScreenerWindow
  baselineWindow: ScreenerWindow
  evidence: ScreenerEvidence
  chat: ScreenerMetricComparison
  emotes: ScreenerMetricComparison
  /** Legacy keys are prohibited on v1 but declared for additive consumer typing. */
  chatAcceleration?: never
  emoteAcceleration?: never
  viewerChatDivergence?: never
  anomalyReason?: never
  newlyLive?: never
  dataFreshnessAt?: never
}

/** Legacy additive fields remain readable while the v1 backend rolls out. */
export interface HubChannelScreenerLegacy {
  version?: undefined
  chatAcceleration?: number
  emoteAcceleration?: number
  viewerChatDivergence?: number
  anomalyReason?: string
  newlyLive?: boolean
  dataFreshnessAt?: string
}

export type HubChannelScreenerFields = HubChannelScreenerV1 | HubChannelScreenerLegacy

export interface HubLiveMomentComparison {
  baselineKind: 'current_stream_measured_average_before_event'
  eventAt: number
  baselineWindow: ScreenerWindow
  chat: ScreenerMetricComparison
  emotes: ScreenerMetricComparison
  evidence: HubLiveMomentEvidence
}

export interface HubLiveMomentEvidence {
  ircBound: boolean
  eventRollupAvailable: boolean
  baselineMeasuredMinutes: number
  baselineExpectedMinutes: number
  baselineCoveragePct: number
}

const REJECT_CLIENT_INVENTED_KEYS = [
  'pulseScore',
  'clientScore',
  'localAcceleration',
  'derivedAnomaly',
  'computedMomentum',
] as const

const STATES = new Set<ScreenerMetricState>([
  'ready',
  'new_activity',
  'warming',
  'partial',
  'unavailable',
])

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function finiteNonNegative(value: unknown): number | null {
  const n = finiteNumber(value)
  return n != null && n >= 0 ? n : null
}

function optionalFinite(row: Record<string, unknown>, key: string): number | undefined | null {
  if (!(key in row) || row[key] == null) return undefined
  return finiteNumber(row[key])
}

function optionalFiniteNonNegative(
  row: Record<string, unknown>,
  key: string,
): number | undefined | null {
  const value = optionalFinite(row, key)
  return value == null || value >= 0 ? value : null
}

function normalizeReason(value: unknown): string | undefined | null {
  if (value == null) return undefined
  if (typeof value !== 'string') return null
  const reason = value.trim()
  return reason || null
}

function normalizeState(value: unknown): ScreenerMetricState | null {
  return typeof value === 'string' && STATES.has(value as ScreenerMetricState)
    ? (value as ScreenerMetricState)
    : null
}

function normalizeWindow(
  raw: unknown,
  requireCoverage: boolean,
  allowEmpty = false,
): ScreenerWindow | null {
  const row = record(raw)
  if (!row) return null
  const start = finiteNonNegative(row.start)
  const end = finiteNonNegative(row.end)
  const expectedMinutes = finiteNonNegative(row.expectedMinutes)
  const measuredMinutes = finiteNonNegative(row.measuredMinutes)
  const coveragePct = optionalFinite(row, 'coveragePct')
  const isEmpty = end === start && expectedMinutes === 0 && measuredMinutes === 0
  if (
    start == null || end == null || end < start || expectedMinutes == null ||
    measuredMinutes == null || measuredMinutes > expectedMinutes || coveragePct === null ||
    (coveragePct != null && (coveragePct < 0 || coveragePct > 100)) ||
    (requireCoverage && coveragePct == null && !isEmpty) ||
    (end === start && (!allowEmpty || !isEmpty))
  ) return null
  return { start, end, expectedMinutes, measuredMinutes, coveragePct }
}

export function normalizeScreenerEvidence(raw: unknown): ScreenerEvidence | null {
  const row = record(raw)
  if (!row) return null
  if (
    typeof row.ircBound !== 'boolean' ||
    typeof row.chatObservedLast5m !== 'boolean' ||
    typeof row.rollupAvailable !== 'boolean'
  ) return null
  const metadataSampledAt = normalizeReason(row.metadataSampledAt)
  const metadataAgeSeconds = optionalFinite(row, 'metadataAgeSeconds')
  if (
    metadataSampledAt === null || metadataAgeSeconds === null ||
    (metadataAgeSeconds != null && metadataAgeSeconds < 0)
  ) return null
  return {
    ircBound: row.ircBound,
    chatObservedLast5m: row.chatObservedLast5m,
    rollupAvailable: row.rollupAvailable,
    metadataSampledAt,
    metadataAgeSeconds,
  }
}

export function normalizeScreenerMetricComparison(raw: unknown): ScreenerMetricComparison | null {
  const row = record(raw)
  if (!row) return null
  const state = normalizeState(row.state)
  const reason = normalizeReason(row.reason)
  const currentPerMin = optionalFiniteNonNegative(row, 'currentPerMin')
  const baselinePerMin = optionalFiniteNonNegative(row, 'baselinePerMin')
  const absoluteDeltaPerMin = optionalFinite(row, 'absoluteDeltaPerMin')
  const changePct = optionalFinite(row, 'changePct')
  const multiplier = optionalFiniteNonNegative(row, 'multiplier')
  const currentMeasuredMinutes = finiteNonNegative(row.currentMeasuredMinutes)
  const currentExpectedMinutes = finiteNonNegative(row.currentExpectedMinutes)
  const baselineMeasuredMinutes = finiteNonNegative(row.baselineMeasuredMinutes)
  const baselineExpectedMinutes = finiteNonNegative(row.baselineExpectedMinutes)
  const baselineCoveragePct = finiteNonNegative(row.baselineCoveragePct)
  if (
    !state || reason === null || currentPerMin === null || baselinePerMin === null ||
    absoluteDeltaPerMin === null || changePct === null || multiplier === null ||
    currentMeasuredMinutes == null || currentExpectedMinutes == null ||
    baselineMeasuredMinutes == null || baselineExpectedMinutes == null ||
    baselineCoveragePct == null || currentMeasuredMinutes > currentExpectedMinutes ||
    baselineMeasuredMinutes > baselineExpectedMinutes || baselineCoveragePct > 100
  ) return null
  return {
    state, reason, currentPerMin, baselinePerMin, absoluteDeltaPerMin, changePct, multiplier,
    currentMeasuredMinutes, currentExpectedMinutes, baselineMeasuredMinutes,
    baselineExpectedMinutes, baselineCoveragePct,
  }
}

function normalizeV1(row: Record<string, unknown>): HubChannelScreenerV1 | null {
  if (row.version !== 1) return null
  const streamId = typeof row.streamId === 'string' ? row.streamId.trim() : ''
  const measuredAt = finiteNonNegative(row.measuredAt)
  const state = normalizeState(row.state)
  const reason = normalizeReason(row.reason)
  const allowEmptyBaseline = state === 'warming' || state === 'unavailable'
  const currentWindow = normalizeWindow(row.currentWindow, false)
  const baselineWindow = normalizeWindow(row.baselineWindow, true, allowEmptyBaseline)
  const evidence = normalizeScreenerEvidence(row.evidence)
  const chat = normalizeScreenerMetricComparison(row.chat)
  const emotes = normalizeScreenerMetricComparison(row.emotes)
  if (
    (!streamId && !(state === 'unavailable' && reason)) ||
    measuredAt == null || row.baselineKind !== 'current_stream_measured_average' ||
    !state || reason === null || !currentWindow || !baselineWindow ||
    !evidence || !chat || !emotes
  ) return null
  return {
    version: 1, streamId, measuredAt, baselineKind: 'current_stream_measured_average',
    state, reason, currentWindow, baselineWindow,
    evidence, chat, emotes,
  }
}

function normalizeLegacy(row: Record<string, unknown>): HubChannelScreenerLegacy | null {
  const out: HubChannelScreenerLegacy = {}
  let hasServerField = false
  for (const key of ['chatAcceleration', 'emoteAcceleration', 'viewerChatDivergence'] as const) {
    if (!(key in row)) continue
    const n = finiteNumber(row[key])
    if (n == null) return null
    out[key] = n
    hasServerField = true
  }
  if ('anomalyReason' in row) {
    const reason = normalizeReason(row.anomalyReason)
    if (!reason) return null
    out.anomalyReason = reason
    hasServerField = true
  }
  if ('newlyLive' in row) {
    if (typeof row.newlyLive !== 'boolean') return null
    out.newlyLive = row.newlyLive
    hasServerField = true
  }
  if ('dataFreshnessAt' in row) {
    const at = normalizeReason(row.dataFreshnessAt)
    if (!at) return null
    out.dataFreshnessAt = at
    hasServerField = true
  }
  return hasServerField ? out : null
}

export function normalizeHubChannelScreenerFields(raw: unknown): HubChannelScreenerFields | null {
  const row = record(raw)
  if (!row) return null
  for (const key of REJECT_CLIENT_INVENTED_KEYS) if (key in row) return null
  return row.version === 1 ? normalizeV1(row) : normalizeLegacy(row)
}

export function normalizeHubLiveMomentComparison(raw: unknown): HubLiveMomentComparison | null {
  const row = record(raw)
  if (!row || row.baselineKind !== 'current_stream_measured_average_before_event') return null
  const eventAt = finiteNonNegative(row.eventAt)
  const chat = normalizeScreenerMetricComparison(row.chat)
  const emotes = normalizeScreenerMetricComparison(row.emotes)
  const allowEmptyBaseline = [chat?.state, emotes?.state].every(
    (state) => state === 'warming' || state === 'unavailable',
  )
  const baselineWindow = normalizeWindow(row.baselineWindow, true, allowEmptyBaseline)
  const evidenceRow = record(row.evidence)
  const evidence = evidenceRow && typeof evidenceRow.ircBound === 'boolean' &&
    typeof evidenceRow.eventRollupAvailable === 'boolean'
    ? {
        ircBound: evidenceRow.ircBound,
        eventRollupAvailable: evidenceRow.eventRollupAvailable,
        baselineMeasuredMinutes: finiteNonNegative(evidenceRow.baselineMeasuredMinutes),
        baselineExpectedMinutes: finiteNonNegative(evidenceRow.baselineExpectedMinutes),
        baselineCoveragePct: finiteNonNegative(evidenceRow.baselineCoveragePct),
      }
    : null
  if (
    eventAt == null || !baselineWindow ||
    !chat || !emotes || !evidence ||
    evidence.baselineMeasuredMinutes == null || evidence.baselineExpectedMinutes == null ||
    evidence.baselineCoveragePct == null ||
    evidence.baselineMeasuredMinutes > evidence.baselineExpectedMinutes ||
    evidence.baselineCoveragePct > 100
  ) return null
  return {
    baselineKind: 'current_stream_measured_average_before_event', eventAt,
    baselineWindow,
    chat,
    emotes,
    evidence: evidence as HubLiveMomentEvidence,
  }
}

export function isScreenerV1(
  value: HubChannelScreenerFields | null | undefined,
): value is HubChannelScreenerV1 {
  return value?.version === 1
}

export function screenerViewLabel(view: ChannelScreenerView): string {
  switch (view) {
    case 'overview': return 'Overview'
    case 'momentum': return 'Activity change'
    case 'coverage': return 'Coverage evidence'
    case 'anomalies': return 'Anomalies'
  }
}
