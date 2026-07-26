import { useEffect, useRef, useState } from 'react'
import type { PublicHub } from '../lib/publicHub'
import {
  createEmptyPoolWireState,
  reducePoolWireState,
  type PoolWireEvent,
  type PoolWireState,
} from '../lib/poolWireReducer'

export interface UsePoolWireEventsArgs {
  hub: PublicHub | null
  pollSequence: number
  lastSuccessfulPollAt: number | null
  hubEndpointOk: boolean
  /** When false, freeze (do not feed unhealthy snapshots). */
  healthy?: boolean
}

export interface UsePoolWireEventsResult {
  events: PoolWireEvent[]
  initialized: boolean
  circuitOpen: boolean
}

/**
 * Feeds each successful hub poll into the Pool Wire reducer exactly once.
 */
export function usePoolWireEvents({
  hub,
  pollSequence,
  lastSuccessfulPollAt,
  hubEndpointOk,
  healthy = true,
}: UsePoolWireEventsArgs): UsePoolWireEventsResult {
  const [state, setState] = useState<PoolWireState>(() => createEmptyPoolWireState())
  const lastSeqRef = useRef<number | null>(null)

  useEffect(() => {
    if (!hub || pollSequence <= 0) return
    if (lastSeqRef.current != null && pollSequence <= lastSeqRef.current) return
    lastSeqRef.current = pollSequence

    const receivedAt = lastSuccessfulPollAt ?? Date.now()
    const snapshotHealthy = Boolean(hubEndpointOk && healthy)

    setState((prev) =>
      reducePoolWireState(prev, {
        pollSequence,
        receivedAt,
        healthy: snapshotHealthy,
        liveChannels: hub.liveChannels,
        livePulseMoments: hub.livePulseMoments ?? [],
      }),
    )
  }, [hub, pollSequence, lastSuccessfulPollAt, hubEndpointOk, healthy])

  return {
    events: state.events,
    initialized: state.initialized,
    circuitOpen: state.circuitOpen,
  }
}
