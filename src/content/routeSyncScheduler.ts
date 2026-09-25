/**
 * Bounded route-sync scheduler: leading + trailing with a max-wait so continuous
 * MutationObserver churn cannot starve SPA navigation activation forever.
 */

export type RouteSyncScheduler = {
  schedule: () => void
  dispose: () => void
  /** Test helper — force-flush pending work. */
  flush: () => void
}

/**
 * Tracks the pathname observed by the fallback MutationObserver in the content
 * script. Twitch renders chat messages continuously, so the observer must not
 * schedule route work unless the URL actually moved.
 */
export type RoutePathTracker = {
  observe: (pathname: string) => boolean
  mark: (pathname: string) => void
}

export function createRoutePathTracker(initialPathname: string): RoutePathTracker {
  let lastPathname = initialPathname

  return {
    observe(pathname) {
      if (pathname === lastPathname) return false
      lastPathname = pathname
      return true
    },
    mark(pathname) {
      lastPathname = pathname
    },
  }
}

export function createRouteSyncScheduler(
  run: () => void,
  options?: {
    debounceMs?: number
    maxWaitMs?: number
    now?: () => number
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimer?: (id: ReturnType<typeof setTimeout>) => void
  },
): RouteSyncScheduler {
  const debounceMs = options?.debounceMs ?? 350
  const maxWaitMs = options?.maxWaitMs ?? 1_200
  const now = options?.now ?? Date.now
  const setTimer = options?.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options?.clearTimer ?? ((id) => clearTimeout(id))

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  let windowStartedAt: number | null = null
  let disposed = false

  function clearDebounce(): void {
    if (debounceTimer != null) {
      clearTimer(debounceTimer)
      debounceTimer = null
    }
  }

  function clearMaxWait(): void {
    if (maxWaitTimer != null) {
      clearTimer(maxWaitTimer)
      maxWaitTimer = null
    }
  }

  function fire(): void {
    clearDebounce()
    clearMaxWait()
    windowStartedAt = null
    if (!disposed) run()
  }

  return {
    schedule() {
      if (disposed) return
      const t = now()
      if (windowStartedAt == null) {
        windowStartedAt = t
        maxWaitTimer = setTimer(fire, maxWaitMs)
      }
      clearDebounce()
      const elapsed = t - windowStartedAt
      const remainingMax = Math.max(0, maxWaitMs - elapsed)
      const wait = Math.min(debounceMs, remainingMax)
      debounceTimer = setTimer(fire, wait)
    },
    dispose() {
      disposed = true
      clearDebounce()
      clearMaxWait()
      windowStartedAt = null
    },
    flush() {
      if (disposed) return
      fire()
    },
  }
}
