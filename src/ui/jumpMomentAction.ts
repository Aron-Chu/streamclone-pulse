export type JumpMomentAction =
  | { kind: 'seek-vod'; offsetSeconds: number }
  | { kind: 'open-vod-tab'; vodId: string; offsetSeconds: number }
  | { kind: 'seek-live-dvr'; offsetSeconds: number; liveCurrentOffset: number }
  | { kind: 'open-analytics'; offsetSeconds: number }
  | {
      kind: 'live-outside-buffer'
      offsetSeconds: number
      /** Exact verified VOD may be offered as a secondary action — never a silent redirect. */
      secondaryVodId?: string
    }

export function resolveJumpMomentAction(input: {
  context: { kind: string; vodId?: string | null }
  payloadVodId?: string | null
  /** Prefer effective-live; raw payload isLive alone is insufficient. */
  effectiveIsLive?: boolean
  payloadIsLive?: boolean
  liveCurrentOffset?: number
  offsetSeconds: number
}): JumpMomentAction {
  const {
    context,
    payloadVodId,
    effectiveIsLive,
    payloadIsLive,
    liveCurrentOffset,
    offsetSeconds,
  } = input

  if (context.kind === 'vod') {
    return { kind: 'seek-vod', offsetSeconds }
  }

  const vodId = (payloadVodId ?? context.vodId ?? undefined)?.trim() || undefined
  const isLive = effectiveIsLive ?? Boolean(payloadIsLive)

  // Live moment actions: try same-player DVR first even when a VOD ID is linked.
  if (isLive) {
    if (Number.isFinite(liveCurrentOffset)) {
      return {
        kind: 'seek-live-dvr',
        offsetSeconds,
        liveCurrentOffset: liveCurrentOffset as number,
      }
    }
    return {
      kind: 'live-outside-buffer',
      offsetSeconds,
      secondaryVodId: vodId,
    }
  }

  if (vodId) {
    return { kind: 'open-vod-tab', vodId, offsetSeconds }
  }

  return { kind: 'open-analytics', offsetSeconds }
}
