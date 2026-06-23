import {
  deriveLiveHeat,
  extensionSupportsPeaks,
  momentScoreReasonLabel,
  peaksToLiveHeatPoints,
  toLiveHeatInputFromExtension,
  LIVE_HEAT_SUBTITLE,
  type LiveHeatPoint,
  type LiveHeatResult,
} from '@streamclone/pulse-core'
import type { ExtensionEmote, ExtensionPeak, PulsePayload } from '../shared/messages.ts'

export function peakReasonLabel(peak: ExtensionPeak): string {
  if (peak.reasonLabel?.trim()) return peak.reasonLabel.trim()
  return momentScoreReasonLabel(peak.reasons[0] ?? '')
}

export function peakChatCount(peak: ExtensionPeak): number {
  return peak.chatCount ?? 0
}

export function peakEmoteCount(peak: ExtensionPeak): number {
  return peak.emoteCount ?? 0
}

export function peakEmoteKey(emote: ExtensionEmote, index: number): string {
  return emote.id ?? `${emote.name}-${emote.provider ?? 'unknown'}-${index}`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function selectedMomentKey(
  streamId: string | undefined,
  point: LiveHeatPoint,
): string {
  return `${streamId ?? 'unknown'}:${point.offsetSeconds}:${point.reason}`
}

function completedRollupCount(payload: PulsePayload): number {
  const input = toLiveHeatInputFromExtension(payload)
  return input.rollups.filter(
    r =>
      !r.missing
      && ((r.chatCount ?? 0) > 0 || (r.totalEmoteCount ?? 0) > 0 || (r.viewerSamples ?? 0) > 0),
  ).length
}

/** Prefer backend peaks; fall back to deriveLiveHeat only when peaks field is absent. */
export function resolveMostReactedHeat(payload: PulsePayload): LiveHeatResult {
  if (extensionSupportsPeaks(payload)) {
    if ((payload.peaks?.length ?? 0) === 0) {
      return {
        visible: false,
        completedRollupCount: completedRollupCount(payload),
        points: [],
        collectingPoint: null,
        subtitle: LIVE_HEAT_SUBTITLE,
      }
    }
    const points = peaksToLiveHeatPoints(payload.peaks ?? [], payload.startedAt, payload.topEmotes)
    return {
      visible: points.length > 0,
      completedRollupCount: completedRollupCount(payload),
      points,
      collectingPoint: null,
      subtitle: LIVE_HEAT_SUBTITLE,
    }
  }
  return deriveLiveHeat(toLiveHeatInputFromExtension(payload))
}

export function resolveSelectedMomentKey(
  streamId: string | undefined,
  points: LiveHeatPoint[],
  priorKey: string | null,
): string | null {
  if (points.length === 0 || !priorKey) return null
  if (points.some(point => selectedMomentKey(streamId, point) === priorKey)) {
    return priorKey
  }
  return null
}
