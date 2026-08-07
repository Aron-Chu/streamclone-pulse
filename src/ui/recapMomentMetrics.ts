import {
  momentScoreReasonLabel,
  type LiveHeatPoint,
  type LiveHeatReason,
} from '@streampulse/pulse-core'
import type { ExtensionEmote, ExtensionPeak, ExtensionRollup, PulseRecapMoment } from '../shared/messages.ts'
import { resolveRecapEmotes } from './recapEmotes.ts'

export function rollupEmoteCount(rollup: ExtensionRollup | null | undefined): number {
  if (!rollup) return 0
  if (rollup.totalEmoteCount != null && rollup.totalEmoteCount > 0) {
    return rollup.totalEmoteCount
  }
  return Math.max(0, rollup.sevenTvEmoteCount ?? 0)
}

export function pickRecapRollups(payload: {
  fullRollups?: ExtensionRollup[]
  rollups: ExtensionRollup[]
}): ExtensionRollup[] {
  if ((payload.fullRollups?.length ?? 0) > 0) return payload.fullRollups!
  return payload.rollups
}

export function rollupAtOffset(
  rollups: ExtensionRollup[],
  offsetSeconds: number,
): ExtensionRollup | null {
  if (rollups.length === 0) return null
  const exact = rollups.find(rollup => rollup.offsetSeconds === offsetSeconds)
  if (exact && !exact.missing) return exact

  let nearest: ExtensionRollup | null = null
  let bestDistance = Infinity
  for (const rollup of rollups) {
    if (rollup.missing) continue
    const distance = Math.abs(rollup.offsetSeconds - offsetSeconds)
    if (distance <= 60 && distance < bestDistance) {
      bestDistance = distance
      nearest = rollup
    }
  }
  return nearest
}

export function viewerDeltaAtOffset(
  rollups: ExtensionRollup[],
  offsetSeconds: number,
): number | undefined {
  const current = rollupAtOffset(rollups, offsetSeconds)
  const currentViewers = current?.viewerCount ?? 0
  if (currentViewers <= 0) return undefined

  let priorViewers = 0
  let bestPriorOffset = Number.NEGATIVE_INFINITY
  for (const rollup of rollups) {
    if (rollup.missing) continue
    const viewers = rollup.viewerCount ?? 0
    if (viewers <= 0) continue
    const deltaOffset = offsetSeconds - rollup.offsetSeconds
    if (deltaOffset <= 0 || deltaOffset > 120) continue
    if (rollup.offsetSeconds > bestPriorOffset) {
      bestPriorOffset = rollup.offsetSeconds
      priorViewers = viewers
    }
  }
  if (!Number.isFinite(bestPriorOffset)) return undefined
  return currentViewers - priorViewers
}

export function peakAtOffset(
  peaks: ExtensionPeak[] | undefined,
  offsetSeconds: number,
): ExtensionPeak | null {
  if (!peaks?.length) return null
  const exact = peaks.find(peak => peak.offsetSeconds === offsetSeconds)
  if (exact) return exact

  let nearest: ExtensionPeak | null = null
  let bestDistance = Infinity
  for (const peak of peaks) {
    const distance = Math.abs(peak.offsetSeconds - offsetSeconds)
    if (distance <= 60 && distance < bestDistance) {
      bestDistance = distance
      nearest = peak
    }
  }
  return nearest
}

export interface RecapMomentMetrics {
  chatCount: number
  emoteCount: number
  viewerCount: number
}

export function resolveRecapMomentMetrics(
  moment: PulseRecapMoment,
  rollups: ExtensionRollup[],
  peaks?: ExtensionPeak[],
): RecapMomentMetrics {
  const peak = peakAtOffset(peaks, moment.offsetSeconds)
  const rollup = rollupAtOffset(rollups, moment.offsetSeconds)
  return {
    chatCount: Math.max(
      0,
      moment.chatCount ?? 0,
      peak?.chatCount ?? 0,
      rollup?.chatCount ?? 0,
    ),
    emoteCount: Math.max(
      0,
      moment.emoteCount ?? 0,
      peak?.emoteCount ?? 0,
      rollupEmoteCount(rollup),
    ),
    viewerCount: Math.max(0, moment.viewerCount ?? 0, rollup?.viewerCount ?? 0),
  }
}

function recapReasonToLiveHeatReason(reason: string | undefined): LiveHeatReason {
  const normalized = (reason ?? '').trim().toLowerCase()
  const allowed: LiveHeatReason[] = [
    'chat_spike',
    'emote_spike',
    'seventv_spike',
    'twitch_emote_spike',
    'ffz_spike',
    'viewer_spike',
    'manual',
  ]
  if (allowed.includes(normalized as LiveHeatReason)) {
    return normalized as LiveHeatReason
  }
  return 'manual'
}

export function recapMomentToLiveHeatPoint(
  moment: PulseRecapMoment,
  catalog: ExtensionEmote[],
  startedAt?: string,
  rollups: ExtensionRollup[] = [],
  peaks?: ExtensionPeak[],
): LiveHeatPoint {
  const reasonCode = moment.reasons[0] ?? 'manual'
  const peak = peakAtOffset(peaks, moment.offsetSeconds)
  const rollup = rollupAtOffset(rollups, moment.offsetSeconds)
  let resolvedEmotes = resolveRecapEmotes(moment.topEmotes ?? [], catalog)
  if (resolvedEmotes.length === 0) {
    const fallbackEmotes = peak?.topEmotes ?? rollup?.topEmotes ?? []
    resolvedEmotes = fallbackEmotes.filter(emote => emote.name).slice(0, 3)
  }
  const metrics = resolveRecapMomentMetrics(moment, rollups, peaks)
  const viewerDelta = viewerDeltaAtOffset(rollups, moment.offsetSeconds)
  const minuteTs = startedAt
    ? new Date(Date.parse(startedAt) + moment.offsetSeconds * 1000).toISOString()
    : ''
  return {
    minuteTs: Number.isFinite(Date.parse(minuteTs)) ? minuteTs : '',
    offsetSeconds: Math.max(0, moment.offsetSeconds),
    score: Math.round(moment.score),
    estimated: false,
    reason: recapReasonToLiveHeatReason(reasonCode),
    reasonLabel: momentScoreReasonLabel(reasonCode),
    chatCount: metrics.chatCount,
    emoteCount: metrics.emoteCount,
    topEmotes: resolvedEmotes.map((emote, index) => ({
      key: emote.id ?? `${emote.name}-${emote.provider ?? 'unknown'}-${index}`,
      name: emote.name,
      id: emote.id,
      providerEmoteId: emote.providerEmoteId,
      provider: emote.provider,
      imageUrl: emote.imageUrl,
      count: emote.count,
      zeroWidth: emote.zeroWidth,
      animated: emote.animated,
    })),
    collecting: false,
    viewerCount: metrics.viewerCount,
    viewerDelta,
  }
}
