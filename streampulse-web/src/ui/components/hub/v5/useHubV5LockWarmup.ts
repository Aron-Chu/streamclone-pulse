/**
 * The locks' warm-up on the hub page (L1, hub rail board 2026-11-02): a bar the
 * pointer rests on is read at once, and 2 s after the chart has points the
 * page reads the busiest bars and the top emotes' spike bars, one at a time
 * (hubLockWarmup). Once per window a visit; never with Save-Data on or while
 * the tab is hidden.
 */
import { useEffect, useRef } from 'react'
import { prefetchHubIntervalMoments } from '../../../../lib/hubIntervalMoments'
import { onHubBarRest, warmHubBuckets } from '../../../../lib/hubLockWarmup'
import type { HubApiWindow } from '../../../../lib/hubWindows'
import type { HubActivityPoint } from '../../../../lib/publicHub'
import { lockWarmBar, lockWarmTargets } from './hubV5LockWarmModel'

/** How long after the chart has points the warm-up starts. */
export const HUB_WARM_SETTLE_MS = 2000

const saveData = () => typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)

export function useHubV5LockWarmup({ points, bucketMinutes, intervalWindow, ready }: {
  points: readonly HubActivityPoint[]
  /** The server bucket the locks read on. */
  bucketMinutes: number
  /** The hub/moments window; without one the locks list nothing. */
  intervalWindow?: HubApiWindow
  /** The answer on screen is in (not waiting, not a saved copy). */
  ready: boolean
}): void {
  // a poll brings new points without restarting a warm-up under way
  const pointsRef = useRef(points)
  pointsRef.current = points
  const done = useRef(new Set<string>())

  useEffect(() => {
    if (!intervalWindow) return undefined
    return onHubBarRest(({ t, endT }) => {
      if (!saveData() && lockWarmBar(pointsRef.current, t, endT)) prefetchHubIntervalMoments({ t, endT, activityWindow: intervalWindow, bucketMinutes })
    })
  }, [intervalWindow, bucketMinutes])

  const hasPoints = points.length > 0
  useEffect(() => {
    const key = `${intervalWindow}|${bucketMinutes}`
    if (!ready || !hasPoints || !intervalWindow || done.current.has(key) || saveData()) return undefined
    const abort = new AbortController()
    const start = () => {
      if (document.hidden || abort.signal.aborted) return
      document.removeEventListener('visibilitychange', start)
      done.current.add(key)
      void warmHubBuckets(lockWarmTargets(pointsRef.current, bucketMinutes), intervalWindow, bucketMinutes, abort.signal)
    }
    // a hidden tab waits until it is shown
    const id = window.setTimeout(() => {
      if (document.hidden) document.addEventListener('visibilitychange', start)
      else start()
    }, HUB_WARM_SETTLE_MS)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('visibilitychange', start)
      abort.abort()
    }
  }, [ready, hasPoints, intervalWindow, bucketMinutes])
}
