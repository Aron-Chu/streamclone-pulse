/**
 * Activation-scoped Full chart authorization (RPR-1 / R14.5).
 * Stored Full preference is remembered, but unlock is per login+stream/VOD.
 */

export type FullHistoryActivation = {
  login: string
  streamId: string
  vodId: string
}

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
  return a.login === b.login && a.streamId === b.streamId && a.vodId === b.vodId
}

export function isFullHistoryUnlockedFor(
  unlocked: FullHistoryActivation | null | undefined,
  current: FullHistoryActivation,
): boolean {
  return sameFullHistoryActivation(unlocked, current)
}

/** Stable key for in-flight Full request latching. */
export function fullHistoryActivationKey(activation: FullHistoryActivation): string {
  return `${activation.login}|${activation.streamId || '-'}|${activation.vodId || '-'}`
}
