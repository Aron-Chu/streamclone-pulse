/**
 * Backfill / Full-load operation token — activation identity + generation + abort.
 * Obsolete ops must not mutate notice/job/coverage/busy/Full/payload.
 */

import {
  makeFullHistoryActivation,
  sameFullHistoryActivation,
  type FullHistoryActivation,
} from '../shared/fullHistoryAuth.ts'

export type BackfillOperationToken = {
  activation: FullHistoryActivation
  generation: number
  signal: AbortSignal
  /** True while this token is still the current op and not aborted. */
  isCurrent(): boolean
  abort(): void
}

export type BackfillOperationController = {
  /** Invalidate previous ops and mint a token for this activation. */
  begin(activation: FullHistoryActivation): BackfillOperationToken
  /** Invalidate on login/stream/VOD change or unmount. */
  invalidate(): void
  current(): BackfillOperationToken | null
}

export function createBackfillOperationController(): BackfillOperationController {
  let generation = 0
  let current: BackfillOperationToken | null = null
  let controller: AbortController | null = null

  function invalidate(): void {
    generation += 1
    controller?.abort()
    controller = null
    current = null
  }

  return {
    begin(activation: FullHistoryActivation): BackfillOperationToken {
      invalidate()
      const gen = generation
      const ac = new AbortController()
      controller = ac
      const token: BackfillOperationToken = {
        activation,
        generation: gen,
        signal: ac.signal,
        isCurrent() {
          return (
            !ac.signal.aborted
            && gen === generation
            && current === token
            && sameFullHistoryActivation(current.activation, activation)
          )
        },
        abort() {
          ac.abort()
        },
      }
      current = token
      return token
    },
    invalidate,
    current() {
      return current
    },
  }
}

export function activationFromOverlay(input: {
  login: string
  streamId?: string | number | null
  vodId?: string | null
}): FullHistoryActivation {
  return makeFullHistoryActivation(input)
}

/** Abortable delay — rejects/resolves early when signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError'
}
