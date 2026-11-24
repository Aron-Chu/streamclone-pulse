/**
 * Points the preview module (clips and stream frames) at the portal's own client, because the Moments
 * list and a Moment's page do not load the console's configured API. Kept apart from momentReads.ts,
 * which links into a Moment's page load before the picture code.
 */
import { configureMomentClipsReader, configureVodStoryboardReader } from '@streampulse/analytics-console/moment-previews'
import { apiClient } from './apiClient'
import { inTurn, isMomentVideoId } from './momentReads'

let readersSet = false

/** Clips and stream frames through the portal's client, with the console API's error mapping. */
export function setupMomentPreviewReads(): void {
  if (readersSet) return
  readersSet = true
  configureMomentClipsReader(async (login, startedAt, endedAt) => {
    const params = new URLSearchParams({ startedAt, endedAt })
    const { data } = await apiClient<unknown>(`/v1/channels/${encodeURIComponent(login)}/clips?${params.toString()}`, { timeoutMs: 8000, maxResponseBytes: 512 * 1024 })
    return data
  })
  configureVodStoryboardReader(async (vodId, offsetSec) => {
    // The preview module asks only for a VOD id it accepts; this is the same check, so nothing else is asked.
    if (!isMomentVideoId(vodId)) return null
    const params = new URLSearchParams({ offsetSec: String(Math.floor(offsetSec)) })
    try {
      const { data } = await inTurn(() => apiClient<unknown>(`/v1/analytics/vods/${encodeURIComponent(vodId)}/storyboard-thumb?${params.toString()}`, { timeoutMs: 8000 }))
      return data ?? null
    } catch (error) {
      // As the console API: 403 = still recording, 404 with a reason = no tile; anything else = no answer.
      const failure = error && typeof error === 'object' ? error as { status?: unknown; body?: unknown } : {}
      if (failure.status === 403) return { statusCode: 403 }
      const reason = failure.body && typeof failure.body === 'object' ? (failure.body as { reason?: unknown }).reason : undefined
      if (failure.status === 404 && typeof reason === 'string') return { reason }
      return null
    }
  })
}
