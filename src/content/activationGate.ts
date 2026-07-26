/**
 * Production activation generation gate used by content entry.
 * Stale async completions must no-op after login/stream/VOD/deactivate.
 */

export type ActivationGate = {
  /** Begin a new activation; returns the generation for this attempt. */
  begin(): number
  /** True while this generation is still the latest and not cancelled. */
  isCurrent(generation: number): boolean
  /** Invalidate all in-flight activations (deactivate / replace). */
  cancel(): void
  /** Current generation (for tests / diagnostics). */
  current(): number
}

export function createActivationGate(initial = 0): ActivationGate {
  let generation = initial
  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(g: number) {
      return g === generation
    },
    cancel() {
      generation += 1
    },
    current() {
      return generation
    },
  }
}

/**
 * After an await on the same-channel fast path, confirm the session is still
 * the intended channel activation before applying side effects (livePoll, etc.).
 */
export function isSameChannelActivationCurrent(args: {
  generation: number
  gateCurrent: number
  activeSession: { kind: string; login?: string } | null
  intendedLogin: string
}): boolean {
  if (args.generation !== args.gateCurrent) return false
  if (args.activeSession?.kind !== 'channel') return false
  if (args.activeSession.login !== args.intendedLogin) return false
  return true
}

/**
 * After a VOD fetch await, confirm the session still matches before applying.
 */
export function isVodActivationCurrent(args: {
  generation: number
  gateCurrent: number
  activeSession: { kind: string; vodId?: string } | null
  intendedVodId: string
}): boolean {
  if (args.generation !== args.gateCurrent) return false
  if (args.activeSession?.kind !== 'vod') return false
  if (args.activeSession.vodId !== args.intendedVodId) return false
  return true
}
