import { getBackendUrl } from '../shared/storage.ts'
import { extensionEmoteImageUrls } from '../shared/emoteUrl.ts'
import { momentContextFromMinutes, momentMinutesAfterOffset } from '../shared/momentMinute.ts'
import type { MomentContext } from '../ui/library/MomentPreview.tsx'
import { fetchWithTimeout, readResponseText } from './api.ts'

/** The budget the portal gives this endpoint: an uncached tail costs about as much as a whole timeline. */
const MINUTES_TIMEOUT_MS = 15_000
const MINUTES_MAX_BYTES = 1024 * 1024

export interface MomentMinuteDeps {
  root: () => Promise<string>
  fetchImpl?: typeof fetch
  now: () => number
}

const defaultDeps: MomentMinuteDeps = { root: () => getBackendUrl(), now: () => Date.now() }

/**
 * A saved moment's minute for My Moments' Preview, read by stream id and
 * offset from the per-minute rollups the portal's stream timeline draws.
 * Bookmarks keep only a label, so nothing is stored. Public and
 * unauthenticated, like the popup's hub read: no account or device credential
 * is attached. Null when the server has no such minute.
 */
export async function loadMomentMinute(streamId: string, offsetSeconds: number, deps: MomentMinuteDeps = defaultDeps): Promise<MomentContext | null> {
  const root = await deps.root()
  const res = await fetchWithTimeout(
    `${root}/v1/portal/analytics/streams/${encodeURIComponent(streamId)}/minutes?afterOffset=${momentMinutesAfterOffset(offsetSeconds)}`,
    { headers: { Accept: 'application/json' }, credentials: 'omit' },
    { timeoutMs: MINUTES_TIMEOUT_MS, fetchImpl: deps.fetchImpl },
  )
  // The local analytics stack has no portal minutes route; the portal skips it too.
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`minutes ${res.status}`)
  return momentContextFromMinutes(JSON.parse(await readResponseText(res, MINUTES_MAX_BYTES)), { streamId, offsetSeconds }, {
    capturedAt: deps.now(),
    emoteImage: emote => extensionEmoteImageUrls(emote, root).find(url => url.startsWith('https://')),
  })
}
