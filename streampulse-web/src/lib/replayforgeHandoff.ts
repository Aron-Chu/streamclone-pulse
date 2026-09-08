/** Cross-product navigation carries an opaque reference, never credentials or source URLs. */
export function replayforgeHandoffHref(
  handoffRef: string | undefined,
  configuredOrigin: string | undefined = import.meta.env.VITE_REPLAYFORGE_UI_ORIGIN,
  allowLoopback = import.meta.env.DEV,
): string | null {
  if (!handoffRef || !/^cr_[A-Za-z0-9_-]{4,220}$/.test(handoffRef) || !configuredOrigin?.trim()) return null
  try {
    const origin = new URL(configuredOrigin.trim())
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return null
    if (origin.protocol !== 'https:' && !(allowLoopback && loopback && origin.protocol === 'http:')) return null
    return `${origin.origin}/handoff/streampulse/${encodeURIComponent(handoffRef)}`
  } catch { return null }
}

/** A refreshed transport reference is still unusable until the same exact-source
 * read confirms a timestamped VOD. This helper never admits a ReplayForge job. */
export function refreshedReplayforgeHandoffHref(
  source: { vodHref: string | null; handoffRef?: string } | null,
  configuredOrigin: string | undefined = import.meta.env.VITE_REPLAYFORGE_UI_ORIGIN,
  allowLoopback = import.meta.env.DEV,
): string | null {
  return source?.vodHref
    ? replayforgeHandoffHref(source.handoffRef, configuredOrigin, allowLoopback)
    : null
}
