/**
 * Moment comparison and time helpers: pure, dependency-free utilities. (The module keeps
 * the retired Live Wire rail's name; its rail and rail-only helpers are gone, H06.)
 *
 * These functions are deliberately free of React/IO so they can be unit-tested
 * in isolation and reused across the feed filter (in-window/older split, cap)
 * and the incremental poll-identity logic.
 */

/** Resolve a moment's timestamp to millis. Accepts already-ms (>1e12) or seconds.
 *  Returns null for missing, non-finite, zero, or negative values. */
export function resolveMomentAtMs(at?: number): number | null {
  if (at === undefined || at === null) return null
  if (!Number.isFinite(at) || at <= 0) return null
  // Treat anything > 1e12 as already millis (unix-sec values are ~1.7e9).
  return at > 1_000_000_000_000 ? at : at * 1000
}

/** Return a valid machine-readable timestamp without letting malformed rows
 * throw during render. The visible feed can still explain missing time. */
export function formatMomentDateTime(at?: number): string | undefined {
  const ms = resolveMomentAtMs(at)
  if (ms === null) return undefined
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

/**
 * A moment's occurrence for people: the reader's own time zone, named
 * ("Sep 22, 2026, 9:50 AM MST"). Rows used to show UTC, which put an evening
 * moment on the next day's date for anyone west of Greenwich. The page renders
 * on the client only (createRoot, no hydration), so the local zone is safe.
 * `timeZone` exists for tests.
 */
export function formatMomentOccurrence(dateTime: string, timeZone?: string): string {
  return new Date(dateTime).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short', ...(timeZone ? { timeZone } : {}),
  })
}

export type LiveWireComparisonState =
  | 'ready'
  | 'new_activity'
  | 'warming'
  | 'partial'
  | 'unavailable'

export interface LiveWireMetricComparison {
  state: LiveWireComparisonState
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

export interface LiveWireMomentComparison {
  baselineKind: 'current_stream_measured_average_before_event'
  eventAt: number
  baselineWindow: {
    start: number
    end: number
    expectedMinutes: number
    measuredMinutes: number
    coveragePct: number
  }
  chat: LiveWireMetricComparison
  emotes: LiveWireMetricComparison
  evidence: {
    ircBound: boolean
    eventRollupAvailable: boolean
    baselineMeasuredMinutes: number
    baselineExpectedMinutes: number
    baselineCoveragePct: number
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finite(value: unknown): number | null {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : null
}

function nonNegative(value: unknown): number | null {
  const number = finite(value)
  return number != null && number >= 0 ? number : null
}

function optionalNumber(row: Record<string, unknown>, key: string, nonNegativeOnly = false): number | undefined | null {
  if (!(key in row) || row[key] == null) return undefined
  const value = nonNegativeOnly ? nonNegative(row[key]) : finite(row[key])
  return value == null ? null : value
}

function normalizeMetric(raw: unknown): LiveWireMetricComparison | null {
  const row = objectRecord(raw)
  if (!row) return null
  const states = new Set<LiveWireComparisonState>(['ready', 'new_activity', 'warming', 'partial', 'unavailable'])
  const state = typeof row.state === 'string' && states.has(row.state as LiveWireComparisonState)
    ? row.state as LiveWireComparisonState
    : null
  const currentMeasuredMinutes = nonNegative(row.currentMeasuredMinutes)
  const currentExpectedMinutes = nonNegative(row.currentExpectedMinutes)
  const baselineMeasuredMinutes = nonNegative(row.baselineMeasuredMinutes)
  const baselineExpectedMinutes = nonNegative(row.baselineExpectedMinutes)
  const baselineCoveragePct = nonNegative(row.baselineCoveragePct)
  const currentPerMin = optionalNumber(row, 'currentPerMin', true)
  const baselinePerMin = optionalNumber(row, 'baselinePerMin', true)
  const absoluteDeltaPerMin = optionalNumber(row, 'absoluteDeltaPerMin')
  const changePct = optionalNumber(row, 'changePct')
  const multiplier = optionalNumber(row, 'multiplier', true)
  if (
    !state || currentMeasuredMinutes == null || currentExpectedMinutes == null ||
    baselineMeasuredMinutes == null || baselineExpectedMinutes == null || baselineCoveragePct == null ||
    currentMeasuredMinutes > currentExpectedMinutes || baselineMeasuredMinutes > baselineExpectedMinutes ||
    baselineCoveragePct > 100 || currentPerMin === null || baselinePerMin === null ||
    absoluteDeltaPerMin === null || changePct === null || multiplier === null
  ) return null
  const reason = typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : undefined
  return {
    state,
    reason,
    currentPerMin,
    baselinePerMin,
    absoluteDeltaPerMin,
    changePct,
    multiplier,
    currentMeasuredMinutes,
    currentExpectedMinutes,
    baselineMeasuredMinutes,
    baselineExpectedMinutes,
    baselineCoveragePct,
  }
}

/**
 * Fail closed on event-time comparison evidence. Ready/new-activity values are
 * accepted only for the measured event minute and a qualified earlier window
 * from the same stream; malformed or partial payloads remain display-only raw
 * observations and never become a relative claim.
 */
export function normalizeLiveWireMomentComparison(raw: unknown): LiveWireMomentComparison | null {
  const row = objectRecord(raw)
  const baselineWindow = objectRecord(row?.baselineWindow)
  const evidence = objectRecord(row?.evidence)
  if (!row || !baselineWindow || !evidence || row.baselineKind !== 'current_stream_measured_average_before_event') return null
  const eventAt = nonNegative(row.eventAt)
  const start = nonNegative(baselineWindow.start)
  const end = nonNegative(baselineWindow.end)
  const expectedMinutes = nonNegative(baselineWindow.expectedMinutes)
  const measuredMinutes = nonNegative(baselineWindow.measuredMinutes)
  const coveragePct = nonNegative(baselineWindow.coveragePct)
  const baselineMeasuredMinutes = nonNegative(evidence.baselineMeasuredMinutes)
  const baselineExpectedMinutes = nonNegative(evidence.baselineExpectedMinutes)
  const baselineCoveragePct = nonNegative(evidence.baselineCoveragePct)
  const chat = normalizeMetric(row.chat)
  const emotes = normalizeMetric(row.emotes)
  if (
    eventAt == null || start == null || end == null || expectedMinutes == null || measuredMinutes == null ||
    coveragePct == null || baselineMeasuredMinutes == null || baselineExpectedMinutes == null ||
    baselineCoveragePct == null || !chat || !emotes || typeof evidence.ircBound !== 'boolean' ||
    typeof evidence.eventRollupAvailable !== 'boolean' || end < start || measuredMinutes > expectedMinutes ||
    coveragePct > 100 || baselineCoveragePct > 100 || baselineMeasuredMinutes > baselineExpectedMinutes ||
    end - start !== expectedMinutes * 60_000 || end !== Math.floor(eventAt / 60_000) * 60_000 ||
    measuredMinutes !== baselineMeasuredMinutes || expectedMinutes !== baselineExpectedMinutes ||
    coveragePct !== baselineCoveragePct || chat.currentExpectedMinutes !== 1 || emotes.currentExpectedMinutes !== 1 ||
    chat.baselineMeasuredMinutes !== baselineMeasuredMinutes || emotes.baselineMeasuredMinutes !== baselineMeasuredMinutes ||
    chat.baselineExpectedMinutes !== baselineExpectedMinutes || emotes.baselineExpectedMinutes !== baselineExpectedMinutes ||
    chat.baselineCoveragePct !== baselineCoveragePct || emotes.baselineCoveragePct !== baselineCoveragePct
  ) return null
  const expectedEventSamples = evidence.eventRollupAvailable ? 1 : 0
  if (chat.currentMeasuredMinutes !== expectedEventSamples || emotes.currentMeasuredMinutes !== expectedEventSamples) return null
  for (const metric of [chat, emotes]) {
    if (metric.state !== 'ready' && metric.state !== 'new_activity') continue
    if (
      !evidence.ircBound || !evidence.eventRollupAvailable || baselineMeasuredMinutes < 20 ||
      baselineExpectedMinutes < 20 || baselineCoveragePct < 80 || metric.currentPerMin == null ||
      metric.baselinePerMin == null || metric.absoluteDeltaPerMin == null
    ) return null
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt,
    baselineWindow: { start, end, expectedMinutes, measuredMinutes, coveragePct },
    chat,
    emotes,
    evidence: {
      ircBound: evidence.ircBound,
      eventRollupAvailable: evidence.eventRollupAvailable,
      baselineMeasuredMinutes,
      baselineExpectedMinutes,
      baselineCoveragePct,
    },
  }
}

/** Translate an entry direction into the horizontal offset (px) for a slide-in
 *  tween. `right` (rail cards entering from the right edge) → +24, else −24. */
export function buildDirectionalX(from?: 'left' | 'right'): number {
  return from === 'right' ? 24 : -24
}
