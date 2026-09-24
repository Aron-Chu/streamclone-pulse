/** A link cannot assume an event's day is in the current certified range. */
export function creatorHistoryHref(login: string): string | null {
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null
  return `/analytics/moments?${new URLSearchParams({
    view: 'history', scope: 'creator', creator: login,
  })}`
}
