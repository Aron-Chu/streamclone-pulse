import { useQuery } from '@tanstack/react-query'

import { getAnalyticsLive, type AnalyticsStreamDetail } from '../api.ts'
import { LIVE_REQUEST_TIMEOUT_MS } from '@streampulse/pulse-core'
import { resolveChannelActuallyLive } from '../utils/analyticsStreamRow.ts'

export function analyticsLiveQueryKey(login: string) {
  return ['analytics-live', login] as const
}

/** What a `refetchInterval` function reads of the query (any session read's query fits). */
export type SessionReadIntervalQuery = {
  state: { data?: AnalyticsStreamDetail | null; dataUpdateCount: number; errorUpdateCount: number }
}

export type UseAnalyticsLiveOptions = {
  enabled?: boolean
  refetchInterval?: number | false | ((query: SessionReadIntervalQuery) => number | false)
  /** Reject if getAnalyticsLive does not resolve within LIVE_REQUEST_TIMEOUT_MS. */
  withTimeout?: boolean
}

function fetchLiveWithTimeout(login: string): Promise<AnalyticsStreamDetail> {
  return new Promise<AnalyticsStreamDetail>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('live stats request timed out')),
      LIVE_REQUEST_TIMEOUT_MS,
    )
    getAnalyticsLive(login).then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function useAnalyticsLive(login: string, options: UseAnalyticsLiveOptions = {}) {
  const { enabled = true, refetchInterval, withTimeout = false } = options
  return useQuery({
    queryKey: analyticsLiveQueryKey(login),
    queryFn: () => (withTimeout ? fetchLiveWithTimeout(login) : getAnalyticsLive(login)),
    enabled: Boolean(login) && enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: refetchInterval ?? (query =>
      resolveChannelActuallyLive(query.state.data) ? 30_000 : 60_000),
  })
}
