/** What a Jump did, said where it was pressed: under the card's buttons, or on the dock's second line (U). */
/** A note that is not ok (the Jump failed) offers Open Analytics after its text. */
export interface JumpNote { ok: boolean; text: string }
/** A Jump handler's answer: the note to show, or nothing (it opened Analytics, or another Jump is running). */
export type JumpResult = Promise<JumpNote | null> | void
export type JumpPromise = Promise<JumpNote | null> | undefined

export type JumpMomentAction =
  | { kind: 'seek-vod'; offsetSeconds: number }
  | { kind: 'open-vod-tab'; vodId: string; offsetSeconds: number }
  | { kind: 'seek-live-dvr'; offsetSeconds: number; liveCurrentOffset: number }
  | { kind: 'open-analytics'; offsetSeconds: number }
  | { kind: 'live-outside-buffer'; offsetSeconds: number }

export function resolveJumpMomentAction(input: {
  context: { kind: string; vodId?: string | null }
  payloadVodId?: string | null
  /** Prefer effective-live; raw payload isLive alone is insufficient. */
  effectiveIsLive?: boolean
  payloadIsLive?: boolean
  /** Backend mode overrides the Twitch URL shape once resolution completes. */
  payloadMode?: 'live_dvr' | 'vod'
  /** Stream-origin to VOD-origin delta supplied by exact backend validation. */
  vodOriginDeltaSeconds?: number
  liveCurrentOffset?: number
  offsetSeconds: number
}): JumpMomentAction {
  const {
    context,
    payloadVodId,
    effectiveIsLive,
    payloadIsLive,
    payloadMode,
    vodOriginDeltaSeconds,
    liveCurrentOffset,
    offsetSeconds,
  } = input

  const vodId = payloadVodId?.trim() || undefined
  const vodOffset = Math.max(
    0,
    offsetSeconds - (Number.isFinite(vodOriginDeltaSeconds) ? (vodOriginDeltaSeconds as number) : 0),
  )

  // A validated VOD route owns the playback surface, including while its
  // analytics response is still marked live_dvr because the archive is growing.
  if (context.kind === 'vod' && vodId && context.vodId === vodId) {
    return { kind: 'seek-vod', offsetSeconds: vodOffset }
  }

  const isLive = payloadMode === 'live_dvr' || (effectiveIsLive ?? Boolean(payloadIsLive))

  // On a channel, an exact VOD is the correct playback surface. The live_dvr
  // mode describes the analytics source, not the Twitch player URL.
  if (context.kind === 'channel' && vodId) {
    return { kind: 'open-vod-tab', vodId, offsetSeconds: vodOffset }
  }

  if (isLive) {
    // A canonical VOD route without an exact validated VOD must not seek an
    // arbitrary player as though it were the live channel DVR.
    if (context.kind !== 'channel') return { kind: 'open-analytics', offsetSeconds }
    if (Number.isFinite(liveCurrentOffset)) {
      return {
        kind: 'seek-live-dvr',
        offsetSeconds,
        liveCurrentOffset: liveCurrentOffset as number,
      }
    }
    // On a channel a linked VOD already opened its own tab above, so no VOD is left to offer.
    return { kind: 'live-outside-buffer', offsetSeconds }
  }

  if (vodId) {
    return { kind: 'open-vod-tab', vodId, offsetSeconds: vodOffset }
  }

  return { kind: 'open-analytics', offsetSeconds }
}
