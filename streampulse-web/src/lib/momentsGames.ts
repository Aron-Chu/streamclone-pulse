import { isExactCategoryBoxArt } from './momentCategoryArtwork'
import type { CheckedMoment } from './momentsChecked'
import type { MomentsFeedCategoryFacet } from './momentsFeed'

/**
 * The Moments page's Games tab (B2, 2026-10-22: Twitch's Browse → Categories,
 * big covers). A game's count is the moments Latest shows for it (all but the
 * ones that don't hold up) among those the page holds, so a card says what its
 * list will show; the feed's own facet counts include those that don't hold up.
 * "N live" is the feed's count of the game's live channels (facets.categories),
 * left out for a game the facets don't list (past their 24).
 */
export interface MomentsGame {
  id: string
  name: string
  /** A Twitch cover, sized for a big card; null when neither the facets nor a moment send an exact one. */
  art: string | null
  moments: number
  live: number | null
}

/** A cover 285 × 380, so a card about 150 px wide stays sharp. */
export function momentsGameArt(url: string | undefined, id: string): string | null {
  return url && isExactCategoryBoxArt(url, id) ? url.replace(/-\d+x\d+\.(jpe?g|png|webp)$/i, '-285x380.$1') : null
}

/** The games in what Latest shows, most moments first, then by name. */
export function momentsGames(pool: readonly CheckedMoment[], facets: readonly MomentsFeedCategoryFacet[] | null): MomentsGame[] {
  const byId = new Map((facets ?? []).map(f => [f.id, f]))
  const games = new Map<string, MomentsGame>()
  for (const m of pool) {
    const cat = m.item.category
    if (!cat || m.item.verdict === 'bad') continue
    const game = games.get(cat.id)
    if (game) {
      game.moments += 1
      game.art ??= momentsGameArt(cat.boxArtUrl, cat.id)
      continue
    }
    const facet = byId.get(cat.id)
    games.set(cat.id, {
      id: cat.id,
      name: cat.name,
      art: momentsGameArt(facet?.boxArtUrl, cat.id) ?? momentsGameArt(cat.boxArtUrl, cat.id),
      moments: 1,
      live: facet ? facet.liveChannels : null,
    })
  }
  return [...games.values()].sort((a, b) => b.moments - a.moments || a.name.localeCompare(b.name))
}

/** A game's name and cover for the bar's chip, from the moments held (any list) or the facets; null when neither has it. */
export function momentsGameLabel(id: string, items: readonly CheckedMoment[], facets: readonly MomentsFeedCategoryFacet[] | null): { name: string; art: string | null } | null {
  const cat = items.find(m => m.item.category?.id === id)?.item.category
  const facet = facets?.find(f => f.id === id)
  const name = cat?.name ?? facet?.name
  return name ? { name, art: momentsGameArt(facet?.boxArtUrl, id) ?? momentsGameArt(cat?.boxArtUrl, id) } : null
}
