/**
 * Covers for the games Twitch's by-name box art does not know (a new game gets
 * its grey "?" cover; Where chat is, 11-02). A live stream's own game list
 * (loadCategoryArtwork) has the game's exact cover by its id. The hub's
 * GameArt asks here only once a by-name cover has proved to be the
 * placeholder, so most games never cost a read. Reads go one at a time, at
 * most GAME_ART_STREAMS a game and GAME_ART_READS a page load. What they find
 * is kept in localStorage, a cover for 7 days and a miss for 6 hours (30
 * minutes when the reads found nothing at all, which may be failed reads).
 */
import { loadCategoryArtwork } from './momentCategoryArtwork'

export const GAME_ART_KEY = 'sp:gameArt:v1'
export const GAME_ART_READS = 12
/** Streams a game is looked up in at most. */
export const GAME_ART_STREAMS = 3
const FOUND_MS = 7 * 24 * 60 * 60_000
const MISS_MS = 6 * 60 * 60_000
const EMPTY_MS = 30 * 60_000
const KEEP = 200
const COVER = /^https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\/\d{1,20}(?:_IGDB)?-\d+x\d+\.(?:jpe?g|png|webp)$/i

type Entry = { url: string | null; until: number }
let kept: Record<string, Entry> | null = null
const listeners = new Set<() => void>()
const asked = new Set<string>()
let reads = 0
let queue: Promise<void> = Promise.resolve()

function entries(): Record<string, Entry> {
  if (kept) return kept
  kept = {}
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(GAME_ART_KEY) || '{}')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [name, e] of Object.entries(raw as Record<string, Partial<Entry>>)) {
        if (e && typeof e.until === 'number' && (e.url === null || (typeof e.url === 'string' && COVER.test(e.url)))) kept[name] = { url: e.url, until: e.until }
      }
    }
  } catch {
    // storage blocked or garbled: nothing kept
  }
  return kept
}

function save(all: Record<string, Entry>) {
  const now = Date.now()
  const live = Object.entries(all).filter(([, e]) => e.until > now).sort((a, b) => b[1].until - a[1].until).slice(0, KEEP)
  kept = Object.fromEntries(live)
  try {
    window.localStorage.setItem(GAME_ART_KEY, JSON.stringify(kept))
  } catch {
    // storage blocked or full: kept for this page load only
  }
}

/** A game's kept cover: its URL, null for a known miss, undefined when nothing is kept. */
export function gameArtFor(name: string): string | null | undefined {
  const e = entries()[name]
  return e && e.until > Date.now() ? e.url : undefined
}

export function subscribeGameArt(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Look the game's cover up in the game lists of streams playing it, the first
 * GAME_ART_STREAMS of `streamIds` until one has it (a stream's list can lag its
 * live category by a while), once a page load, after the reads queued before it.
 */
export function askGameArt(name: string, streamIds: readonly (string | null | undefined)[]): void {
  const ids = [...new Set(streamIds.filter((id): id is string => !!id))].slice(0, GAME_ART_STREAMS)
  if (!ids.length || asked.has(name) || reads >= GAME_ART_READS || gameArtFor(name) !== undefined) return
  asked.add(name)
  queue = queue.then(async () => {
    // only the game asked about: a list's other games may have a by-name cover its ids lack
    let url: string | null = null
    let any = false
    for (const id of ids) {
      if (url || reads >= GAME_ART_READS) break
      reads += 1
      const found = await loadCategoryArtwork(id)
      any ||= found.size > 0
      const art = found.get(name)?.boxArtUrl
      if (art && COVER.test(art)) url = art
    }
    keep(name, url ? { url, until: Date.now() + FOUND_MS } : { url: null, until: Date.now() + (any ? MISS_MS : EMPTY_MS) })
  }).catch(() => {})
}

/** A looked-up cover that proved to be Twitch's "?" placeholder (an id Twitch has no cover for): a miss. */
export function missGameArt(name: string): void {
  keep(name, { url: null, until: Date.now() + MISS_MS })
}

function keep(name: string, entry: Entry) {
  save({ ...entries(), [name]: entry })
  listeners.forEach((l) => l())
}

/** Test helper: forget this page load's reads and what was kept. */
export function resetGameArtForTests(): void {
  kept = null
  asked.clear()
  reads = 0
  queue = Promise.resolve()
}
