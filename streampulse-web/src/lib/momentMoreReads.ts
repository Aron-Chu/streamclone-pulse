/**
 * The two reads behind a Moment page's "More from {channel}" and "More {game} Moments", besides the
 * recaps momentReads shares: the channel's streams list (the one the channel page reads) and the Moments
 * list's hub snapshot. Both are public reads the portal already makes; no other route is asked. Each is
 * read once for every caller and kept two minutes (a failure, five seconds), so a row's Moment page
 * opens with the same answers.
 */
import { portalChannelStreamsPath } from '../hooks/useChannelPageData'
import { apiClient, getBackendUrl } from './apiClient'
import { fetchPublicHubBase, type PublicHub } from './publicHub'
import { readPublicHubCacheForCurrentBackend, schedulePublicHubCacheWrite } from './publicHubCache'

const ANSWER_KEPT_MS = 120_000
const FAILURE_KEPT_MS = 5_000
const kept = new Map<string, { until: number; promise: Promise<unknown> }>()

function keep<T>(key: string, read: () => Promise<T>): Promise<T> {
  const held = kept.get(key)
  if (held && held.until > Date.now()) return held.promise as Promise<T>
  const entry = { until: Infinity, promise: read() as Promise<unknown> }
  kept.set(key, entry)
  entry.promise.then(() => { entry.until = Date.now() + ANSWER_KEPT_MS }, () => { entry.until = Date.now() + FAILURE_KEPT_MS })
  if (kept.size > 50) kept.delete(kept.keys().next().value!)
  return entry.promise as Promise<T>
}

/** The channel's streams list's items, as the route answered them (otherChannelStreams checks each). */
export function loadChannelStreams(login: string): Promise<unknown> {
  return keep(`streams|${getBackendUrl()}|${login}`, () => apiClient<{ items?: unknown }>(portalChannelStreamsPath(login), { timeoutMs: 8000, credentials: 'omit' })
    .then(({ data }) => data?.items))
}

/**
 * The Moments list's hub snapshot (the 30-minute window, its Moments only): the copy the list saved
 * when it is still fresh, else one read, saved for the list in turn. A hub that did not answer fails.
 */
export function loadMomentsHub(): Promise<PublicHub> {
  return keep(`hub|${getBackendUrl()}`, async () => {
    const saved = readPublicHubCacheForCurrentBackend('30m', 'moments')
    if (saved) return saved.data
    const answer = await fetchPublicHubBase(undefined, '30m', 'moments')
    if (!answer.hubEndpointOk) throw new Error('The hub did not answer.')
    schedulePublicHubCacheWrite('30m', answer.data, 'moments', answer.dataAsOf)
    return answer.data
  })
}

/** Tests only. */
export function resetMomentMoreReads(): void {
  kept.clear()
}
