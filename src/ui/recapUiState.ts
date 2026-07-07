import type { ExtensionCoverageResponse } from '../shared/coverage.ts'
import type { PulsePayload, PulseStreamRecap } from '../shared/messages.ts'
import { lastStreamPeakStats } from './lastStreamSummary.ts'

export type RecapUiState = 'loading' | 'ready' | 'partial' | 'empty' | 'error'

export interface ResolveRecapUiStateInput {
  isLive: boolean
  tracking: boolean
  streamId?: string
  recap: PulseStreamRecap | null
  pollError?: string | null
  hadLiveSession?: boolean
  payload?: PulsePayload | null
  coverage?: ExtensionCoverageResponse | null
}

export function hasOfflineRecapData(
  payload: PulsePayload,
  coverage?: ExtensionCoverageResponse | null,
): boolean {
  const meta = coverage?.liveMetadata ?? null
  const peaks = lastStreamPeakStats(payload)
  const rollups = (payload.fullRollups?.length ?? 0) > 0 ? payload.fullRollups! : payload.rollups
  const totalMessages = rollups.reduce((sum, rollup) => sum + (rollup.chatCount ?? 0), 0)
  const peakViewers = payload.peakViewers ?? peaks?.peakViewers ?? meta?.viewerCount ?? 0
  const peakChat = peaks?.peakChatPerMin ?? 0
  const peakEmote = payload.peakEmotePerMin ?? peaks?.peakEmotePerMin ?? 0
  const topEmotes = (payload.topEmotes ?? []).filter(emote => emote.count > 0)
  const moments = payload.peaks?.length ?? 0
  const duration = payload.durationSeconds ?? 0

  return (
    peakViewers > 0
    || peakChat > 0
    || peakEmote > 0
    || totalMessages > 0
    || topEmotes.length > 0
    || moments > 0
    || duration > 0
    || Boolean(payload.category ?? meta?.category)
    || Boolean(meta?.title)
  )
}

function recapContentIsSparse(recap: PulseStreamRecap): boolean {
  const hasMoments = recap.topMoments.length > 0
  const hasStats = recap.totalMessages > 0 || recap.peakChatPerMin > 0
  const hasEmotes = recap.topEmotes.length > 0
  return !hasMoments && !hasStats && !hasEmotes
}

function recapEnrichmentIsPartial(recap: PulseStreamRecap): boolean {
  const status = recap.emoteEnrichmentStatus
  return status === 'partial' || status === 'missing'
}

/** Returns null when recap panel should not render (live stream). */
export function resolveRecapUiState(input: ResolveRecapUiStateInput): RecapUiState | null {
  if (input.isLive) return null

  const expectingRecap = Boolean(
    input.tracking && input.streamId && (input.hadLiveSession ?? input.tracking),
  )

  if (input.pollError && expectingRecap && !input.recap) {
    return 'error'
  }

  if (input.recap) {
    if (recapContentIsSparse(input.recap) || recapEnrichmentIsPartial(input.recap)) {
      return 'partial'
    }
    return 'ready'
  }

  if (expectingRecap) {
    return 'loading'
  }

  if (input.payload && hasOfflineRecapData(input.payload, input.coverage)) {
    return 'partial'
  }

  return 'empty'
}
