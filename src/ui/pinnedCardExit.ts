import { useEffect, useRef, useState } from 'react'

/** Same duration as `.pulse-moment-card-enter`. */
export const SELECTED_MOMENT_CARD_EXIT_MS = 180

export function nextPinnedCardHold<T>(args: {
  incoming: T | null
  held: T | null
  exiting: boolean
  reducedMotion: boolean
}): { held: T | null; exiting: boolean } {
  if (args.incoming) {
    return { held: args.incoming, exiting: false }
  }
  if (args.reducedMotion || !args.held) {
    return { held: null, exiting: false }
  }
  return { held: args.held, exiting: true }
}

export function usePinnedCardHold<T>(
  incoming: T | null,
  reducedMotion = false,
): { point: T | null; exiting: boolean } {
  const lastRef = useRef<T | null>(incoming)
  const [exiting, setExiting] = useState(false)
  if (incoming != null) lastRef.current = incoming

  const next = nextPinnedCardHold({
    incoming,
    held: lastRef.current,
    exiting,
    reducedMotion,
  })
  if (next.exiting !== exiting) {
    setExiting(next.exiting)
  }
  if (next.held == null) lastRef.current = null

  useEffect(() => {
    if (!exiting || incoming != null) return
    const timer = window.setTimeout(() => {
      lastRef.current = null
      setExiting(false)
    }, SELECTED_MOMENT_CARD_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [exiting, incoming])

  return { point: incoming ?? (next.exiting ? lastRef.current : null), exiting: next.exiting }
}
