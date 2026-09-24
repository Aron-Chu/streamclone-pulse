/** Only local Moments or Explorer URLs may be used as a broadcast return destination. */
export function analyticsReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value, 'https://portal.invalid')
    return url.origin === 'https://portal.invalid' && (url.pathname === '/analytics/moments'
      || url.pathname === '/analytics/explore'
      || /^\/analytics\/explore\/[a-z0-9_-]{1,128}$/i.test(url.pathname))
      ? url.pathname + url.search + url.hash : null
  } catch { return null }
}

export function legacyMomentsExplorerPath(params: URLSearchParams, hash = '', storyId?: string): string {
  const explorer = new URLSearchParams()
  const allowed: Record<string, readonly string[] | undefined> = {
    window: ['live', '24h', '7d'], signal: ['all', 'chat', 'emotes', 'mixed'],
    state: ['all', 'live', 'ended'], sort: ['strongest', 'recent', 'moments'],
  }
  for (const key of ['window', 'signal', 'category', 'state', 'sort', 'q']) {
    const value = params.get(key)
    if (value && (!allowed[key] || allowed[key].includes(value))) explorer.set(key, value)
  }
  const path = storyId && /^[a-z0-9_-]{1,128}$/i.test(storyId)
    ? `/analytics/explore/${encodeURIComponent(storyId)}` : '/analytics/explore'
  return `${path}${explorer.size ? `?${explorer}` : ''}${hash}`
}

export function broadcastTimelineHref(login: string, streamId: string, returnTo?: string, offset?: number): string {
  const back = analyticsReturnPath(returnTo)
  const query = back ? `?${new URLSearchParams({ returnTo: back })}` : ''
  const hash = offset != null && Number.isFinite(offset) && offset >= 0 ? `#t=${Math.floor(offset)}` : ''
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}${query}${hash}`
}
