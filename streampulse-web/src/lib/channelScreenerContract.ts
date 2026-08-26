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

/** Exact event-time evidence emitted by the backend for Live Wire comparisons. */
export interface HubLiveMomentEvidence {
  ircBound: boolean
  eventRollupAvailable: boolean
  baselineMeasuredMinutes: number
  baselineExpectedMinutes: number
  baselineCoveragePct: number
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

const LIVE_MOMENT_MINIMUM_BASELINE_MINUTES = 20
const LIVE_MOMENT_MINIMUM_BASELINE_COVERAGE_PCT = 80

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

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100
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

function normalizeHubLiveMomentEvidence(raw: unknown): HubLiveMomentEvidence | null {
  const row = record(raw)
  if (!row || typeof row.ircBound !== 'boolean' || typeof row.eventRollupAvailable !== 'boolean') return null
  const baselineMeasuredMinutes = finiteNonNegative(row.baselineMeasuredMinutes)
  const baselineExpectedMinutes = finiteNonNegative(row.baselineExpectedMinutes)
  const baselineCoveragePct = finiteNonNegative(row.baselineCoveragePct)
  if (
    baselineMeasuredMinutes == null || baselineExpectedMinutes == null || baselineCoveragePct == null ||
    baselineMeasuredMinutes > baselineExpectedMinutes || baselineCoveragePct > 100
  ) return null
  return {
    ircBound: row.ircBound,
    eventRollupAvailable: row.eventRollupAvailable,
    baselineMeasuredMinutes,
    baselineExpectedMinutes,
    baselineCoveragePct,
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
  const currentWindow = normalizeWindow(row.currentWindow, true)
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
  const screener: HubChannelScreenerV1 = {
    version: 1, streamId, measuredAt, baselineKind: 'current_stream_measured_average',
    state, reason, currentWindow, baselineWindow,
    evidence, chat, emotes,
  }
  return screenerEvidenceIsCoherent(screener) ? screener : null
}

function coherentWindow(window: ScreenerWindow, allowEmpty: boolean): boolean {
  if (!Number.isInteger(window.start) || !Number.isInteger(window.end) ||
      !Number.isInteger(window.expectedMinutes) || !Number.isInteger(window.measuredMinutes) ||
      window.start % 60_000 !== 0 || window.end % 60_000 !== 0 ||
      window.end < window.start || window.measuredMinutes < 0 ||
      window.measuredMinutes > window.expectedMinutes) return false
  const empty = window.expectedMinutes === 0 && window.measuredMinutes === 0 && window.start === window.end
  if (empty) return allowEmpty && (window.coveragePct == null || window.coveragePct === 0)
  if (window.expectedMinutes <= 0 || window.coveragePct == null) return false
  return (
    window.end - window.start === window.expectedMinutes * 60_000 &&
    window.coveragePct === roundMetric(window.measuredMinutes / window.expectedMinutes * 100)
  )
}

function coherentMetric(
  metric: ScreenerMetricComparison,
  state: ScreenerMetricState,
  currentWindow: ScreenerWindow,
  baselineWindow: ScreenerWindow,
): boolean {
  if (
    metric.currentMeasuredMinutes !== currentWindow.measuredMinutes ||
    metric.currentExpectedMinutes !== currentWindow.expectedMinutes ||
    metric.baselineMeasuredMinutes !== baselineWindow.measuredMinutes ||
    metric.baselineExpectedMinutes !== baselineWindow.expectedMinutes ||
    metric.baselineCoveragePct !== (baselineWindow.coveragePct ?? 0)
  ) return false
  if (state !== 'ready' && state !== 'new_activity') return true
  if (metric.currentPerMin == null || metric.baselinePerMin == null || metric.absoluteDeltaPerMin == null) return false
  if (metric.currentPerMin < 0 || metric.baselinePerMin < 0) return false
  if (metric.absoluteDeltaPerMin !== roundMetric(metric.currentPerMin - metric.baselinePerMin)) return false
  if (metric.baselinePerMin > 0) {
    return (
      metric.changePct != null && metric.multiplier != null &&
      metric.changePct === roundMetric(metric.absoluteDeltaPerMin / metric.baselinePerMin * 100) &&
      metric.multiplier === roundMetric(metric.currentPerMin / metric.baselinePerMin)
    )
  }
  if (metric.changePct != null || metric.multiplier != null) return false
  return metric.currentPerMin === 0 || (state === 'new_activity' && metric.currentPerMin > 0)
}

/**
 * Validate a backend-ranked Rising Channels comparison without inventing the
 * omitted window timestamps. Qualified rows still carry the exact measured and
 * expected minute counts, so the same v1 thresholds and arithmetic can fail
 * closed at the public wire boundary.
 */
export function qualifiedScreenerMetricEvidenceIsCoherent(
  metric: ScreenerMetricComparison,
  evidence: ScreenerEvidence,
): boolean {
  const currentWindow: ScreenerWindow = {
    start: 0,
    end: metric.currentExpectedMinutes * 60_000,
    expectedMinutes: metric.currentExpectedMinutes,
    measuredMinutes: metric.currentMeasuredMinutes,
    coveragePct: roundMetric(metric.currentMeasuredMinutes / metric.currentExpectedMinutes * 100),
  }
  const baselineWindow: ScreenerWindow = {
    start: 0,
    end: metric.baselineExpectedMinutes * 60_000,
    expectedMinutes: metric.baselineExpectedMinutes,
    measuredMinutes: metric.baselineMeasuredMinutes,
    coveragePct: metric.baselineCoveragePct,
  }
  if (
    !evidence.ircBound || !evidence.rollupAvailable ||
    metric.currentExpectedMinutes !== 5 || metric.currentMeasuredMinutes !== 5 ||
    metric.baselineExpectedMinutes < 20 || metric.baselineMeasuredMinutes < 20 ||
    metric.baselineCoveragePct < 80 ||
    !coherentWindow(currentWindow, false) ||
    !coherentWindow(baselineWindow, false) ||
    !coherentMetric(metric, metric.state, currentWindow, baselineWindow)
  ) return false

  if (metric.state === 'new_activity') {
    return (
      metric.reason === 'baseline_zero' && metric.baselinePerMin === 0 &&
      (metric.currentPerMin ?? 0) > 0 && metric.changePct == null && metric.multiplier == null
    )
  }
  return (
    metric.state === 'ready' && !metric.reason &&
    !(metric.baselinePerMin === 0 && (metric.currentPerMin ?? 0) > 0)
  )
}

/**
 * Reject internally contradictory v1 rows before the advanced views consume
 * them. This mirrors the backend qualification thresholds and prevents a
 * malformed payload from relabelling partial evidence as ready.
 */
export function screenerEvidenceIsCoherent(screener: HubChannelScreenerV1): boolean {
  const { state, reason, currentWindow, baselineWindow, evidence, chat, emotes } = screener
  const currentEnd = currentWindow.end
  const baselineIsEmpty = baselineWindow.expectedMinutes === 0 && baselineWindow.measuredMinutes === 0
  if (
    screener.measuredAt < currentEnd || screener.measuredAt >= currentEnd + 60_000 ||
    currentWindow.expectedMinutes !== 5 ||
    !coherentWindow(currentWindow, false) ||
    !coherentWindow(baselineWindow, state === 'warming' || state === 'unavailable') ||
    (!baselineIsEmpty && baselineWindow.end !== currentWindow.start) ||
    (baselineIsEmpty && state !== 'warming' && state !== 'unavailable')
  ) return false

  const observedMinutes = currentWindow.measuredMinutes + baselineWindow.measuredMinutes
  if (evidence.rollupAvailable !== (observedMinutes > 0)) return false
  const chatObserved = chat.currentMeasuredMinutes > 0 && (chat.currentPerMin ?? 0) > 0
  if (evidence.chatObservedLast5m !== chatObserved) return false

  const countsAreQualified = (
    currentWindow.measuredMinutes === currentWindow.expectedMinutes &&
    baselineWindow.measuredMinutes >= 20 &&
    baselineWindow.expectedMinutes >= 20 &&
    (baselineWindow.coveragePct ?? 0) >= 80
  )
  const metricsMatch = coherentMetric(chat, chat.state, currentWindow, baselineWindow) &&
    coherentMetric(emotes, emotes.state, currentWindow, baselineWindow)

  if (state === 'ready' || state === 'new_activity') {
    if (!evidence.ircBound || !evidence.rollupAvailable || !countsAreQualified || !metricsMatch) return false
    if (reason) return false
    const qualifiedStates = (metric: ScreenerMetricComparison) =>
      metric.state === 'ready' || metric.state === 'new_activity'
    if (!qualifiedStates(chat) || !qualifiedStates(emotes)) return false
    if (state === 'ready') {
      return chat.state === 'ready' && emotes.state === 'ready' && !chat.reason && !emotes.reason
    }
    const newMetrics = [chat, emotes].filter((metric) => metric.state === 'new_activity')
    return newMetrics.length > 0 && newMetrics.every((metric) =>
      metric.reason === 'baseline_zero' && metric.baselinePerMin === 0 && (metric.currentPerMin ?? 0) > 0,
    ) && [chat, emotes].filter((metric) => metric.state === 'ready').every((metric) => !metric.reason)
  }

  if (!reason || chat.state !== state || emotes.state !== state || !metricsMatch) return false
  if (state === 'unavailable') return !evidence.ircBound || !evidence.rollupAvailable
  if (!evidence.ircBound || !evidence.rollupAvailable) return false
  if (state === 'warming') return baselineWindow.expectedMinutes < 20 || currentWindow.measuredMinutes < 5
  if (state === 'partial') return !countsAreQualified
  return false
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

function liveMomentEvidenceIsCoherent(
  eventAt: number,
  baselineWindow: ScreenerWindow,
  chat: ScreenerMetricComparison,
  emotes: ScreenerMetricComparison,
  evidence: HubLiveMomentEvidence,
): boolean {
  const expectedCurrentMeasured = evidence.eventRollupAvailable ? 1 : 0
  const expectedCoveragePct = evidence.baselineExpectedMinutes > 0
    ? Math.round((evidence.baselineMeasuredMinutes / evidence.baselineExpectedMinutes) * 10_000) / 100
    : 0
  const baselineRollupAvailable = evidence.baselineMeasuredMinutes > 0
  const anyRollupAvailable = evidence.eventRollupAvailable || baselineRollupAvailable
  const baselineMatches = (comparison: ScreenerMetricComparison) =>
    comparison.baselineMeasuredMinutes === evidence.baselineMeasuredMinutes &&
    comparison.baselineExpectedMinutes === evidence.baselineExpectedMinutes &&
    comparison.baselineCoveragePct === evidence.baselineCoveragePct
  const measuredCountsAreIntegers = (comparison: ScreenerMetricComparison) =>
    Number.isInteger(comparison.currentMeasuredMinutes) &&
    Number.isInteger(comparison.currentExpectedMinutes) &&
    Number.isInteger(comparison.baselineMeasuredMinutes) &&
    Number.isInteger(comparison.baselineExpectedMinutes)
  const evidenceState = (() => {
    if (!evidence.ircBound || !anyRollupAvailable) return 'unavailable' as const
    if (evidence.baselineExpectedMinutes < LIVE_MOMENT_MINIMUM_BASELINE_MINUTES) {
      return 'warming' as const
    }
    if (!evidence.eventRollupAvailable) return 'partial' as const
    if (
      evidence.baselineMeasuredMinutes < LIVE_MOMENT_MINIMUM_BASELINE_MINUTES ||
      evidence.baselineCoveragePct < LIVE_MOMENT_MINIMUM_BASELINE_COVERAGE_PCT
    ) return 'partial' as const
    return 'qualified' as const
  })()
  const metricStateMatches = (comparison: ScreenerMetricComparison) => {
    if (evidenceState === 'qualified') {
      if (comparison.state !== 'ready' && comparison.state !== 'new_activity') return false
      if (
        comparison.currentPerMin == null || comparison.baselinePerMin == null ||
        comparison.absoluteDeltaPerMin == null
      ) return false
      if (comparison.state === 'new_activity') {
        return Boolean(comparison.reason) && comparison.baselinePerMin === 0 && comparison.currentPerMin > 0
      }
      return !comparison.reason && !(comparison.baselinePerMin === 0 && comparison.currentPerMin > 0)
    }
    return comparison.state === evidenceState && Boolean(comparison.reason)
  }
  return (
    baselineWindow.coveragePct != null &&
    Number.isInteger(baselineWindow.expectedMinutes) &&
    Number.isInteger(baselineWindow.measuredMinutes) &&
    Number.isInteger(evidence.baselineExpectedMinutes) &&
    Number.isInteger(evidence.baselineMeasuredMinutes) &&
    baselineWindow.end - baselineWindow.start === baselineWindow.expectedMinutes * 60_000 &&
    Math.floor(eventAt / 60_000) * 60_000 === baselineWindow.end &&
    baselineWindow.measuredMinutes === evidence.baselineMeasuredMinutes &&
    baselineWindow.expectedMinutes === evidence.baselineExpectedMinutes &&
    baselineWindow.coveragePct === evidence.baselineCoveragePct &&
    evidence.baselineCoveragePct === expectedCoveragePct &&
    baselineMatches(chat) &&
    baselineMatches(emotes) &&
    measuredCountsAreIntegers(chat) &&
    measuredCountsAreIntegers(emotes) &&
    chat.currentExpectedMinutes === 1 &&
    emotes.currentExpectedMinutes === 1 &&
    chat.currentMeasuredMinutes === expectedCurrentMeasured &&
    emotes.currentMeasuredMinutes === expectedCurrentMeasured &&
    (!evidence.ircBound
      ? !evidence.eventRollupAvailable && evidence.baselineMeasuredMinutes === 0
      : true) &&
    metricStateMatches(chat) &&
    metricStateMatches(emotes)
  )
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
  const evidence = normalizeHubLiveMomentEvidence(row.evidence)
  if (
    eventAt == null || !baselineWindow ||
    !chat || !emotes || !evidence ||
    !liveMomentEvidenceIsCoherent(eventAt, baselineWindow, chat, emotes, evidence)
  ) return null
  return {
    baselineKind: 'current_stream_measured_average_before_event', eventAt,
    baselineWindow,
    chat,
    emotes,
    evidence,
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
