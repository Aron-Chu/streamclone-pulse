import type { AnalyticsStream } from '../apiTypes.ts'
import { getLocalDateString } from './consoleFormat.ts'

export interface HistoryStreamItem {
  id?: string
  streamId?: string
  startedAt?: string
}

function matchesDateSlug(startedAt: string | undefined, dateSlug: string): boolean {
  if (!startedAt) return false
  if (startedAt.slice(0, 10) === dateSlug) return true
  const date = new Date(startedAt)
  if (Number.isNaN(date.getTime())) return false
  return date.toISOString().slice(0, 10) === dateSlug || getLocalDateString(startedAt) === dateSlug
}

export function resolveMatchedStream(
  streamIdParam: string,
  combinedStreams: AnalyticsStream[],
  routableStreams?: AnalyticsStream[],
): AnalyticsStream | undefined {
  if (!streamIdParam) return undefined

  const exactMatch = combinedStreams.find((s) => s.streamId === streamIdParam)
  if (exactMatch) return exactMatch

  if (/^\d{4}-\d{2}-\d{2}$/.test(streamIdParam)) {
    const pool = routableStreams ?? combinedStreams
    const matches = new Map<string, AnalyticsStream>()
    for (const stream of pool) {
      if (matchesDateSlug(stream.startedAt, streamIdParam) && stream.streamId && !matches.has(stream.streamId)) {
        matches.set(stream.streamId, stream)
      }
    }
    return matches.size === 1 ? [...matches.values()][0] : undefined
  }

  return undefined
}

export function resolveTargetQueryStreamId(
  streamIdParam: string,
  matchedStream: AnalyticsStream | undefined,
  historyItems: HistoryStreamItem[] | undefined,
  listsLoading: boolean,
): string | undefined {
  if (!streamIdParam) return ''
  if (/^\d+$/.test(streamIdParam)) return streamIdParam
  if (matchedStream) return matchedStream.streamId

  if (/^\d{4}-\d{2}-\d{2}$/.test(streamIdParam)) {
    if (historyItems?.length) {
      const matchingIDs = new Set<string>()
      for (const item of historyItems) {
        if (!matchesDateSlug(item.startedAt, streamIdParam)) continue
        const id = item.streamId?.trim() || item.id?.trim()
        if (id) matchingIDs.add(id)
      }
      if (matchingIDs.size === 1) return [...matchingIDs][0]
    }
    if (listsLoading) return undefined
    return undefined
  }

  return undefined
}

export function isDateSlugUnresolved(
  streamIdParam: string,
  matchedStream: AnalyticsStream | undefined,
  listsLoading: boolean,
): boolean {
  if (!streamIdParam || !/^\d{4}-\d{2}-\d{2}$/.test(streamIdParam)) return false
  if (listsLoading) return false
  return !matchedStream
}

/** Prefer detail body streamId when hosted remaps a list/alias id to canonical. */
export function resolveCanonicalStreamId(
  detailStreamId: string | undefined | null,
  targetQueryStreamId: string,
): string {
  const trimmed = detailStreamId?.trim()
  return trimmed || targetQueryStreamId
}

/** Accept recap for either the requested alias id or the hosted canonical id. */
export function recapMatchesStreamIds(
  recapStreamId: string | undefined | null,
  targetQueryStreamId: string,
  canonicalStreamId: string,
): boolean {
  const id = recapStreamId?.trim()
  if (!id) return false
  return (
    (Boolean(targetQueryStreamId) && id === targetQueryStreamId)
    || (Boolean(canonicalStreamId) && id === canonicalStreamId)
  )
}
