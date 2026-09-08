/** Presentation-only filtering of loaded records. Never expands backend coverage. */
export type MomentPeriod = 'all' | '30m' | '24h' | '7d' | 'custom'
export type MomentOrder = 'newest' | 'oldest' | 'category' | 'chatPerMin' | 'emotesPerMin' | 'chatIncrease' | 'emoteIncrease'
export interface MomentBrowse {
  category: string
  query: string
  period: MomentPeriod
  order: MomentOrder
  from: string
  to: string
}
export interface BrowseFields { at?: number; category?: string; text: string; key: string; chatPerMin?: number; emotesPerMin?: number; chatIncrease?: number; emoteIncrease?: number }

/** Neighbors in the displayed collection, not a ranking or a nearest-time match. */
export function loadedMomentNeighbors<T extends { key: string }>(items: readonly T[], selectedKey?: string) {
  const index = selectedKey ? items.findIndex(item => item.key === selectedKey) : -1
  const exact = index >= 0 && items.findIndex((item, i) => i > index && item.key === selectedKey) < 0
  return { position: exact ? index + 1 : null, total: items.length,
    previous: exact && index > 0 ? items[index - 1] : undefined,
    next: exact && index + 1 < items.length ? items[index + 1] : undefined }
}

export function readMomentBrowse(params: URLSearchParams): MomentBrowse {
  const period = params.get('occurred')
  const order = params.get('sort')
  return { category: params.get('category') || '', query: (params.get('q') || '').slice(0, 200),
    period: period === '30m' || period === '24h' || period === '7d' || period === 'custom' ? period : 'all',
    order: order === 'oldest' || order === 'category' || order === 'chatPerMin' || order === 'emotesPerMin' || order === 'chatIncrease' || order === 'emoteIncrease' ? order : 'newest',
    from: params.get('from') || '', to: params.get('to') || '' }
}

function day(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null
}
export function browseRangeError(browse: MomentBrowse): string | null {
  if (browse.period !== 'custom') return null
  const from = day(browse.from), to = day(browse.to)
  if (from == null || to == null) return 'Choose valid From and Through dates (UTC).'
  return from > to ? 'From must be on or before Through.' : null
}

export function browseLoadedItems<T>(items: readonly T[], browse: MomentBrowse, fields: (item: T) => BrowseFields, now: number): T[] {
  if (browseRangeError(browse)) return []
  const min = browse.period === 'custom' ? day(browse.from)! : browse.period === 'all' ? -Infinity
    : now - ({ '30m': 30 * 60_000, '24h': 86_400_000, '7d': 7 * 86_400_000 } as const)[browse.period]
  const max = browse.period === 'custom' ? day(browse.to)! + 86_400_000 : now
  const query = browse.query.trim().toLocaleLowerCase()
  return items.map(item => ({ item, ...fields(item) })).filter(row => {
    const hasTime = row.at != null && Number.isFinite(row.at)
    const timeMatch = browse.period === 'all' || (hasTime && row.at! >= min && (browse.period === 'custom' ? row.at! < max : row.at! <= max))
    return timeMatch && (!browse.category || row.category === browse.category) && (!query || row.text.toLocaleLowerCase().includes(query))
  }).sort((a, b) => {
    if (browse.order === 'chatPerMin' || browse.order === 'emotesPerMin' || browse.order === 'chatIncrease' || browse.order === 'emoteIncrease') {
      const left = a[browse.order], right = b[browse.order]
      const hasLeft = left != null && Number.isFinite(left), hasRight = right != null && Number.isFinite(right)
      if (hasLeft !== hasRight) return hasLeft ? -1 : 1
      if (hasLeft && hasRight && left !== right) return right! - left!
    }
    if (browse.order === 'category') {
      const category = (a.category || '\uffff').localeCompare(b.category || '\uffff')
      if (category) return category
    }
    const left = a.at != null && Number.isFinite(a.at) ? a.at : null
    const right = b.at != null && Number.isFinite(b.at) ? b.at : null
    if (left == null || right == null) return left == null && right == null ? a.key.localeCompare(b.key) : left == null ? 1 : -1
    return (browse.order === 'oldest' ? left - right : right - left) || a.key.localeCompare(b.key)
  }).map(row => row.item)
}
