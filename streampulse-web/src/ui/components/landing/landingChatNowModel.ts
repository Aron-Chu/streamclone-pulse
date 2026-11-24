/**
 * Front page chat band, "Fastest chats" (board artifacts/chat-now-board-20261122, ★ 1A 2A 3A, 11-22).
 * Pure functions over the hub answer the page already reads; LandingChatNow draws them.
 *
 * - Rows, order and figures are the Hub's Busiest now (rankBusiest on the 30m answer's live channels),
 *   so the front page and the Hub never disagree and nothing is scored here.
 * - "Right now" only over five-minute counts the Hub would call Live (under 3 minutes old); older counts
 *   say when they stopped, and the recent average says it is one.
 * - Fewer than two ranked rows, or counts more than a day old (a cached answer): no band.
 * - Twitch's chat may load beside the list only where the session player may load Twitch's player.
 */
import type { PublicHub } from '../../../lib/publicHub'
import { busiestCue, hubChatBasis, hubClock, HUB_LIVE_MS, rankBusiest, type HubBusiestRow } from '../hub/v5/hubV5Model'

/** Rows at most (1A: the five busiest). */
export const CHAT_NOW_ROWS = 5
/** Rows needed for the band to show, as Top today's 7A. */
export const CHAT_NOW_MIN = 2
/** The page re-reads the hub this often while the tab is visible (about 54 KB compressed a read). */
export const CHAT_NOW_POLL_MS = 60_000
/** Counts older than this are yesterday's: no band. */
export const CHAT_NOW_MAX_AGE_MS = 24 * 60 * 60_000
/** A row must be pointed at this long before Twitch's chat loads (the session player's VOD_PREVIEW_SETTLE_MS). */
export const CHAT_PEEK_SETTLE_MS = 300
/** Twitch's chat that has not loaded by then gives way to the chat column (board option D). */
export const CHAT_PEEK_TIMEOUT_MS = 10_000
/** Twitch's page fires load before its chat has drawn: the frame fades in this long after (checked 11-22). */
export const CHAT_PEEK_DRAW_MS = 600
/** How long a new chat takes to fade in over the one before it (landing.css `.sl-cn-if` transition); then the old goes. */
export const CHAT_PEEK_FADE_MS = 300
/** The chat panel's own breakpoint: its 360 px sit beside the list. Touch screens this wide get the column only. */
export const CHAT_PEEK_WIDE_QUERY = '(min-width: 1024px)'
/** "Open the Hub". */
export const CHAT_NOW_HUB_HREF = '/analytics'
/**
 * Every bar's ticks move at this one speed (px a second); a busier chat gets closer ticks, so one tick passes a point
 * per counted message. A single slow speed never aliases at 60 fps, and the spacing, not the speed, tells the rows
 * apart (critique 11-22: equal stripes at different speeds read as a loading bar).
 */
export const CHAT_TICK_PX_PER_S = 120
/** Closest and widest tick spacing (px): closer than 4 px the 2 px ticks merge; past 96 px a slow bar looks empty. */
export const CHAT_TICK_GAP_MIN = 4
export const CHAT_TICK_GAP_MAX = 96
/** Lines a second at most in the chat panel's column; past it each line stands for several messages, and the caption says how many. */
export const CHAT_LINES_MAX_PER_S = 12
/** Lines the column holds (enough to fill it); the oldest goes as a new one comes in at the bottom. */
export const CHAT_COLUMN_LINES = 30
/** Emote squares on one line at most (a line with more is drawn with this many). */
export const CHAT_LINE_EMOTES_MAX = 4

export type ChatNowState = 'live' | 'stale' | 'average'

export interface ChatNowBand {
  rows: HubBusiestRow[]
  state: ChatNowState
  title: string
  sub: string
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const SUB_TAIL = 'in the live channels StreamPulse reads'

/** The band, or null when it should not show. `nowMs` is the page's clock. */
export function chatNowBand(hub: Pick<PublicHub, 'liveChannels' | 'generatedAt'> | null | undefined, nowMs: number): ChatNowBand | null {
  const live = hub?.liveChannels ?? []
  if (!live.length) return null
  const set = rankBusiest(live, CHAT_NOW_ROWS, hubChatBasis(live, '30m'))
  if (set.rows.length < CHAT_NOW_MIN) return null
  if (set.basis === 'avg_35') {
    // the average has no window of its own: the answer's time says how recent it is
    const at = Date.parse(hub?.generatedAt ?? '')
    if (finite(at) && nowMs - at > CHAT_NOW_MAX_AGE_MS) return null
    const asOf = finite(at) && nowMs - at > HUB_LIVE_MS ? ` as of ${hubClock(at)}` : ''
    return { rows: set.rows, state: 'average', title: 'Fastest chats', sub: `Chat messages per minute, recent average${asOf}, ${SUB_TAIL}` }
  }
  if (!finite(set.windowEnd) || nowMs - set.windowEnd > CHAT_NOW_MAX_AGE_MS) return null
  if (busiestCue(set, nowMs) === 'live') {
    return { rows: set.rows, state: 'live', title: 'Fastest chats right now', sub: `Chat messages per minute over the last 5 minutes, ${SUB_TAIL}` }
  }
  return { rows: set.rows, state: 'stale', title: 'Fastest chats', sub: `Chat messages per minute over 5 minutes, not updated since ${hubClock(set.windowEnd)}` }
}

/** The bar's width, % of the fastest row (never under 6 so a slow chat still shows a sliver). */
export function chatBarPct(perMin: number, maxPerMin: number): number {
  if (!finite(perMin) || !finite(maxPerMin) || maxPerMin <= 0) return 6
  return Math.max(6, Math.min(100, (perMin / maxPerMin) * 100))
}

/**
 * The bar's ticks: spacing in px and the seconds one spacing takes at CHAT_TICK_PX_PER_S, so a tick passes a point
 * once per counted message (7,200 / perMin px apart) between 75 and 1,800 messages a minute; outside that the spacing
 * stops at its limits. Null: no ticks (no rate).
 */
export function chatTicks(perMin: number): { gap: number; seconds: number } | null {
  if (!finite(perMin) || perMin <= 0) return null
  const gap = Math.max(CHAT_TICK_GAP_MIN, Math.min(CHAT_TICK_GAP_MAX, (CHAT_TICK_PX_PER_S * 60) / perMin))
  const rounded = Math.round(gap * 10) / 10
  return { gap: rounded, seconds: rounded / CHAT_TICK_PX_PER_S }
}

/** Messages each line of the column stands for (1 until the chat passes CHAT_LINES_MAX_PER_S a second). */
export function chatMessagesPerLine(perMin: number): number {
  if (!finite(perMin) || perMin <= 0) return 1
  return Math.max(1, Math.ceil(perMin / 60 / CHAT_LINES_MAX_PER_S))
}

/**
 * Emotes a message carries in a live channel's chat: its emote uses a minute (all providers) over its chat messages a
 * minute. From the screener's 5 minutes (the row figure's window whenever the band shows five-minute counts) when
 * both are ready there; otherwise from the channel's recent rates in the same record. 0 when neither has both. The hub has no emote pictures
 * per live channel, so the column draws these as blank squares.
 */
export function chatEmotesPerMessage(hub: Pick<PublicHub, 'liveChannels'> | null | undefined, login: string): number {
  const ch = hub?.liveChannels?.find((c) => c.login === login)
  if (!ch) return 0
  const s = ch.screenerV1
  const chat = s?.chat?.state === 'ready' ? s.chat.currentPerMin : null
  const emotes = s?.emotes?.state === 'ready' ? s.emotes.currentPerMin : null
  if (finite(chat) && chat > 0 && finite(emotes) && emotes >= 0) return emotes / chat
  if (!finite(ch.emotesPerMin) || !finite(ch.chatPerMin) || ch.chatPerMin <= 0 || ch.emotesPerMin <= 0) return 0
  return ch.emotesPerMin / ch.chatPerMin
}

/** The column's caption: what a bar and a square are. */
export function chatColumnLine(perMin: number, emotesPerMessage: number): string {
  const n = chatMessagesPerLine(perMin)
  const bar = n === 1 ? 'Each bar is one message we counted' : `Each bar is ${n.toLocaleString('en-US')} messages we counted`
  const square = emotesPerMessage > 0 ? ', each square an emote' : ''
  return `${bar}${square}. We don’t keep the words.`
}

/** Twitch's chat for a channel, dark, for this page's host (Twitch refuses an embed without the right parent). */
export function twitchChatEmbedUrl(login: string, hostname: string): string {
  return `https://www.twitch.tv/embed/${encodeURIComponent(login)}/chat?parent=${encodeURIComponent(hostname)}&darkpopout`
}

/** A mouse or trackpad on a window wide enough for the panel. */
const CHAT_PEEK_QUERY = '(min-width: 1024px) and (pointer: fine)'

/**
 * Twitch's chat may load: a desktop pointer, and no data saver (Save-Data, or prefers-reduced-data).
 * The same rule as the session player's vodAutoPreviewAllowed (packages/analytics-console MomentVodPanel.tsx),
 * restated here because public pages may not import that package (vite.config.ts public-entry boundary).
 */
export function chatPeekAllowed(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false
  const connection = (win.navigator as Navigator & { connection?: { saveData?: boolean } } | undefined)?.connection
  if (connection?.saveData) return false
  if (win.matchMedia('(prefers-reduced-data: reduce)')?.matches) return false
  return Boolean(win.matchMedia(CHAT_PEEK_QUERY)?.matches)
}

export function subscribeChatPeek(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(CHAT_PEEK_QUERY)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}
