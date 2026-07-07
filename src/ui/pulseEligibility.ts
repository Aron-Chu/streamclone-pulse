import type { PulsePayload } from '../shared/messages.ts'

/** Hosted Pulse is limited to the backend top-500 roster. Missing field = legacy/local backend. */
export function isPulseTop500Supported(payload: PulsePayload | null | undefined): boolean {
  if (!payload) return true
  return payload.top500Eligible !== false
}
