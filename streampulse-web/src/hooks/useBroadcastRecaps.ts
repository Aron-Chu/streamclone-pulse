import { useEffect, useState } from 'react'
import { getBackendUrl } from '../lib/apiClient'
import { fetchPortalStreamRecap, type PortalStreamRecapResponse } from '../lib/streamcloneAnalytics'

/**
 * How many of a day's broadcasts get a ranking read. Bounded on purpose, like
 * the eight-stream cap the category browser already uses: a stored day can list
 * many broadcasts, and one recap read each would turn browsing into a fan-out.
 */
export const RANKED_BROADCASTS_PER_DAY = 4

export interface BroadcastRecaps {
  recaps: Record<string, PortalStreamRecapResponse | null>
  /** A ranking read is still outstanding — do not yet claim rows are unranked. */
  loading: boolean
}

/**
 * Server rankings for the first few broadcasts of the selected day.
 *
 * `fetchPortalStreamRecap` resolves to `null` on failure rather than throwing,
 * so a missing ranking is an ordinary outcome the caller must present honestly.
 */
export function useBroadcastRecaps(streamIds: readonly string[]): BroadcastRecaps {
  const wanted = [
    ...new Set(streamIds.filter(id => typeof id === 'string' && id !== '' && id.length <= 220 && !/\s/.test(id))),
  ].slice(0, RANKED_BROADCASTS_PER_DAY)
  const key = JSON.stringify([getBackendUrl(), wanted])
  const [state, setState] = useState<{ key: string; recaps: Record<string, PortalStreamRecapResponse | null> }>({ key, recaps: {} })
  useEffect(() => {
    let active = true
    setState({ key, recaps: {} })
    void (async () => {
      // Two reads at a time, and only for the broadcasts on screen.
      for (let start = 0; active && start < wanted.length; start += 2) {
        const batch = await Promise.all(
          wanted.slice(start, start + 2).map(async id => [id, await fetchPortalStreamRecap(id)] as const),
        )
        if (!active) return
        setState(previous => ({
          key,
          recaps: { ...(previous.key === key ? previous.recaps : {}), ...Object.fromEntries(batch) },
        }))
      }
    })()
    return () => {
      active = false
    }
    // The ordered, bounded stream set and API origin are encoded in this key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const recaps = state.key === key ? state.recaps : {}
  return { recaps, loading: wanted.some(id => !(id in recaps)) }
}
