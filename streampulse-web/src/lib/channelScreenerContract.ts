/**
 * Channel Screener view contract (P2).
 * Acceleration / divergence / anomaly reason require backend-owned fields.
 * Never invent these from client poll history or local scoring.
 */

export type ChannelScreenerView = 'overview' | 'momentum' | 'coverage' | 'anomalies'

export interface HubChannelScreenerFields {
  chatAcceleration?: number
  emoteAcceleration?: number
  viewerChatDivergence?: number
  anomalyReason?: string
  newlyLive?: boolean
  dataFreshnessAt?: string
}

/** Client-invented keys that must never appear on a server screener payload. */
const REJECT_CLIENT_INVENTED_KEYS = [
  'pulseScore',
  'clientScore',
  'localAcceleration',
  'derivedAnomaly',
  'computedMomentum',
] as const

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalize backend-owned screener fields. Returns null for hostile/malformed
 * payloads (wrong types, client-invented scoring keys, or empty objects).
 */
export function normalizeHubChannelScreenerFields(
  raw: unknown,
): HubChannelScreenerFields | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>

  for (const key of REJECT_CLIENT_INVENTED_KEYS) {
    if (key in row) return null
  }

  const out: HubChannelScreenerFields = {}
  let hasServerField = false

  if ('chatAcceleration' in row) {
    const n = finiteNumber(row.chatAcceleration)
    if (n == null) return null
    out.chatAcceleration = n
    hasServerField = true
  }
  if ('emoteAcceleration' in row) {
    const n = finiteNumber(row.emoteAcceleration)
    if (n == null) return null
    out.emoteAcceleration = n
    hasServerField = true
  }
  if ('viewerChatDivergence' in row) {
    const n = finiteNumber(row.viewerChatDivergence)
    if (n == null) return null
    out.viewerChatDivergence = n
    hasServerField = true
  }
  if ('anomalyReason' in row) {
    if (typeof row.anomalyReason !== 'string') return null
    const reason = row.anomalyReason.trim()
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
    if (typeof row.dataFreshnessAt !== 'string') return null
    const at = row.dataFreshnessAt.trim()
    if (!at) return null
    out.dataFreshnessAt = at
    hasServerField = true
  }

  return hasServerField ? out : null
}

export function screenerViewLabel(view: ChannelScreenerView): string {
  switch (view) {
    case 'overview':
      return 'Overview'
    case 'momentum':
      return 'Momentum'
    case 'coverage':
      return 'Coverage'
    case 'anomalies':
      return 'Anomalies'
  }
}

/* ---------------------------------------------------------------------------
 * Screener v1 (backend `liveChannels[].screener`, version 1).
 *
 * The backend compares the last measured minutes of a stream with that same
 * stream's measured average so far and supplies the multiplier itself. The
 * portal never computes a multiplier, never fills a missing one, and shows
 * "× usual" only through the gates below (plan §1.5, H6, Q4).
 * ------------------------------------------------------------------------- */

export type HubScreenerState = 'ready' | 'warming' | 'partial' | 'unavailable'

export type HubScreenerMetricKey = 'chat' | 'emotes'

export interface HubScreenerWindow {
  start: number
  end: number
  expectedMinutes: number
  measuredMinutes: number
  coveragePct: number
}

export interface HubScreenerEvidence {
  ircBound?: boolean
  chatObservedLast5m?: boolean
  rollupAvailable?: boolean
  metadataAgeSeconds?: number
}

export interface HubScreenerMetric {
  /** Backend metric state; an unknown string is kept but never counts as ready. */
  state: HubScreenerState | string
  reason?: string
  /** Backend "now" rate for the current window (per minute). */
  currentPerMin: number
  baselinePerMin: number | null
  absoluteDeltaPerMin: number | null
  changePct: number | null
  /** Backend multiplier. Null when the backend did not supply one; never derived here. */
  multiplier: number | null
  currentMeasuredMinutes: number | null
  currentExpectedMinutes: number | null
  baselineMeasuredMinutes: number | null
  baselineExpectedMinutes: number | null
  baselineCoveragePct: number | null
}

export interface HubChannelScreenerV1 {
  version: 1
  streamId?: string
  measuredAt: number | null
  baselineKind: 'current_stream_measured_average'
  state: HubScreenerState | string
  reason?: string
  currentWindow: HubScreenerWindow | null
  baselineWindow: HubScreenerWindow | null
  /**
   * Measured minutes behind the baseline: `baselineWindow.measuredMinutes`,
   * kept on its own so a slim cached copy can drop the window and keep N.
   */
  baselineMeasuredMinutes: number | null
  evidence: HubScreenerEvidence | null
  chat: HubScreenerMetric | null
  emotes: HubScreenerMetric | null
}

/** "× usual" is shown only when the metric's backend "now" is at least this (per minute). */
export const HUB_SCREENER_SHOW_FLOOR_PER_MIN = 5
/** A channel counts toward "2× usual or more" only when "now" is at least this (per minute). */
export const HUB_SCREENER_COUNT_FLOOR_PER_MIN = 50
/** The multiplier a channel needs to count toward "2× usual or more". */
export const HUB_SCREENER_COUNT_MULTIPLIER = 2

const SCREENER_V1_BASELINE_KIND = 'current_stream_measured_average'

function strictFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** null when absent, undefined when present but malformed. */
function optionalFinite(row: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in row) || row[key] == null) return null
  const n = strictFinite(row[key])
  return n == null ? undefined : n
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function hasInventedKey(row: Record<string, unknown>): boolean {
  return REJECT_CLIENT_INVENTED_KEYS.some((key) => key in row)
}

function trimmedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text : undefined
}

function normalizeScreenerWindow(raw: unknown): HubScreenerWindow | null | undefined {
  if (raw == null) return null
  const row = plainRecord(raw)
  if (!row) return undefined
  const start = strictFinite(row.start)
  const end = strictFinite(row.end)
  const expectedMinutes = strictFinite(row.expectedMinutes)
  const measuredMinutes = strictFinite(row.measuredMinutes)
  const coveragePct = strictFinite(row.coveragePct)
  if (
    start == null || end == null || expectedMinutes == null || measuredMinutes == null ||
    coveragePct == null || end < start || expectedMinutes < 0 || measuredMinutes < 0 ||
    coveragePct < 0 || coveragePct > 100
  ) {
    return undefined
  }
  return { start, end, expectedMinutes, measuredMinutes, coveragePct }
}

function normalizeScreenerEvidence(raw: unknown): HubScreenerEvidence | null {
  const row = plainRecord(raw)
  if (!row) return null
  const out: HubScreenerEvidence = {}
  for (const key of ['ircBound', 'chatObservedLast5m', 'rollupAvailable'] as const) {
    const value = row[key]
    if (typeof value === 'boolean') out[key] = value
  }
  const age = strictFinite(row.metadataAgeSeconds)
  if (age != null && age >= 0) out.metadataAgeSeconds = age
  return out
}

const SCREENER_METRIC_NUMBERS = [
  'baselinePerMin',
  'absoluteDeltaPerMin',
  'changePct',
  'multiplier',
  'currentMeasuredMinutes',
  'currentExpectedMinutes',
  'baselineMeasuredMinutes',
  'baselineExpectedMinutes',
  'baselineCoveragePct',
] as const

function normalizeScreenerMetric(raw: unknown): HubScreenerMetric | null | undefined {
  if (raw == null) return null
  const row = plainRecord(raw)
  if (!row || hasInventedKey(row)) return undefined
  const state = trimmedText(row.state)
  const currentPerMin = strictFinite(row.currentPerMin)
  if (!state || currentPerMin == null || currentPerMin < 0) return undefined
  const values: Partial<Record<(typeof SCREENER_METRIC_NUMBERS)[number], number | null>> = {}
  for (const key of SCREENER_METRIC_NUMBERS) {
    const value = optionalFinite(row, key)
    if (value === undefined) return undefined
    values[key] = value
  }
  // A multiplier is a ratio of two non-negative rates; anything else is malformed.
  if (values.multiplier != null && values.multiplier < 0) return undefined
  const metric: HubScreenerMetric = {
    state,
    currentPerMin,
    baselinePerMin: values.baselinePerMin ?? null,
    absoluteDeltaPerMin: values.absoluteDeltaPerMin ?? null,
    changePct: values.changePct ?? null,
    multiplier: values.multiplier ?? null,
    currentMeasuredMinutes: values.currentMeasuredMinutes ?? null,
    currentExpectedMinutes: values.currentExpectedMinutes ?? null,
    baselineMeasuredMinutes: values.baselineMeasuredMinutes ?? null,
    baselineExpectedMinutes: values.baselineExpectedMinutes ?? null,
    baselineCoveragePct: values.baselineCoveragePct ?? null,
  }
  const reason = trimmedText(row.reason)
  if (reason) metric.reason = reason
  return metric
}

/**
 * Normalize a backend screener v1 payload. Returns null for anything that is
 * not a well-formed v1 payload (other versions, a different baseline kind,
 * wrong types, client-invented scoring keys). Values are copied, never derived.
 */
export function normalizeHubChannelScreenerV1(raw: unknown): HubChannelScreenerV1 | null {
  const row = plainRecord(raw)
  if (!row || hasInventedKey(row)) return null
  if (row.version !== 1) return null
  if (row.baselineKind !== SCREENER_V1_BASELINE_KIND) return null
  const state = trimmedText(row.state)
  if (!state) return null
  const currentWindow = normalizeScreenerWindow(row.currentWindow)
  const baselineWindow = normalizeScreenerWindow(row.baselineWindow)
  const chat = normalizeScreenerMetric(row.chat)
  const emotes = normalizeScreenerMetric(row.emotes)
  if (currentWindow === undefined || baselineWindow === undefined || chat === undefined || emotes === undefined) {
    return null
  }
  const measuredAt = strictFinite(row.measuredAt)
  const flatBaselineMinutes = strictFinite(row.baselineMeasuredMinutes)
  const out: HubChannelScreenerV1 = {
    version: 1,
    measuredAt: measuredAt != null && measuredAt >= 0 ? measuredAt : null,
    baselineKind: SCREENER_V1_BASELINE_KIND,
    state,
    currentWindow,
    baselineWindow,
    baselineMeasuredMinutes:
      baselineWindow?.measuredMinutes ??
      (flatBaselineMinutes != null && flatBaselineMinutes >= 0 ? flatBaselineMinutes : null),
    evidence: normalizeScreenerEvidence(row.evidence),
    chat,
    emotes,
  }
  const streamId = trimmedText(row.streamId)
  if (streamId) out.streamId = streamId
  const reason = trimmedText(row.reason)
  if (reason) out.reason = reason
  return out
}

/**
 * The backend multiplier for one metric, or null when "× usual" must show "—":
 * the comparison is not ready, the metric is not ready, "now" is under
 * HUB_SCREENER_SHOW_FLOOR_PER_MIN, or the backend gave no multiplier.
 */
export function screenerMetricMultiplier(
  screener: HubChannelScreenerV1 | null | undefined,
  metric: HubScreenerMetricKey,
): number | null {
  if (!screener || screener.state !== 'ready') return null
  const m = screener[metric]
  if (!m || m.state !== 'ready') return null
  if (m.currentPerMin < HUB_SCREENER_SHOW_FLOOR_PER_MIN) return null
  return m.multiplier != null && Number.isFinite(m.multiplier) ? m.multiplier : null
}

export interface HubScreenerUsual {
  metric: HubScreenerMetricKey
  multiplier: number
  /** Backend "now" for that metric (per minute). */
  currentPerMin: number
}

/** The larger of the gated chat / emotes multipliers (Busiest now), or null. */
export function screenerUsual(screener: HubChannelScreenerV1 | null | undefined): HubScreenerUsual | null {
  if (!screener) return null
  let best: HubScreenerUsual | null = null
  for (const metric of ['chat', 'emotes'] as const) {
    const multiplier = screenerMetricMultiplier(screener, metric)
    const m = screener[metric]
    if (multiplier == null || !m) continue
    if (!best || multiplier > best.multiplier) best = { metric, multiplier, currentPerMin: m.currentPerMin }
  }
  return best
}

/** True when the channel counts toward "N channels at 2× usual or more" (H6 floors). */
export function isScreenerAtTwoTimesUsual(screener: HubChannelScreenerV1 | null | undefined): boolean {
  if (!screener) return false
  for (const metric of ['chat', 'emotes'] as const) {
    const multiplier = screenerMetricMultiplier(screener, metric)
    const m = screener[metric]
    if (
      multiplier != null && m &&
      multiplier >= HUB_SCREENER_COUNT_MULTIPLIER &&
      m.currentPerMin >= HUB_SCREENER_COUNT_FLOOR_PER_MIN
    ) {
      return true
    }
  }
  return false
}

/** Measured minutes behind the screener baseline (the Q4 tooltip's N), or null. */
export function screenerBaselineMinutes(screener: HubChannelScreenerV1 | null | undefined): number | null {
  const minutes = screener?.baselineMeasuredMinutes ?? screener?.baselineWindow?.measuredMinutes
  return minutes != null && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null
}

/** The §1.8 "× usual" tooltip, or null when the baseline minutes are unknown. */
export function screenerUsualTooltip(screener: HubChannelScreenerV1 | null | undefined): string | null {
  const minutes = screenerBaselineMinutes(screener)
  if (minutes == null) return null
  return `Now vs this channel's average over the last ${minutes} measured minute${minutes === 1 ? '' : 's'}`
}

/** "1.7×", or "10×+" at 10 or above (mockup `mult`). Formatting only; the value comes from the backend. */
export function formatScreenerMultiplier(multiplier: number): string {
  if (multiplier >= 10) return '10×+'
  return `${(Math.round(multiplier * 10) / 10).toFixed(1)}×`
}
