export interface BoundedScheduler {
  schedule: () => void
  cancel: () => void
}

/** Coalesce bursts without moving the already scheduled deadline. */
export function createBoundedScheduler(
  callback: () => void,
  delayMs: number,
): BoundedScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    schedule() {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        callback()
      }, delayMs)
    },
    cancel() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
  }
}
