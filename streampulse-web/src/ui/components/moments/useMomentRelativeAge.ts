import { useEffect, useReducer } from 'react'
import { formatAgo } from '@streampulse/pulse-core'

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

/** Midnight before last: formatAgo calls anything before today "Yesterday", so older rows show only their date. */
const startOfYesterday = (now: number) => {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - 1)
  return day.getTime()
}

/** pulse-core's 'ago', floored to the minute like the Hub's (Z08, 11-13): 'just now', '13 min ago', the clock, 'Yesterday' and the clock. */
function relativeAge(at: string | undefined): string | null {
  if (!at) return null
  const timestamp = Date.parse(at)
  if (!Number.isFinite(timestamp)) return null
  const now = Date.now()
  if (timestamp > now) return 'Time ahead of this device'
  return timestamp < startOfYesterday(now) ? null : formatAgo(timestamp, now)
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
