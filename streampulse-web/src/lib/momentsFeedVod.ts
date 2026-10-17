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
