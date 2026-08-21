import type { PulsePayload } from '../shared/messages.ts'

function samePayloadValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!samePayloadValue(a[i], b[i])) return false
    }
    return true
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    // Optional JSON fields omitted by the backend and explicitly set to undefined
    // have the same payload meaning.
    if (left[key] === undefined && right[key] === undefined) continue
    if (!samePayloadValue(left[key], right[key])) return false
  }
  return true
}

function stableValue<T>(previous: T, incoming: T): T {
  return samePayloadValue(previous, incoming) ? previous : incoming
}

function ownField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field)
}

function activationPart(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

/** Full-history data may only cross polls inside one known stream/VOD activation. */
function sameActivation(previous: PulsePayload, incoming: PulsePayload): boolean {
  const loginMatches = activationPart(previous.login).toLowerCase() === activationPart(incoming.login).toLowerCase()
  const streamId = activationPart(previous.streamId)
  const incomingStreamId = activationPart(incoming.streamId)
  const vodId = activationPart(previous.vodId)
  const incomingVodId = activationPart(incoming.vodId)

  return loginMatches
    && streamId === incomingStreamId
    && vodId === incomingVodId
    && Boolean(streamId || vodId)
}

/**
 * Reconcile one server snapshot with the payload already mounted in Twitch.
 *
 * All ordinary payload fields are authoritative on every call. The only retained
 * field is fullRollups when the recent response omits it for the same activation;
 * an explicitly present empty or shorter fullRollups list replaces the old one.
 */
export function mergePulsePayload(previous: PulsePayload | null | undefined, incoming: PulsePayload): PulsePayload {
  if (!previous) return incoming

  const next: PulsePayload = {
    ...incoming,
    rollups: stableValue(previous.rollups, incoming.rollups),
    lanes: stableValue(previous.lanes, incoming.lanes),
  }

  if (ownField(incoming, 'peaks')) {
    next.peaks = stableValue(previous.peaks, incoming.peaks)
  }
  if (ownField(incoming, 'games')) {
    next.games = stableValue(previous.games, incoming.games)
  }
  if (ownField(incoming, 'coverage')) {
    next.coverage = stableValue(previous.coverage, incoming.coverage)
  }
  if (ownField(incoming, 'topEmotes')) {
    next.topEmotes = stableValue(previous.topEmotes, incoming.topEmotes)
  }

  const incomingHasFullRollups = ownField(incoming, 'fullRollups')
  if (incomingHasFullRollups) {
    next.fullRollups = stableValue(previous.fullRollups, incoming.fullRollups)
  } else if (
    sameActivation(previous, incoming)
    && incoming.rollups.length > 0
    && previous.fullRollups !== undefined
  ) {
    next.fullRollups = previous.fullRollups
  }

  return samePayloadValue(previous, next) ? previous : next
}
