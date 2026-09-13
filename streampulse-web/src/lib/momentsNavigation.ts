/** Only local Moments URLs may be used as a broadcast's return destination. */
export function momentsReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value, 'https://portal.invalid')
    return url.origin === 'https://portal.invalid' && url.pathname === '/analytics/moments'
      ? url.pathname + url.search : null
  } catch { return null }
}

export function broadcastTimelineHref(login: string, streamId: string, returnTo?: string, offset?: number): string {
  const back = momentsReturnPath(returnTo)
  const query = back ? `?${new URLSearchParams({ returnTo: back })}` : ''
  const hash = offset != null && Number.isFinite(offset) && offset >= 0 ? `#t=${Math.floor(offset)}` : ''
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}${query}${hash}`
}
