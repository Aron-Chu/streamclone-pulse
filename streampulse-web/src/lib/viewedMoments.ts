/**
 * Viewed (Aron's V1 pick, 2026-10-21): the moments you opened on the Moments
 * page, newest first, kept in this browser for 30 days. Nothing is sent: the
 * list is this browser's alone. Each entry keeps the moment's id, when it was opened and
 * a small card in a save's format (V1, 10-30), so its row can still be drawn after it leaves the feed.
 */
import type { DiscoveryMoment } from './discoveryMoments'
import { parseSavedMoment, savedMomentRecord, type SavedMoment } from './savedDiscoveryMoments'

export const VIEWED_KEY = 'sp-moments-viewed'
export const VIEWED_DAYS = 30
export const VIEWED_MAX = 100
const VIEWED_MS = VIEWED_DAYS * 86_400_000

export interface ViewedMoment { id: string; at: number; card: SavedMoment }

/** The kept moments, newest opened first; anything past 30 days, or kept whole before the cards, is dropped. */
export function readViewed(now = Date.now()): ViewedMoment[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(VIEWED_KEY) || '[]')
    return (Array.isArray(raw) ? raw : []).flatMap((e): ViewedMoment[] => {
      const card = typeof e?.id === 'string' && typeof e.at === 'number' && e.at > now - VIEWED_MS ? parseSavedMoment(e.card) : null
      return card ? [{ id: e.id, at: e.at, card }] : []
    }).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

function writeViewed(list: ViewedMoment[]) {
  try { window.localStorage.setItem(VIEWED_KEY, JSON.stringify(list)) } catch { /* private window or full: this visit only */ }
}

/**
 * Puts a moment at the top as opened now, and returns the new list. Its card keeps just what its row draws (name, game,
 * ×, time): no rates or top emotes, which no Viewed row reads.
 */
export function recordViewed(id: string, moment: DiscoveryMoment & { multiplier?: number }, now = Date.now()): ViewedMoment[] {
  const card = savedMomentRecord({ ...moment, chatPerMin: undefined, emotesPerMin: undefined, measurementScope: undefined, topEmotes: undefined }, now)
  const list = [{ id, at: now, card }, ...readViewed(now).filter(e => e.id !== id)].slice(0, VIEWED_MAX)
  writeViewed(list)
  return list
}

/** Drops what is past 30 days (or kept whole before the cards) from this browser, not just from the list read. */
export function pruneViewed(now = Date.now()): void {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(VIEWED_KEY) || '[]')
    const kept = readViewed(now)
    if (Array.isArray(raw) && kept.length === raw.length) return
    if (kept.length) writeViewed(kept)
    else window.localStorage.removeItem(VIEWED_KEY)
  } catch { /* unreadable: readViewed reads it as empty, and the next open writes over it */ }
}

export function clearViewed(): void {
  try { window.localStorage.removeItem(VIEWED_KEY) } catch { /* Nothing to clear. */ }
}
