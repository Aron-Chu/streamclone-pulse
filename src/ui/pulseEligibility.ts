import type { PulsePayload } from '../shared/messages.ts'

function rosterEligibleFromPayload(payload: PulsePayload): boolean {
  if (payload.rosterEligible !== undefined) {
    return payload.rosterEligible !== false
  }
  return payload.top500Eligible !== false
}

/** Hosted Pulse is limited to the backend Pulse roster / cap tier. Missing field = legacy/local backend. */
export function isPulseRosterEligible(payload: PulsePayload | null | undefined): boolean {
  if (!payload) return true
  return rosterEligibleFromPayload(payload)
}

/** @deprecated Use isPulseRosterEligible */
export const isPulseTop500Supported = isPulseRosterEligible
