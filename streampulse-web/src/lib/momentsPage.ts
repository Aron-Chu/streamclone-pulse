import type { DiscoveryMoment } from './discoveryMoments'
import { isExactCategoryBoxArt } from './momentCategoryArtwork'
import { loadedCategories } from '../ui/components/moments/MomentCategoryBrowser'

/**
 * The Moments page's Latest list, from the hub's moments (11-02 deep audit,
 * 4A). Latest leaves out a stream's first 5 minutes (the hello spike, as the
 * hub's rail does since 10-27) and a minute that rose under 1.2× the stream's
 * earlier average on both chat and emotes ("0.41× Emote spike"). A row with
 * no comparison stays: there is nothing to judge it by.
 */
export const MOMENTS_START_SECONDS = 5 * 60
export const MOMENTS_MIN_X = 1.2

/** The strongest ready × (chat or emotes), or null when the hub sent no comparison to judge by. */
function bestLift(moment: Pick<DiscoveryMoment, 'comparison'>): number | null {
  let best: number | null = null
  for (const metric of [moment.comparison?.chat, moment.comparison?.emotes]) {
    if (!metric) continue
    // New from a zero average: it rose, however small the numbers.
    if (metric.state === 'new_activity') return Infinity
    if (metric.state === 'ready' && metric.multiplier != null && Number.isFinite(metric.multiplier)) best = Math.max(best ?? 0, metric.multiplier)
  }
  return best
}

/** Whether Latest lists this moment (see the top of this file). */
export function shownOnMomentsPage(moment: Pick<DiscoveryMoment, 'offsetSeconds' | 'comparison'>): boolean {
  if (!(moment.offsetSeconds >= MOMENTS_START_SECONDS)) return false
  const lift = bestLift(moment)
  return lift == null || lift >= MOMENTS_MIN_X
}

/**
 * The open moment's × line in the C1 card's words (10-22): "3.7× more emotes
 * than this stream's earlier average". The detector's own signal first, then
 * the other one that rose; nothing when neither rose.
 */
export function momentLiftLine(moment: Pick<DiscoveryMoment, 'comparison' | 'reactionSignal'>): { x: string; what: string } | null {
  const order = moment.reactionSignal === 'emotes'
    ? [['emotes', moment.comparison?.emotes], ['chat', moment.comparison?.chat]] as const
    : [['chat', moment.comparison?.chat], ['emotes', moment.comparison?.emotes]] as const
  for (const [what, metric] of order) {
    // "1.0× more" would claim a rise that rounds away; such a minute keeps the plain summary.
    if (metric?.state !== 'ready' || metric.multiplier == null || !Number.isFinite(metric.multiplier) || metric.multiplier < 1.05) continue
    // 9.95–9.99 rounds to ten, so it reads "10×", not "10.0×"
    return { x: `${metric.multiplier.toFixed(metric.multiplier >= 9.95 ? 0 : 1)}×`, what }
  }
  return null
}

/** A game on the covers row: its name (the page's `category` filter), a Twitch cover when one is exact, and its moments. */
export interface MomentsGame {
  name: string
  categoryId?: string
  art: string | null
  moments: number
}

/** A cover 285 × 380, so a card about 112 px wide stays sharp at 2×. */
function coverArt(url: string | undefined, id: string | undefined): string | null {
  if (!url) return null
  const sized = url.replace(/-\d+x\d+\.(jpe?g|png|webp)$/i, '-285x380.$1')
  // a supplied cover must stay Twitch's own box art for its id; the name-only fallbacks have no id to check
  return !id || isExactCategoryBoxArt(sized, id) ? sized : null
}

/** The games in a list, most moments first, then by name (M1, 10-22: the games on top). */
export function momentsGames(moments: ReadonlyArray<Pick<DiscoveryMoment, 'category' | 'categoryId' | 'boxArtUrl' | 'categoryMetadataRejected'>>): MomentsGame[] {
  return loadedCategories(moments)
    .map(c => ({ name: c.name, categoryId: c.categoryId, art: coverArt(c.boxArtUrl, c.categoryId), moments: c.count }))
    .sort((a, b) => b.moments - a.moments || a.name.localeCompare(b.name))
}

/** A game's name from its Twitch id (the hub's "?game=" links), from the moments held; null when none has it. */
export function momentsGameName(id: string, moments: ReadonlyArray<Pick<DiscoveryMoment, 'category' | 'categoryId'>>): string | null {
  return moments.find(m => m.categoryId === id && m.category)?.category ?? null
}
