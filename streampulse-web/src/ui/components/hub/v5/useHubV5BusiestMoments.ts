/**
 * Top moments today's fill (board 2A, deep audit 11-02): the moments in the
 * chart's hub/moments answers this visit, the ones the locks and their warm-up
 * (useHubV5LockWarmup) already read. It reads nothing itself: it lists the
 * cached answers for the locks' window, and again each time one is cached.
 */
import { useEffect, useState } from 'react'
import { onBucketMomentsWrite, readBucketMomentsResponses } from '../../../../lib/bucketMomentsCache'
import type { HubLivePulseMoment, PublicHubActivityWindow } from '../../../../lib/publicHub'
import { momentRowKey } from './hubV5Model'

const NONE: readonly HubLivePulseMoment[] = []
const keys = (moments: readonly HubLivePulseMoment[]) => moments.map(momentRowKey).join('\n')

export function useHubV5BusiestMoments(intervalWindow: PublicHubActivityWindow | undefined): readonly HubLivePulseMoment[] {
  const [moments, setMoments] = useState<readonly HubLivePulseMoment[]>(NONE)
  useEffect(() => {
    if (!intervalWindow) {
      setMoments(NONE)
      return undefined
    }
    const read = () => {
      const next = readBucketMomentsResponses(intervalWindow).flatMap((response) => response.moments)
      // the same moments keep the same list, so the carousel does not redraw for nothing
      setMoments((prev) => (keys(prev) === keys(next) ? prev : next.length ? next : NONE))
    }
    read()
    return onBucketMomentsWrite(read)
  }, [intervalWindow])
  return moments
}
