import {
  discoverNativeLiveVodLink,
  discoverLiveVodNavigationCandidate,
  type LiveVodNavigationCandidate,
} from './twitchVodDiscovery.ts'

/**
 * Session-scoped cache for the page's current-broadcast VOD navigation candidate.
 *
 * `discoverLiveVodNavigationCandidate` serializes `document.documentElement.innerHTML`
 * and every `<script>` body. That is acceptable once per route, and catastrophic
 * when a React render calls it per moment row. Everything on the render path must
 * read {@link peekLiveVodNavigationCandidate}, which never touches the DOM.
 *
 * Discovery order inside a session:
 *   1. structural pass — native player/archive control and `/videos/{id}` anchors
 *   2. one serialized page/script fallback, at most once per session
 *
 * Locally validated GQL, Past Streams, and the backend archive candidate are
 * resolved by callers around this cache; they never require a DOM scan.
 */

export interface LiveVodNavigationSessionKey {
  /** `location.href` at the time of resolution — a Twitch SPA route change invalidates. */
  href: string
  /** Backend stream identity; a new broadcast invalidates. */
  streamId: string | null
}

interface CacheEntry {
  key: LiveVodNavigationSessionKey
  candidate: LiveVodNavigationCandidate | null
  /** The expensive serialized fallback is allowed once per session key. */
  serializedFallbackUsed: boolean
}

let entry: CacheEntry | null = null

function sameSession(
  a: LiveVodNavigationSessionKey,
  b: LiveVodNavigationSessionKey,
): boolean {
  return a.href === b.href && a.streamId === b.streamId
}

export function currentLiveVodSessionKey(
  streamId: string | null | undefined,
): LiveVodNavigationSessionKey {
  return {
    href: typeof window === 'undefined' ? '' : window.location.href,
    streamId: streamId?.trim() || null,
  }
}

/**
 * Read-only accessor for render paths. Never scans the DOM; returns `null` until
 * {@link resolveLiveVodNavigationCandidate} has run for this session.
 */
export function peekLiveVodNavigationCandidate(
  key: LiveVodNavigationSessionKey,
): LiveVodNavigationCandidate | null {
  if (!entry || !sameSession(entry.key, key)) return null
  return entry.candidate
}

/** True when this session already produced a resolution (candidate or a proven absence). */
export function hasResolvedLiveVodNavigation(key: LiveVodNavigationSessionKey): boolean {
  return Boolean(entry && sameSession(entry.key, key))
}

/**
 * Resolve and cache the candidate for a session. Safe to call from effects,
 * observers, and user actions — never from render.
 *
 * @param options.allowSerializedFallback when false, only the cheap structural
 *   pass runs. Debounced DOM-mutation rescans use this to avoid re-serializing
 *   the document on every Twitch DOM churn.
 * @param options.force re-run even if this session already resolved.
 */
export function resolveLiveVodNavigationCandidate(
  key: LiveVodNavigationSessionKey,
  options: { allowSerializedFallback?: boolean; force?: boolean } = {},
): LiveVodNavigationCandidate | null {
  if (typeof document === 'undefined') return null

  const fresh = !entry || !sameSession(entry.key, key)
  if (fresh) {
    entry = { key, candidate: null, serializedFallbackUsed: false }
  }
  const current = entry as CacheEntry

  if (!fresh && !options.force && current.candidate) return current.candidate

  const structural = discoverNativeLiveVodLink()
  if (structural) {
    current.candidate = structural
    return structural
  }

  const allowSerialized = options.allowSerializedFallback !== false
  if (allowSerialized && (!current.serializedFallbackUsed || options.force)) {
    current.serializedFallbackUsed = true
    current.candidate = discoverLiveVodNavigationCandidate(key.streamId)
    return current.candidate
  }

  return current.candidate
}

/** Drop the cache so the next resolution re-scans (route change, manual retry). */
export function invalidateLiveVodNavigationCache(): void {
  entry = null
}

/** @internal test hook */
export function __liveVodNavigationCacheState(): CacheEntry | null {
  return entry
}
