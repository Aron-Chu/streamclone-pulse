import { checkMomentSource } from './discoveryMoments'
import type { MomentVod } from './momentsChecked'
import type { MomentsFeedItem } from './momentsFeed'

/**
 * The opened moment's VOD: the one stream-record read the old page already
 * makes for a selected moment (checkMomentSource), so Play and Open on Twitch
 * land on the minute and the detail can lead with the time in the VOD. The
 * feed carries no VOD id. Null when the record links no VOD with verified
 * timing; the page then gives the time since go-live and a Watch live link.
 */
export async function loadMomentVod(item: MomentsFeedItem, signal: AbortSignal): Promise<MomentVod | null> {
  const source = await checkMomentSource({
    key: item.id, login: item.login.toLowerCase(), streamId: item.streamId, offsetSeconds: item.offsetSeconds,
    label: item.label.text, provenance: 'hub',
  }, signal)
  const vodId = source.vodHref ? /\/videos\/(\d+)/.exec(source.vodHref)?.[1] : undefined
  if (!vodId || source.vodOffsetSeconds == null) return null
  return { vodId, alignSeconds: source.vodOffsetSeconds - item.offsetSeconds }
}

/**
 * The page's VODs, for its lifetime: a stream's record is read again only when
 * no earlier answer covers the moment. The VOD's alignment is the stream's, and
 * the record bounds it by how much has been archived, so a VOD found for one
 * moment serves every earlier moment of the stream, and none found for one
 * serves every later one. A read is shared by whoever asks while it runs and
 * is not cancelled when one of them goes.
 */
export interface MomentVodCache {
  /** The answer without a read, or undefined when only a read can tell. */
  peek: (item: MomentsFeedItem) => MomentVod | null | undefined
  read: (item: MomentsFeedItem) => Promise<MomentVod | null>
}
export function momentVodCache(load: (item: MomentsFeedItem) => Promise<MomentVod | null>): MomentVodCache {
  const known = new Map<string, { vod: MomentVod | null; vodUpTo: number; noneFrom: number }>()
  const pending = new Map<string, Promise<MomentVod | null>>()
  const peek = (item: MomentsFeedItem) => {
    const k = known.get(item.streamId)
    if (k?.vod && item.offsetSeconds <= k.vodUpTo) return k.vod
    if (k && item.offsetSeconds >= k.noneFrom) return null
    return undefined
  }
  const read = (item: MomentsFeedItem) => {
    const hit = peek(item)
    if (hit !== undefined) return Promise.resolve(hit)
    let run = pending.get(item.id)
    if (!run) {
      run = load(item).then(vod => {
        const k = known.get(item.streamId) ?? { vod: null, vodUpTo: -1, noneFrom: Infinity }
        if (vod) { k.vod = vod; k.vodUpTo = Math.max(k.vodUpTo, item.offsetSeconds) } else k.noneFrom = Math.min(k.noneFrom, item.offsetSeconds)
        known.set(item.streamId, k)
        return vod
      }).finally(() => pending.delete(item.id))
      pending.set(item.id, run)
    }
    return run
  }
  return { peek, read }
}

/** Where Play starts: the minute less LEAD seconds, in the VOD. */
export function vodSeconds(vod: MomentVod, offsetSeconds: number, leadSeconds: number): number {
  return Math.max(0, Math.floor(vod.alignSeconds + offsetSeconds - leadSeconds))
}

/** Twitch's embedded player at a time; `parent` is this page's host, as Twitch requires. */
export function vodEmbedSrc(vodId: string, seconds: number, host: string): string {
  const s = Math.max(0, Math.round(seconds))
  const query = new URLSearchParams({ video: `v${vodId}`, time: `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`, parent: host, autoplay: 'true' })
  return `https://player.twitch.tv/?${query}`
}
