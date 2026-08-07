type PendingWait = {
  timer: ReturnType<typeof setTimeout>
  resolve: (active: boolean) => void
}

export interface BackfillPollControl {
  begin: () => number
  cancel: () => void
  isCurrent: (generation: number) => boolean
  wait: (generation: number, delayMs: number) => Promise<boolean>
}

/** Cancels pending backfill delays and invalidates work from an older route. */
export function createBackfillPollControl(): BackfillPollControl {
  let generation = 0
  let pending: PendingWait | null = null

  function cancel(): void {
    generation += 1
    if (!pending) return
    clearTimeout(pending.timer)
    pending.resolve(false)
    pending = null
  }

  return {
    begin() {
      cancel()
      return generation
    },
    cancel,
    isCurrent(token) {
      return token === generation
    },
    wait(token, delayMs) {
      if (token !== generation) return Promise.resolve(false)
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(false)
        pending = null
      }
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          if (pending?.timer === timer) pending = null
          resolve(token === generation)
        }, delayMs)
        pending = { timer, resolve }
      })
    },
  }
}
