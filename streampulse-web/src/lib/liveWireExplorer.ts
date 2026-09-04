export type LiveWireExplorerScope = 'fresh' | 'broadcast'
export type LiveWireExplorerSignal = 'all' | 'chat' | 'emotes'
export type LiveWireExplorerSort = 'newest' | 'strongest' | 'category'

export interface LiveWireExplorerMoment {
  login?: string
  streamId?: string
  category?: string
  kind?: string
  at?: number
  score?: number
}

export interface LiveWireCategoryFacet {
  key: string
  label: string
  momentCount: number
  channelCount: number
  peakScore: number
  latestAt: number
}

export interface LiveWireCategoryGroup<T> extends LiveWireCategoryFacet {
  moments: T[]
}

export interface LiveWireExplorerView<T> {
  moments: T[]
  categories: LiveWireCategoryFacet[]
  groups: LiveWireCategoryGroup<T>[]
  channelCount: number
}

function finite(value: number | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0
}

export function liveWireCategoryLabel(value: string | undefined): string {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return normalized || 'Uncategorized'
}

export function liveWireCategoryKey(value: string | undefined): string {
  return liveWireCategoryLabel(value).toLocaleLowerCase()
}

export function liveWireSignalForKind(kind: string | undefined): Exclude<LiveWireExplorerSignal, 'all'> {
  const normalized = kind?.trim().toLocaleLowerCase() ?? ''
  return normalized === 'chat' || normalized === 'chat_spike' ? 'chat' : 'emotes'
}

function identity(moment: LiveWireExplorerMoment): string {
  return `${moment.login ?? ''}:${moment.streamId ?? ''}:${finite(moment.at)}`
}

function newest<T extends LiveWireExplorerMoment>(a: T, b: T): number {
  return finite(b.at) - finite(a.at) || finite(b.score) - finite(a.score) || identity(a).localeCompare(identity(b))
}

function strongest<T extends LiveWireExplorerMoment>(a: T, b: T): number {
  // Score is authored by the backend. This view may reorder the bounded
  // snapshot, but it must never compute a second score in the browser.
  return finite(b.score) - finite(a.score) || finite(b.at) - finite(a.at) || identity(a).localeCompare(identity(b))
}

function categoryFacetOrder(a: LiveWireCategoryFacet, b: LiveWireCategoryFacet): number {
  // A category's priority is derived exclusively from its loaded moments:
  // strongest backend score, then freshest occurrence, then stable label.
  return b.peakScore - a.peakScore || b.latestAt - a.latestAt || a.label.localeCompare(b.label)
}

/**
 * Build the Live Wire explorer projection from the already-authoritative
 * moment snapshot. Filtering is deterministic, score ordering reuses the
 * backend score, and category groups are ranked by their strongest/freshest
 * loaded moment. No scores, timestamps, or missing evidence are synthesized.
 */
export function buildLiveWireExplorerView<T extends LiveWireExplorerMoment>(
  input: readonly T[],
  options: {
    signal?: LiveWireExplorerSignal
    category?: string
    sort?: LiveWireExplorerSort
  } = {},
): LiveWireExplorerView<T> {
  const signal = options.signal ?? 'all'
  const category = options.category ?? 'all'
  const sort = options.sort ?? 'newest'

  const signalFiltered = signal === 'all'
    ? [...input]
    : input.filter((moment) => liveWireSignalForKind(moment.kind) === signal)
  const filtered = category === 'all'
    ? signalFiltered
    : signalFiltered.filter((moment) => liveWireCategoryKey(moment.category) === category)

  const categoryMap = new Map<string, LiveWireCategoryGroup<T>>()
  for (const moment of signalFiltered) {
    const key = liveWireCategoryKey(moment.category)
    const label = liveWireCategoryLabel(moment.category)
    const existing = categoryMap.get(key) ?? {
      key,
      label,
      momentCount: 0,
      channelCount: 0,
      peakScore: 0,
      latestAt: 0,
      moments: [],
    }
    existing.moments.push(moment)
    existing.momentCount += 1
    existing.peakScore = Math.max(existing.peakScore, finite(moment.score))
    existing.latestAt = Math.max(existing.latestAt, finite(moment.at))
    categoryMap.set(key, existing)
  }

  for (const group of categoryMap.values()) {
    group.channelCount = new Set(
      group.moments.map((moment) => moment.login?.trim().toLocaleLowerCase()).filter(Boolean),
    ).size
    group.moments.sort(newest)
  }

  const categories = [...categoryMap.values()].sort(categoryFacetOrder)
  const groups = categories
    .map((facet) => ({ ...facet, moments: facet.moments.filter((moment) => filtered.includes(moment)) }))
    .filter((group) => group.moments.length > 0)

  const moments = [...filtered]
  if (sort === 'strongest') moments.sort(strongest)
  else if (sort === 'category') {
    const categoryRank = new Map(categories.map((facet, index) => [facet.key, index]))
    moments.sort((a, b) => {
      const rank = (categoryRank.get(liveWireCategoryKey(a.category)) ?? Number.MAX_SAFE_INTEGER) -
        (categoryRank.get(liveWireCategoryKey(b.category)) ?? Number.MAX_SAFE_INTEGER)
      return rank || newest(a, b)
    })
  } else moments.sort(newest)

  return {
    moments,
    categories: categories.map(({ moments: _moments, ...facet }) => facet),
    groups,
    channelCount: new Set(
      moments.map((moment) => moment.login?.trim().toLocaleLowerCase()).filter(Boolean),
    ).size,
  }
}
