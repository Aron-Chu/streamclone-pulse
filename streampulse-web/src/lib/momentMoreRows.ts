/**
 * "More from {channel}" and "More {game} Moments" under a Moment page's "More Moments from this stream":
 * which other Moments the two sections list. Pure: the page reads the channel's streams and their recaps
 * (momentReads, shared) and the Moments list's hub snapshot, and hands the answers here.
 *
 * A row is only a Moment the Moments list would show (shownOnMomentsPage: never a stream's first five
 * minutes, never a minute that rose under 1.2×). The channel section never lists the Moment's own stream;
 * the game section never lists the Moment's own channel, and one Moment per channel at most.
 */
import type { ArchiveArtwork } from './archiveArtwork'
import { lookupDay } from './channelLookup'
import type { MomentRecapAnswer } from './discoveryMomentRecap'
import { fromHubMoment, uniqueDiscoveryMoments, type DiscoveryMoment } from './discoveryMoments'
import { resolveLivePulseMoments } from './figmaSessionAnalytics'
import { categorySegmentAt, momentGameArtUrl, type CategorySegment } from './momentCategoryArtwork'
import { momentAtKey, momentMinuteAt, type MomentAtKey } from './momentFeedback'
import { momentEntryKey } from './momentPageFlag'
import { isMomentStreamId } from './momentReads'
import { shownOnMomentsPage } from './momentsPage'
import type { PublicHub } from './publicHub'

/** Rows per section. */
export const MORE_ROWS_MAX = 3
/** The channel's other streams whose recaps are read: one recap each, so the reads stay bounded. */
export const MORE_STREAMS_READ = 2

/** The Moment the page shows: its stream, its channel and its minute. */
export interface MoreCurrent { streamId: string; login: string; momentAt: MomentAtKey }

/** The game at the Moment's minute: its Twitch category id when the stream's game segments name one. */
export interface MomentGame { name: string; categoryId: string | null }

/** One of the channel's other streams, as its streams list names it. */
export interface ChannelStream { streamId: string; startedAt: string; displayName?: string; category?: string }

export interface MoreRow {
  streamId: string
  /** The row's Moment page minute, and with `streamId` its identity. */
  momentAt: MomentAtKey
  /** An absolute time in that minute (ms), for the hand-over and the warm (momentEntryKey(at) === momentAt). */
  at: number
  offsetSeconds: number
  login: string
  displayName?: string
  category?: string
  profileImageUrl?: string
  /** The muted line under the title: the stream's day (channel), the channel's name (game). */
  note: string
  /** The stream's verified thumbnail, when the data already carries it. */
  artwork?: ArchiveArtwork
  /** Twitch's own cover for the row's game, when the data names it exactly. */
  gameArt?: { url: string; gameName: string }
}

const instantMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value || value.length > 40) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}
const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : undefined

/**
 * The game at the Moment's minute: the stream's game segment there, else the stream's category as the
 * stream route names it (no id). Null when neither names one.
 */
export function momentGameAt(segments: readonly CategorySegment[], offsetSeconds: number, streamCategory: string): MomentGame | null {
  const segment = categorySegmentAt(segments, offsetSeconds)
  const named = segment ? text(segment.gameName, 200) : undefined
  if (segment && named) return { name: named, categoryId: segment.categoryId }
  const name = text(streamCategory, 200)
  return name ? { name, categoryId: null } : null
}

/** The same game: by Twitch category id when both have a trusted one, else by name. */
function sameGame(game: MomentGame, moment: Pick<DiscoveryMoment, 'category' | 'categoryId' | 'categoryMetadataRejected'>): boolean {
  if (game.categoryId && moment.categoryId && !moment.categoryMetadataRejected) return game.categoryId === moment.categoryId
  const name = text(moment.category, 200)
  return !!name && name.toLowerCase() === game.name.toLowerCase()
}

/**
 * The channel's other streams whose recaps are read, from its streams list (`items` as the route
 * answered): newest first, never the Moment's own stream, at most `max`. A malformed item is left out.
 */
export function otherChannelStreams(items: unknown, currentStreamId: string, max = MORE_STREAMS_READ): ChannelStream[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>([currentStreamId])
  const streams: Array<ChannelStream & { startedMs: number }> = []
  for (const item of items.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue
    const { streamId, startedAt, displayName, category } = item as Record<string, unknown>
    const startedMs = instantMs(startedAt)
    if (!isMomentStreamId(streamId) || seen.has(streamId) || startedMs === null) continue
    seen.add(streamId)
    streams.push({ streamId, startedAt: startedAt as string, startedMs, displayName: text(displayName, 100), category: text(category, 200) })
  }
  return streams.sort((a, b) => b.startedMs - a.startedMs).slice(0, Math.max(0, max))
    .map(({ streamId, startedAt, displayName, category }) => ({ streamId, startedAt, displayName, category }))
}

/** A recap's Moments for one stream, in rank order: only a recap that names this channel and stream, each minute once. */
function recapRows(current: MoreCurrent, stream: ChannelStream, recap: MomentRecapAnswer | null | undefined, nowMs: number): MoreRow[] {
  const startedMs = instantMs(stream.startedAt)
  if (startedMs === null || !recap || typeof recap.login !== 'string' || recap.login.toLowerCase() !== current.login
    || recap.streamId !== stream.streamId || !Array.isArray(recap.topMoments)) return []
  const seen = new Set<MomentAtKey>()
  const rows: MoreRow[] = []
  for (const row of recap.topMoments) {
    const offsetSeconds = row?.offsetSeconds
    if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) continue
    if (!shownOnMomentsPage({ offsetSeconds })) continue
    const minuteMs = momentMinuteAt(startedMs, offsetSeconds)
    const momentAt = momentAtKey(minuteMs)
    if (seen.has(momentAt) || (stream.streamId === current.streamId && momentAt === current.momentAt)) continue
    seen.add(momentAt)
    rows.push({
      streamId: stream.streamId, momentAt, at: minuteMs, offsetSeconds, login: current.login,
      displayName: stream.displayName, category: stream.category, note: lookupDay(stream.startedAt, nowMs),
    })
  }
  return rows
}

/**
 * "More from {channel}": the top Moments of the channel's other streams, taken in turn (each stream's
 * best first, newest stream first), at most `max`. A stream without a usable recap adds nothing.
 */
export function channelMoreRows(current: MoreCurrent, streams: readonly ChannelStream[],
  recaps: ReadonlyMap<string, MomentRecapAnswer | null | undefined>, nowMs = Date.now(), max = MORE_ROWS_MAX): MoreRow[] {
  const lists = streams.filter(stream => stream.streamId !== current.streamId)
    .map(stream => recapRows(current, stream, recaps.get(stream.streamId), nowMs))
  const rows: MoreRow[] = []
  for (let turn = 0; rows.length < max && lists.some(list => turn < list.length); turn += 1) {
    for (const list of lists) {
      if (rows.length < max && turn < list.length) rows.push(list[turn]!)
    }
  }
  return rows
}

/**
 * The hub snapshot's Moments as the Moments list's Latest builds them (resolveLivePulseMoments, each
 * minute once, newest first), with the stream thumbnail the hub sends beside a Moment.
 */
export function hubMoreMoments(hub: PublicHub): DiscoveryMoment[] {
  const artwork = new Map((hub.livePulseMoments ?? []).flatMap(moment => {
    const adapted = fromHubMoment(moment)
    return adapted?.archiveArtwork ? [[adapted.key, adapted.archiveArtwork] as const] : []
  }))
  return uniqueDiscoveryMoments(resolveLivePulseMoments(hub).moments.flatMap(row => {
    const moment = fromHubMoment(row)
    return moment ? [{ ...moment, archiveArtwork: moment.archiveArtwork ?? artwork.get(moment.key) }] : []
  }))
}

/**
 * "More {game} Moments": other channels' Moments in the same game, from the Moments list's own rows
 * (hubMoreMoments, newest first): one per channel, at most `max`, never the Moment's own channel or stream.
 */
export function gameMoreRows(current: MoreCurrent, game: MomentGame, moments: readonly DiscoveryMoment[], max = MORE_ROWS_MAX): MoreRow[] {
  const channels = new Set<string>([current.login])
  const rows: MoreRow[] = []
  for (const moment of moments) {
    if (rows.length >= max) break
    const at = moment.at
    if (channels.has(moment.login) || moment.streamId === current.streamId || !isMomentStreamId(moment.streamId)
      || typeof at !== 'number' || !Number.isFinite(at) || !shownOnMomentsPage(moment) || !sameGame(game, moment)) continue
    channels.add(moment.login)
    const cover = momentGameArtUrl(moment, 285, 380)
    rows.push({
      streamId: moment.streamId, momentAt: momentEntryKey(at), at, offsetSeconds: moment.offsetSeconds, login: moment.login,
      displayName: text(moment.displayName, 100), category: text(moment.category, 200), profileImageUrl: text(moment.profileImageUrl, 500),
      note: text(moment.displayName, 100) ?? moment.login, artwork: moment.archiveArtwork,
      gameArt: cover ? { url: cover, gameName: text(moment.category, 200) ?? game.name } : undefined,
    })
  }
  return rows
}
