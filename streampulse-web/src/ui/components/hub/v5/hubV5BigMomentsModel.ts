/**
 * Chat's big moments (C1, 11-01; board artifacts/top-emotes-perf-board-20261031):
 * the stage carousel above Top emotes, one moment at a time with its
 * neighbours peeking. Its cards are Top moments today's rows (hubV5TopModel:
 * the Moments list's moments that hold up and rose, else the hub's ready × of
 * 1.5 or more on streams live now), in that order, strongest first, one card
 * per channel: a channel's later rows only add to its "+N more today". Pure
 * functions; HubV5BigMoments draws them.
 */
import { fx } from '../../../../lib/momentsChecked'
import type { TopRowData } from './hubV5TopModel'

/** Cards at most: ten dots fit a phone's nav, and one loop stays about a minute. */
export const BIG_CARDS = 10
/** A horizontal drag this long (px), longer than it is tall, turns the page. */
export const BIG_SWIPE_PX = 40

export interface BigCard {
  row: TopRowData
  /** The channel's other moments in the list. */
  more: number
}

/** One card per channel, in the list's order, at most `max`; a channel's later rows count as its "+N more". */
export function bigMomentCards(rows: readonly TopRowData[], max = BIG_CARDS): BigCard[] {
  const cards: BigCard[] = []
  const byLogin = new Map<string, BigCard>()
  for (const row of rows) {
    const had = byLogin.get(row.login)
    if (had) {
      had.more += 1
      continue
    }
    if (cards.length >= max) continue
    const card = { row, more: 0 }
    byLogin.set(row.login, card)
    cards.push(card)
  }
  return cards
}

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
