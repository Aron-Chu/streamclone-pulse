import type { HubActivityMomentMarker } from '../ui/components/hub/HubActivityChart'

export type HubChartAnnotationKind = 'spike' | 'moment'

export interface HubChartAnnotation {
  key: string
  bucketT: number
  at?: number
  kind: HubChartAnnotationKind
  channelName: string
  channelDisplayName?: string
  emoteName?: string
  emoteUrl?: string
  channelLabel?: string
  metrics?: { viewers?: number; chatPerMin?: number; emotesPerMin?: number }
  source: 'network' | 'fallback'
  xPercent?: number
  opacity?: number
  labelOmitted?: boolean
  /** Original marker kind (e.g. 'emote_spike') — used for the selection-kind hint. */
  rawKind?: string
}

const SPIKE_KINDS = new Set(['chat_spike', 'emote_spike', 'viewer_spike'])

export function classifyMomentMarker(marker: HubActivityMomentMarker | { kind?: string }): HubChartAnnotationKind {
  const kind = (marker.kind ?? '').trim().toLowerCase()
  return SPIKE_KINDS.has(kind) ? 'spike' : 'moment'
}

/** Single-pass left-to-right collision pass. Losers get opacity 0.4 and labelOmitted true. */
export function resolveAnnotationCollisions(
  annotations: HubChartAnnotation[],
  opts: { minSpacingPx: number },
): HubChartAnnotation[] {
  if (annotations.length < 2) return annotations
  const out = annotations.map((a) => ({ ...a }))
  let lastKeptX = -Infinity
  for (let i = 0; i < out.length; i += 1) {
    const x = out[i].xPercent ?? i * 100 // fallback spacing assumption
    if (i === 0) {
      lastKeptX = x
      continue
    }
    if (x - lastKeptX < opts.minSpacingPx) {
      out[i].opacity = 0.4
      out[i].labelOmitted = true
    } else {
      lastKeptX = x
    }
  }
  return out
}