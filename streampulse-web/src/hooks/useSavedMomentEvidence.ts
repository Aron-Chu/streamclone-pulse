import { useEffect, useMemo, useState } from 'react'
import type { DiscoveryMoment } from '../lib/discoveryMoments'
import {
  loadExactMomentRecap,
  mergeExactMomentRecap,
  momentNeedsExactRecap,
} from '../lib/discoveryMomentRecap'

const MAX_VISIBLE_RECAPS = 12
const MAX_CONCURRENT_RECAPS = 3
const MAX_CACHED_RECAPS = 100
const recapCache = new Map<string, Partial<DiscoveryMoment> | null>()

function recapKey(moment: DiscoveryMoment): string {
  return `${moment.key}:${moment.publicMomentId ?? ''}:${moment.revision ?? ''}`
}

function remember(key: string, value: Partial<DiscoveryMoment> | null) {
  if (!recapCache.has(key) && recapCache.size >= MAX_CACHED_RECAPS) {
    recapCache.delete(recapCache.keys().next().value!)
  }
  recapCache.set(key, value)
}

/**
 * Restore public reaction images/rates for the first visible saved results.
 * Saves remain a media-free local identity snapshot; this bounded read checks
 * only the same immutable stream + exact moment offset and never substitutes a
 * nearby detection.
 */
export function useSavedMomentEvidence(moments: DiscoveryMoment[], enabled: boolean): DiscoveryMoment[] {
  const [revision, refresh] = useState(0)
  const candidates = useMemo(() => enabled
    ? moments.filter(momentNeedsExactRecap).slice(0, MAX_VISIBLE_RECAPS)
    : [], [enabled, moments])
  const signature = candidates.map(recapKey).join('|')

  useEffect(() => {
    if (!enabled || !candidates.length) return
    const pending = candidates.filter(moment => !recapCache.has(recapKey(moment)))
    if (!pending.length) return
    const controller = new AbortController()
    let cursor = 0
    const worker = async () => {
      while (!controller.signal.aborted) {
        const moment = pending[cursor++]
        if (!moment) return
        try {
          const recap = await loadExactMomentRecap(moment, controller.signal)
          if (controller.signal.aborted) return
          remember(recapKey(moment), recap)
          refresh(value => value + 1)
        } catch {
          // A transient failure remains retryable on remount/reload; do not
          // cache it as proof that exact evidence is unavailable.
        }
      }
    }
    void Promise.all(Array.from(
      { length: Math.min(MAX_CONCURRENT_RECAPS, pending.length) },
      () => worker(),
    ))
    return () => controller.abort()
  // The exact identity signature is the request contract. candidates is
  // intentionally excluded so profile/rate enrichment cannot restart reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature])

  return useMemo(() => moments.map(moment => {
    const key = recapKey(moment)
    return recapCache.has(key) ? mergeExactMomentRecap(moment, recapCache.get(key)) : moment
  }), [moments, revision, signature])
}
