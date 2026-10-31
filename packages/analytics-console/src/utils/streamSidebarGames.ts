import type { AnalyticsStream } from '../apiTypes.ts'

/**
 * Games in a stream-list row (GP-4, candidate, 10-30). The list API sends a
 * row's games only as one joined `gamesSummary` string plus the row's main
 * `category`/`categoryId`; it has no per-game ids or art. Covers come from ids
 * the list itself already carries, with no extra requests.
 */

/** The backend joins names with exactly this (gamesSummaryFromSegments). "and Roger" is a real game, so never split on words. */
export const GAMES_SUMMARY_SEPARATOR = ' · '
/** Covers a list row shows before "+N". */
export const SIDEBAR_GAME_COVER_LIMIT = 3

export interface SidebarGame {
  /** As Twitch writes it; never re-cased. */
  name: string
  /** Twitch category id when the list maps this exact name to one id; else the row shows initials. */
  categoryId?: string
}

function validCategoryId(raw: string | undefined): string | undefined {
  const id = raw?.trim()
  return id && /^\d{1,20}$/.test(id) ? id : undefined
}

/**
 * Exact name → category id from the rows' own `category`/`categoryId`. A name
 * seen with two different ids is left out: a cover found through another row
 * is a lookup, not this stream's data, so an ambiguous one shows initials.
 */
export function sidebarCategoryIdsByName(streams: readonly AnalyticsStream[]): ReadonlyMap<string, string> {
  const seen = new Map<string, string | null>()
  for (const stream of streams) {
    const name = stream.category?.trim()
    const id = validCategoryId(stream.categoryId)
    if (!name || !id) continue
    const known = seen.get(name)
    if (known === undefined) seen.set(name, id)
    else if (known !== id) seen.set(name, null)
  }
  const ids = new Map<string, string>()
  for (const [name, id] of seen) if (id) ids.set(name, id)
  return ids
}

/** A row's games in the order the backend sent them, each with an id only when it is known exactly. */
export function sidebarStreamGames(
  stream: Pick<AnalyticsStream, 'gamesSummary' | 'category' | 'categoryId'>,
  idsByName: ReadonlyMap<string, string>,
): SidebarGame[] {
  const summary = stream.gamesSummary?.trim()
  const names = summary ? summary.split(GAMES_SUMMARY_SEPARATOR) : [stream.category ?? '']
  const ownName = stream.category?.trim()
  const ownId = validCategoryId(stream.categoryId)
  const games: SidebarGame[] = []
  const keys = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    // The backend already drops repeats case-insensitively; kept here for older rows.
    const key = name.toLowerCase()
    if (!name || keys.has(key)) continue
    keys.add(key)
    // The row's own category pair is this stream's data; other names borrow the list's map.
    const categoryId = name === ownName && ownId ? ownId : idsByName.get(name)
    games.push(categoryId ? { name, categoryId } : { name })
  }
  return games
}
