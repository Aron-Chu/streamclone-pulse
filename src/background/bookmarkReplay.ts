import type { PastVodRow } from '../shared/messages.ts'
import type { GqlVodDiscoveryResult } from '../shared/twitchVodGql.ts'

/**
 * The worker's archive lookups, bound by the service worker: stream history
 * (LIST_PAST_VODS) and Twitch GQL in an open tab of that channel
 * (DISCOVER_LIVE_VOD), which resolves null when no such tab is open.
 */
export interface ReplayLookups {
  pastVods(login: string): Promise<PastVodRow[]>
  liveArchive(login: string, streamId: string): Promise<GqlVodDiscoveryResult | null>
}
export interface StreamOnlySave { login: string; streamId: string }
export const streamKey = (login: string, streamId: string) => `${login}:${streamId}`
const vodPattern = /^\d{6,20}$/
/** One look per open is enough; the rest wait for the next one. */
const CHANNEL_LIMIT = 8
const TAB_LOOKUPS_PER_CHANNEL = 3

/**
 * VOD ids for streams that have stream-only saves, by `streamKey`. Only the
 * archive of that exact stream counts, never the channel's latest VOD. Stream
 * history comes first (an ended stream, often a live one too); a stream it
 * does not list yet may still be live, so the channel's open tab is asked.
 * Pass saves newest first: the newest streams are looked up first.
 */
export async function findStreamReplays(saves: readonly StreamOnlySave[], lookups: ReplayLookups): Promise<Map<string, string>> {
  const byLogin = new Map<string, Set<string>>()
  for (const s of saves) byLogin.set(s.login, (byLogin.get(s.login) ?? new Set()).add(s.streamId))
  const found = new Map<string, string>()
  await Promise.all([...byLogin].slice(0, CHANNEL_LIMIT).map(async ([login, streams]) => {
    const rows = await lookups.pastVods(login).catch(() => [] as PastVodRow[])
    const missing: string[] = []
    for (const streamId of streams) {
      const vodId = rows.find(row => row.streamId === streamId && row.videoId && vodPattern.test(row.videoId))?.videoId
      if (vodId) found.set(streamKey(login, streamId), vodId)
      else missing.push(streamId)
    }
    for (const streamId of missing.slice(0, TAB_LOOKUPS_PER_CHANNEL)) {
      const live = await lookups.liveArchive(login, streamId).catch(() => null)
      if (!live) break
      if (live.vodId && live.streamId === streamId && vodPattern.test(live.vodId)) found.set(streamKey(login, streamId), live.vodId)
    }
  }))
  return found
}
