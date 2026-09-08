import { currentDiscoveryMonth } from './discoveryCatalogue'

/** Creator history is a catalogue scope, never a guessed broadcast identity. */
export function creatorHistoryHref(login: string, at?: number): string | null {
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null
  const current = currentDiscoveryMonth()
  const date = at != null && Number.isFinite(at) ? new Date(at) : null
  const detectedMonth = date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : ''
  const month = detectedMonth >= '2011-01' && detectedMonth <= current ? detectedMonth : current
  return `/analytics/moments?${new URLSearchParams({ view: 'recent', collection: 'history', creator: login, month, calendar: 'year' })}`
}
