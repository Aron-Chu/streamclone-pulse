import type { AnalyticsStream } from '../apiTypes.ts'

export interface HistoryStreamItem {
  id?: string
  streamId?: string
  startedAt?: string
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
    const matches = pool.filter((s) => {
      if (!s.startedAt) return false
      const date = new Date(s.startedAt)
      if (Number.isNaN(date.getTime())) return false

      const utcDateStr = date.toISOString().slice(0, 10)
      return utcDateStr === streamIdParam
    })
    return matches.length === 1 ? matches[0] : undefined
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
      const matches = historyItems.filter((s) => {
        if (!s.startedAt) return false
        return new Date(s.startedAt).toISOString().slice(0, 10) === streamIdParam
      })
      const fromHistory = matches.length === 1 ? matches[0] : undefined
      const id = fromHistory?.streamId ?? fromHistory?.id
      if (id) return id
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
