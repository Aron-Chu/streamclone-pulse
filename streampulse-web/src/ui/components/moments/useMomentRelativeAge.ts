import { useEffect, useReducer } from 'react'
import { formatRelativeTime } from '../../../lib/formatStats'

const listeners = new Set<() => void>()
let timer: number | null = null

function tick() {
  for (const listener of listeners) listener()
}

function stopTimer() {
  if (timer != null) window.clearInterval(timer)
  timer = null
}

function startTimer() {
  if (timer == null && listeners.size > 0 && !document.hidden) {
    timer = window.setInterval(tick, 10_000)
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopTimer()
  } else {
    tick()
    startTimer()
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) document.addEventListener('visibilitychange', onVisibilityChange)
  listeners.add(listener)
  startTimer()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

function relativeAge(at: string | undefined): string | null {
  if (!at) return null
  const timestamp = Date.parse(at)
  if (!Number.isFinite(timestamp)) return null
  return timestamp > Date.now() ? 'Time ahead of this device' : formatRelativeTime(timestamp)
}

/** One visible-tab timer; only rows whose displayed label changed rerender. */
export function useMomentRelativeAge(at: string | undefined): string | null {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  const age = relativeAge(at)
  useEffect(() => {
    if (!at) return
    let previous = relativeAge(at)
    return subscribe(() => {
      const next = relativeAge(at)
      if (next !== previous) {
        previous = next
        refresh()
      }
    })
  }, [at])
  return age
}
