import type { PulsePayload } from './messages.ts'

/** Activation-scoped Full chart identity and response validation (R14). */

export type FullHistoryActivation = {
  login: string
  streamId: string
  vodId: string
}

export type FullHistoryRequestFailureReason =
  | 'activation_unavailable'
  | 'activation_changed'
  | 'request_failed'
  | 'missing_payload'
  | 'incomplete_history'

export type FullHistoryRequestResult =
  | { ok: true; payload: PulsePayload }
  | { ok: false; reason: FullHistoryRequestFailureReason }

export function makeFullHistoryActivation(input: {
  login?: string | null
  streamId?: string | number | null
  vodId?: string | null
}): FullHistoryActivation {
  return {
    login: String(input.login ?? '').trim().toLowerCase(),
    streamId: String(input.streamId ?? '').trim(),
    vodId: String(input.vodId ?? '').trim(),
  }
}

export function sameFullHistoryActivation(
  a: FullHistoryActivation | null | undefined,
  b: FullHistoryActivation | null | undefined,
): boolean {
  if (!a || !b) return false
  if (!a.login || a.login !== b.login) return false
  if (a.streamId && b.streamId) return a.streamId === b.streamId
  if (a.vodId && b.vodId) return a.vodId === b.vodId
  return false
}

export function isFullHistoryUnlockedFor(
  unlocked: FullHistoryActivation | null | undefined,
  current: FullHistoryActivation,
): boolean {
  return sameFullHistoryActivation(unlocked, current)
}

/** Stable key for in-flight Full request latching. */
export function fullHistoryActivationKey(activation: FullHistoryActivation): string {
  const identity = activation.streamId
    ? `stream:${activation.streamId}`
    : activation.vodId
      ? `vod:${activation.vodId}`
      : 'pending'
  return `${activation.login}|${identity}`
}

export function hasStableFullHistoryActivation(activation: FullHistoryActivation): boolean {
  return Boolean(activation.login && (activation.streamId || activation.vodId))
}

const FULL_HISTORY_EDGE_TOLERANCE_SECONDS = 120

/**
 * A full response is usable only when it belongs to this activation and spans
 * the backend's proven coverage interval. Missing ranges may remain; they are
 * rendered as gaps rather than making the request look unsuccessful.
 */
export function hasValidatedFullHistory(
  payload: PulsePayload | null | undefined,
  activation?: FullHistoryActivation,
): boolean {
  if (!payload) return false
  if (activation) {
    const responseActivation = makeFullHistoryActivation(payload)
    if (!sameFullHistoryActivation(responseActivation, activation)) return false
  }

  const full = (payload.fullRollups ?? [])
    .filter(rollup => !rollup.missing && Number.isFinite(rollup.offsetSeconds))
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
  if (full.length === 0) return false

  const first = Math.max(0, full[0]!.offsetSeconds)
  const last = Math.max(first, full[full.length - 1]!.offsetSeconds)
  const recentOffsets = payload.rollups
    .filter(rollup => !rollup.missing && Number.isFinite(rollup.offsetSeconds))
    .map(rollup => Math.max(0, rollup.offsetSeconds))
  const provenStart = Math.max(
    0,
    payload.coverageStartOffsetSeconds
      ?? payload.coverage?.coverageStartOffsetSeconds
      ?? Math.min(first, ...recentOffsets),
  )
  const provenEnd = Math.max(
    provenStart,
    payload.coverage?.coverageEndOffsetSeconds
      ?? payload.currentOffsetSeconds
      ?? payload.durationSeconds
      ?? Math.max(last, ...recentOffsets),
  )

  return (
    first <= provenStart + FULL_HISTORY_EDGE_TOLERANCE_SECONDS
    && last + FULL_HISTORY_EDGE_TOLERANCE_SECONDS >= provenEnd
  )
}
