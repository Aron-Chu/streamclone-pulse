import { apiClient } from './momentsApiClient'
import { normalizeDiscoveryCatalogue, type DiscoveryDay } from './discoveryCatalogue'

export interface DiscoveryYear {
  year: string; days: DiscoveryDay[]; state: 'ready' | 'stale' | 'unavailable'
  asOf: string; dataThrough: string | null; projectionUpdatedAt: string | null
}

/** Reuse the strict month/day validator without accepting events in a summary. */
export function normalizeDiscoveryYear(value: unknown, year: string, creator: string): DiscoveryYear {
  const b = value as Record<string, unknown> | null
  if (!b || !/^\d{4}$/.test(year) || Number(year) < 2011 || Number(year) > new Date().getUTCFullYear()
    || b.schemaVersion !== 1 || b.year !== year || b.month != null || b.calendarScope !== 'year_and_creator_only'
    || !Array.isArray(b.items) || b.items.length || b.nextCursor || !Array.isArray(b.days)) throw new Error('Invalid year summary')
  const expected = (Date.UTC(Number(year) + 1, 0, 1) - Date.UTC(Number(year), 0, 1)) / 86_400_000
  if (b.days.length !== expected) throw new Error('Incomplete year summary')
  const days: DiscoveryDay[] = []
  let offset = 0
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`
    const count = new Date(Date.UTC(Number(year), m, 0)).getUTCDate()
    const normalized = normalizeDiscoveryCatalogue({ ...b, month, calendarScope: 'month_and_creator_only', days: b.days.slice(offset, offset + count) }, { month, creator, day: '' })
    days.push(...normalized.days); offset += count
  }
  return { year, days, state: b.state as DiscoveryYear['state'], asOf: b.asOf as string,
    dataThrough: b.dataThrough as string | null, projectionUpdatedAt: b.projectionUpdatedAt as string | null }
}

export async function fetchDiscoveryYear(year: string, creator: string, signal: AbortSignal) {
  if (!/^\d{4}$/.test(year) || Number(year) < 2011 || Number(year) > new Date().getUTCFullYear()
    || (creator && !/^[a-z0-9_]{1,25}$/.test(creator))) throw new Error('Invalid year or creator')
  const query = new URLSearchParams({ year })
  if (creator) query.set('login', creator)
  const { data } = await apiClient<unknown>(`/v1/public/discovery/activity?${query}`, { signal, timeoutMs: 8000, maxResponseBytes: 150_000 })
  return normalizeDiscoveryYear(data, year, creator)
}
