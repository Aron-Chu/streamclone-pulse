import { useEffect, useState } from 'react'
import { relativeTime } from '../../utils/consoleFormat.ts'

/**
 * A relative age that keeps ageing while visible. The console itself rarely
 * re-renders on an idle page, so an inline `relativeTime()` froze at load.
 */
export function RelativeTimeText({ value, prefix }: { value?: string | number; prefix: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!value) return
    let id: number | undefined
    const stop = () => {
      if (id !== undefined) window.clearInterval(id)
      id = undefined
    }
    const start = () => {
      if (id === undefined) id = window.setInterval(() => setTick(tick => tick + 1), 30_000)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return stop()
      setTick(tick => tick + 1)
      start()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [value])
  return <>{prefix} {value ? relativeTime(value) : '-'}</>
}
