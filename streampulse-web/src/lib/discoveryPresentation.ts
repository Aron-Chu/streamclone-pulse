export type DiscoveryMeasure = 'detections' | 'chatMessages' | 'emoteUses'

/** Input is already filtered and sorted. Broadcasts follow first appearance. */
export function groupDiscoveryBroadcasts<T extends { login: string; streamId: string }>(items: readonly T[]) {
  const groups = new Map<string, { key: string; login: string; streamId: string; items: T[] }>()
  for (const item of items) {
    const login = item.login.trim().toLowerCase()
    const key = JSON.stringify([login, item.streamId])
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, login, streamId: item.streamId, items: [item] })
  }
  return [...groups.values()]
}

export interface DiscoveryPresentation {
  mode: 'month' | 'year'
  year: string
  years: 1 | 3
  measure: DiscoveryMeasure
}

/** Display choices are URL state, not additional backend query parameters. */
export function readDiscoveryPresentation(params: URLSearchParams, month: string): DiscoveryPresentation {
  const current = new Date().getUTCFullYear()
  const validYear = (value: string) => /^\d{4}$/.test(value) && Number(value) >= 2011 && Number(value) <= current
  const requested = params.get('year') || ''
  const fallback = month.slice(0, 4)
  const measure = params.get('measure')
  return {
    mode: params.get('calendar') === 'year' ? 'year' : 'month',
    year: validYear(requested) ? requested : validYear(fallback) ? fallback : String(current),
    years: params.get('years') === '3' ? 3 : 1,
    measure: measure === 'chatMessages' || measure === 'emoteUses' ? measure : 'detections',
  }
}

export function discoveryOverviewYears(year: string, count: 1 | 3): string[] {
  const end = Number(year)
  if (!/^\d{4}$/.test(year) || end < 2011 || end > new Date().getUTCFullYear()) return []
  const length = Math.min(count, end - 2010)
  return Array.from({ length }, (_, i) => String(end - length + 1 + i))
}
