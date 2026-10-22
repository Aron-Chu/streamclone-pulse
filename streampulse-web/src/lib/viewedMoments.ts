/**
 * Viewed (Aron's V1 pick, 2026-10-21): the moments you opened on the Moments
 * page, newest first, kept in this browser for 30 days. Nothing is sent: the
 * list is this browser's alone, and sign-out clears it with the other local
 * copies (O1). Each entry keeps the whole moment, so one can still be drawn
 * after it leaves the 12-hour feed.
 */
import { isMomentsFeedItem, type MomentsFeedItem } from './momentsFeed'

export const VIEWED_KEY = 'sp-moments-viewed'
export const VIEWED_DAYS = 30
const VIEWED_MAX = 100
const VIEWED_MS = VIEWED_DAYS * 86_400_000

export interface ViewedMoment { at: number; item: MomentsFeedItem }

/** The kept moments, newest opened first; anything past 30 days is dropped. */
export function readViewed(now = Date.now()): ViewedMoment[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(VIEWED_KEY) || '[]')
    return (Array.isArray(raw) ? raw : [])
      .filter((e): e is ViewedMoment => typeof e?.at === 'number' && e.at > now - VIEWED_MS && isMomentsFeedItem(e.item))
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

function writeViewed(list: ViewedMoment[]) {
  try { window.localStorage.setItem(VIEWED_KEY, JSON.stringify(list)) } catch { /* private window or full: this visit only */ }
}

/** Puts a moment at the top as opened now, and returns the new list. */
export function recordViewed(item: MomentsFeedItem, now = Date.now()): ViewedMoment[] {
  const list = [{ at: now, item }, ...readViewed(now).filter(e => e.item.id !== item.id)].slice(0, VIEWED_MAX)
  writeViewed(list)
  return list
}

export function clearViewed(): void {
  try { window.localStorage.removeItem(VIEWED_KEY) } catch { /* Nothing to clear. */ }
}
