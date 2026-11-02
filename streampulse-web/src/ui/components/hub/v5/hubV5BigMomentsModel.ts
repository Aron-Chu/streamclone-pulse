/**
 * Chat's big moments (C1, 11-01; board artifacts/top-emotes-perf-board-20261031):
 * the stage carousel above Top emotes, one moment at a time with its
 * neighbours peeking. Its cards are Top moments today's rows (hubV5TopModel:
 * the Moments list's moments that hold up and rose, else the hub's ready × of
 * 1.5 or more on streams live now), in that order, strongest first, one card
 * per moment (11-02: was one per channel, which left 3 cards from the hub's
 * ten). Pure functions; HubV5BigMoments draws them.
 */
import { fx } from '../../../../lib/momentsChecked'
import type { TopRowData } from './hubV5TopModel'

/** Cards at most: ten dots fit a phone's nav, and one loop stays about a minute. */
export const BIG_CARDS = 10
/** A horizontal drag this long (px), longer than it is tall, turns the page. */
export const BIG_SWIPE_PX = 40
/** A sideways wheel gesture (a trackpad swipe, or shift and the wheel) this long (px) turns the page. */
export const BIG_WHEEL_PX = 50
/** A wheel at rest this long (ms) ends its gesture: a trackpad's glide after a turn turns nothing more. */
export const BIG_WHEEL_QUIET_MS = 180

export interface BigCard {
  row: TopRowData
}

/** One card per moment, in the list's order, at most `max`. */
export function bigMomentCards(rows: readonly TopRowData[], max = BIG_CARDS): BigCard[] {
  return rows.slice(0, max).map((row) => ({ row }))
}

/** A wheel gesture's state: its sideways deltas so far, when the last came, and whether it has turned a page. */
export interface BigWheel {
  sum: number
  last: number
  spent: boolean
}
export const bigWheel = (): BigWheel => ({ sum: 0, last: -Infinity, spent: false })

/**
 * One sideways wheel gesture turns one page: its deltas add up to BIG_WHEEL_PX,
 * then the rest of it, the glide included, turns nothing until the wheel rests
 * BIG_WHEEL_QUIET_MS. 1 is the next card, -1 the one before, 0 none.
 */
export function bigWheelTurn(w: BigWheel, dx: number, t: number): -1 | 0 | 1 {
  if (t - w.last > BIG_WHEEL_QUIET_MS) {
    w.sum = 0
    w.spent = false
  }
  w.last = t
  if (w.spent || !dx) return 0
  w.sum += dx
  if (Math.abs(w.sum) < BIG_WHEEL_PX) return 0
  w.spent = true
  return w.sum > 0 ? 1 : -1
}

/** How far the cards follow a drag (px): with it, at most half the stage either way. */
export const bigDragPx = (dx: number, width: number) => Math.max(-width / 2, Math.min(width / 2, dx))

export type BigCardPos = -2 | -1 | 0 | 1 | 2 | 'far'

/** Where card `k` sits while card `at` is in front: steps the short way round, or 'far' past two. */
export function bigCardPos(k: number, at: number, n: number): BigCardPos {
  if (n < 2) return 0
  let d = (((k - at) % n) + n) % n
  if (d > n / 2) d -= n
  return Math.abs(d) <= 2 ? (d as BigCardPos) : 'far'
}

export const bigSpike = (kind: TopRowData['kind']) => (kind === 'emotes' ? 'Emote spike' : 'Chat spike')

/** "42 min into the stream", "2 h 5 min into the stream"; null without a minute in. */
export function bigIntoStream(offsetSeconds: number | null | undefined): string | null {
  if (offsetSeconds == null || !Number.isFinite(offsetSeconds)) return null
  const m = Math.round(offsetSeconds / 60)
  if (m < 1) return null
  return m < 60 ? `${m} min into the stream` : `${Math.floor(m / 60)} h ${m % 60} min into the stream`
}

export interface BigMeter {
  now: number
  usual: number
  /** Bar widths, % of the larger. */
  nowPct: number
  usualPct: number
}

/** The moment's rate a minute against the usual its × compares it with; null when either is missing. */
export function bigMeter(row: Pick<TopRowData, 'rate' | 'usual'>): BigMeter | null {
  const { rate, usual } = row
  if (rate == null || usual == null || !Number.isFinite(rate) || !Number.isFinite(usual) || rate <= 0 || usual < 0) return null
  const max = Math.max(rate, usual)
  const pct = (v: number) => Math.round((1000 * v) / max) / 10
  return { now: rate, usual, nowPct: pct(rate), usualPct: pct(usual) }
}

const TWITCH_V2 = /^(https:\/\/static-cdn\.jtvnw\.net\/emoticons\/v2\/[^/?#]+\/)default\//

/**
 * The still frame of a Twitch emote: Twitch serves every v2 emote at /static/
 * as well as /default/. Other URLs come back as they are: 7TV's still file
 * exists only for animated emotes, so a still emote's would 404.
 */
export function bigStillEmote(url: string): string
export function bigStillEmote(url: string | undefined): string | undefined
export function bigStillEmote(url: string | undefined): string | undefined {
  return url ? url.replace(TWITCH_V2, '$1static/') : url
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
/** "5.6K" watching. */
export const bigViewers = (n: number) => COMPACT.format(n)

/** A slide's label: its place, who and what rose. */
export function bigSlideLabel(row: Pick<TopRowData, 'name' | 'kind' | 'x'>, i: number, n: number): string {
  return `${i + 1} of ${n}: ${row.name}, ${bigSpike(row.kind).toLowerCase()}, ${fx(row.x).replace('×', ' times')} usual ${row.kind}`
}

/** The channel on Twitch, for a stream still live. */
export const bigWatchHref = (login: string) => `https://www.twitch.tv/${encodeURIComponent(login)}`
