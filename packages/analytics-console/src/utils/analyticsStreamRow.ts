import type { AnalyticsStream } from '../api.ts'
import type { AnalyticsMinuteRollup, AnalyticsStreamDetail } from '../apiTypes.ts'

export function isPlaceholderStreamTitle(title?: string) {
  const trimmed = title?.trim() ?? ''
  return (
    trimmed === ''
    || trimmed === 'Syncing...'
    || trimmed === 'Syncing…'
    || trimmed.toLowerCase() === 'live'
  )
}

/** Legacy prefetch stub — API now dedupes server-side; keep for older rows during rollout. */
export function isSyncPrefetchPlaceholder(stream?: AnalyticsStream) {
  if (!stream) return false
  if (stream.canonicalStreamId && stream.canonicalStreamId !== stream.streamId) {
    return true
  }
  if (stream.endedAt) return false
  if ((stream.viewerSamples ?? 0) > 0 || (stream.chatMessages ?? 0) > 0) return false
  if (stream.broadcasterId === 'pending') return true
  return isPlaceholderStreamTitle(stream?.title)
}

export function isActiveLiveCollectorStream(stream?: AnalyticsStream, state?: string) {
  if (stream?.lifecycleState) return stream.lifecycleState === 'confirmed_live' && !isSyncPrefetchPlaceholder(stream)
  return state === 'live' && !isSyncPrefetchPlaceholder(stream)
}

const staleOpenStreamAgeMs = 48 * 60 * 60 * 1000

function rollupHasActivity(rollup: AnalyticsMinuteRollup): boolean {
  return (rollup.chatCount ?? 0) > 0
    || (rollup.totalEmoteCount ?? 0) > 0
    || (rollup.seventvEmoteCount ?? 0) > 0
    || (rollup.viewerAvg ?? 0) > 0
    || (rollup.viewerMax ?? 0) > 0
    || (rollup.viewerLatest ?? 0) > 0
    || (rollup.viewerSamples ?? 0) > 0
}

/**
 * (fix, 10-30) GP-3: a newer stream for the same channel in its streams list,
 * which means this one is over whatever its row says (Twitch runs one live
 * broadcast per channel; the backend left 316705728883 open with the
 * channel's current viewers). Placeholders and rows standing in for this
 * stream (canonicalStreamId) do not count. Undefined when none is listed.
 */
export function newerChannelStream(
  stream: Pick<AnalyticsStream, 'streamId' | 'login' | 'startedAt'> | null | undefined,
  channelStreams: readonly AnalyticsStream[] | null | undefined,
): AnalyticsStream | undefined {
  if (!stream?.streamId || !channelStreams?.length) return undefined
  const startedMs = stream.startedAt ? Date.parse(stream.startedAt) : Number.NaN
  if (!Number.isFinite(startedMs)) return undefined
  const login = stream.login?.trim().toLowerCase()
  return channelStreams.find((row) => {
    if (!row.streamId || row.streamId === stream.streamId || row.canonicalStreamId === stream.streamId) return false
    if (login && row.login && row.login.trim().toLowerCase() !== login) return false
    if (isSyncPrefetchPlaceholder(row)) return false
    const rowStartedMs = row.startedAt ? Date.parse(row.startedAt) : Number.NaN
    return Number.isFinite(rowStartedMs) && rowStartedMs > startedMs
  })
}

/**
 * True when the channel detail reflects an actively tracked live collector session.
 * (fix, 10-30) Pass the channel's streams list when known: a stream with a
 * newer one listed for its channel is not live.
 */
export function resolveChannelActuallyLive(
  detail?: AnalyticsStreamDetail | null,
  channelStreams?: readonly AnalyticsStream[] | null,
): boolean {
  if (!detail) return false
  if (newerChannelStream(detail.stream, channelStreams)) return false
  if (detail.stream?.lifecycleState) return detail.stream.lifecycleState === 'confirmed_live'
  if (detail.state !== 'live') return false
  // (fix, 10-30) The 48 h guard runs before the viewer and activity shortcuts:
  // a never-closed row keeps the channel's current viewers, so viewers alone
  // made a days-old stream live.
  const startedAt = detail.stream?.startedAt
  if (startedAt) {
    const startedMs = Date.parse(startedAt)
    if (Number.isFinite(startedMs) && Date.now() - startedMs > staleOpenStreamAgeMs) {
      return false
    }
  }
  if ((detail.stream?.currentViewers ?? 0) > 0) return true
  if ((detail.rollups ?? []).some(rollupHasActivity)) return true
  return isActiveLiveCollectorStream(detail.stream, detail.state)
}
