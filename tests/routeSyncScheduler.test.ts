import { describe, expect, it, vi } from 'vitest'
import {
  createRoutePathTracker,
  createRouteSyncScheduler,
} from '../src/content/routeSyncScheduler.ts'

describe('createRoutePathTracker', () => {
  it('reports a pathname change once and ignores mutation churn afterward', () => {
    const tracker = createRoutePathTracker('/xqc')

    expect(tracker.observe('/xqc')).toBe(false)
    expect(tracker.observe('/xqc')).toBe(false)
    expect(tracker.observe('/following')).toBe(true)
    expect(tracker.observe('/following')).toBe(false)
    expect(tracker.observe('/search')).toBe(true)
    expect(tracker.observe('/search')).toBe(false)
  })

  it('can be marked after a history event so the next mutation is a no-op', () => {
    const tracker = createRoutePathTracker('/xqc')

    tracker.mark('/browse')

    expect(tracker.observe('/browse')).toBe(false)
    expect(tracker.observe('/shroud')).toBe(true)
  })
})

describe('routeSyncScheduler', () => {
  it('fires within maxWait under continuous mutations', () => {
    vi.useFakeTimers()
    try {
      let runs = 0
      let now = 0
      const timers = new Map<ReturnType<typeof setTimeout>, { fn: () => void; due: number }>()
      let id = 0
      const scheduler = createRouteSyncScheduler(() => {
        runs += 1
      }, {
        debounceMs: 350,
        maxWaitMs: 1_200,
        now: () => now,
        setTimer: (fn, ms) => {
          const handle = (++id) as unknown as ReturnType<typeof setTimeout>
          timers.set(handle, { fn, due: now + ms })
          return handle
        },
        clearTimer: (handle) => {
          timers.delete(handle)
        },
      })

      // Continuous churn every 50ms for 2s — trailing-only would never fire.
      for (let i = 0; i < 40; i += 1) {
        scheduler.schedule()
        now += 50
        for (const [handle, t] of [...timers.entries()]) {
          if (t.due <= now) {
            timers.delete(handle)
            t.fn()
          }
        }
      }
      expect(runs).toBeGreaterThanOrEqual(1)
      expect(now).toBeLessThanOrEqual(2_100)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
