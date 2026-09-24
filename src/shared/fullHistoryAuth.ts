import type { PulsePayload } from './messages.ts'

/** Activation-scoped Full chart identity and response validation (R14). */

export type FullHistoryActivation = {
  login: string
  streamId: string
  vodId: string
  /** Stream/VOD start epoch; protects against reused or corrected stream IDs. */
  startedAt?: string
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
  startedAt?: string | null
}): FullHistoryActivation {
  return {
    login: String(input.login ?? '').trim().toLowerCase(),
    streamId: String(input.streamId ?? '').trim(),
    vodId: String(input.vodId ?? '').trim(),
    startedAt: normalizeStartedAt(input.startedAt),
  }
}

function normalizeStartedAt(value: string | null | undefined): string | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw
}

export function sameFullHistoryActivation(
  a: FullHistoryActivation | null | undefined,
  b: FullHistoryActivation | null | undefined,
): boolean {
  if (!a || !b) return false
  if (!a.login || a.login !== b.login) return false
  const samePrimaryIdentity = a.streamId && b.streamId
    ? a.streamId === b.streamId
    : a.vodId && b.vodId
      ? a.vodId === b.vodId
      : false
  if (!samePrimaryIdentity) return false
  // Older payloads may omit startedAt. When both sides provide it, it is part
  // of the identity so a reused/corrected stream ID cannot retain old Full.
  return !a.startedAt || !b.startedAt || a.startedAt === b.startedAt
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
  return `${activation.login}|${identity}${activation.startedAt ? `|start:${activation.startedAt}` : ''}`
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
