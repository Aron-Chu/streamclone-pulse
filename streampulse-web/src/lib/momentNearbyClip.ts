import { apiClient, getBackendUrl } from './apiClient'
import { resolveBackendSource } from './backendSource'
import { CLIP_THUMBNAIL_HOSTS, twitchImage } from './nativeClips'

/** A clip viewers made near a moment: a real picture of the stream around then, not the moment's own frame. */
export interface NearbyClip { url: string; thumbnailUrl: string; title: string }

/** Clips made from a minute before the moment to five after: a clip is made after what it shows. */
export const NEARBY_CLIP_BEFORE_MS = 60_000
export const NEARBY_CLIP_AFTER_MS = 300_000
/** A card does not wait longer than this for the lookup; its line shows instead. */
export const NEARBY_CLIP_WAIT_MS = 2_500
/** Lookups kept for the page's life, the oldest dropped first (a long session browses many moments). */
const LOOKUPS_KEPT = 200

type ClipItem = { url?: unknown; thumbnailUrl?: unknown; title?: unknown; viewCount?: unknown; createdAt?: unknown }

const lookups = new Map<string, Promise<NearbyClip | null>>()

/** Twitch's own https link to a clip, or null. */
function clipLink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /^(www\.|clips\.)?twitch\.tv$/.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

/**
 * The clip made nearest the moment, of the stream's clips in that window: the
 * closest made just after it (a clip shows the seconds before it was made), then
 * the most watched. Only Twitch's own clip links and clip picture hosts are kept.
 */
export function pickNearbyClip(items: readonly ClipItem[], at: number): NearbyClip | null {
  const usable = items.flatMap(item => {
    const url = clipLink(item.url)
    const thumbnailUrl = twitchImage(item.thumbnailUrl, CLIP_THUMBNAIL_HOSTS)
    if (!url || !thumbnailUrl) return []
    const created = typeof item.createdAt === 'string' ? Date.parse(item.createdAt) : Number.NaN
    const distance = Number.isFinite(created) ? Math.abs(created - (at + 30_000)) : Number.MAX_SAFE_INTEGER
    const views = typeof item.viewCount === 'number' && Number.isFinite(item.viewCount) ? item.viewCount : 0
    return [{ clip: { url, thumbnailUrl, title: typeof item.title === 'string' ? item.title : '' }, distance, views }]
  })
  usable.sort((a, b) => a.distance - b.distance || b.views - a.views)
  return usable[0]?.clip ?? null
}

/**
 * The moment's nearby clip, looked up once per moment and shared by every card
 * that shows it. A failed lookup answers null; it is not retried until reload.
 */
export function lookupNearbyClip(moment: { key: string; login: string; at?: number }): Promise<NearbyClip | null> {
  const at = moment.at
  if (at == null || !Number.isFinite(at) || !moment.login || resolveBackendSource(getBackendUrl()) === 'local') return Promise.resolve(null)
  let lookup = lookups.get(moment.key)
  if (!lookup) {
    const params = new URLSearchParams({
      startedAt: new Date(at - NEARBY_CLIP_BEFORE_MS).toISOString(),
      endedAt: new Date(at + NEARBY_CLIP_AFTER_MS).toISOString(),
    })
    lookup = apiClient<{ items?: unknown }>(`/v1/channels/${encodeURIComponent(moment.login)}/clips?${params.toString()}`, {
      timeoutMs: 8000,
      maxResponseBytes: 512 * 1024,
    })
      // A malformed answer (items not a list, a null item) is no clip, never a rejection.
      .then(({ data }) => Array.isArray(data?.items) ? pickNearbyClip((data.items as unknown[]).filter((item): item is ClipItem => item != null && typeof item === 'object'), at) : null)
      .catch(() => null)
    lookups.set(moment.key, lookup)
    if (lookups.size > LOOKUPS_KEPT) lookups.delete(lookups.keys().next().value!)
  }
  return lookup
}

/**
 * The lookup, or null once `ms` pass: a slow answer still fills the cache for the next show.
 * It never rejects: a lookup that throws (a time out of range, say) is no clip.
 */
export function nearbyClipWithin(moment: { key: string; login: string; at?: number }, ms = NEARBY_CLIP_WAIT_MS): Promise<NearbyClip | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const lookup = new Promise<NearbyClip | null>(resolve => resolve(lookupNearbyClip(moment))).catch(() => null)
  return Promise.race([lookup, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms) })])
    .finally(() => clearTimeout(timer))
}
