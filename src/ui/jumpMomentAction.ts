import type { TwitchPageContext } from '../content/twitch.ts'

export type JumpMomentAction =
  | { kind: 'seek-vod'; offsetSeconds: number }
  | { kind: 'open-vod-tab'; vodId: string; offsetSeconds: number }
  | { kind: 'seek-live-dvr'; offsetSeconds: number; liveCurrentOffset: number }
  | { kind: 'open-analytics'; offsetSeconds: number }
  | { kind: 'live-outside-buffer'; offsetSeconds: number }

export function resolveJumpMomentAction(input: {
  context: TwitchPageContext
  payloadVodId?: string | null
  payloadIsLive?: boolean
  liveCurrentOffset?: number
  offsetSeconds: number
}): JumpMomentAction {
  const { context, payloadVodId, payloadIsLive, liveCurrentOffset, offsetSeconds } = input

  if (context.kind === 'vod') {
    return { kind: 'seek-vod', offsetSeconds }
  }

  const vodId = payloadVodId ?? context.vodId ?? undefined
  if (vodId) {
    return { kind: 'open-vod-tab', vodId, offsetSeconds }
  }

  if (!payloadIsLive) {
    return { kind: 'open-analytics', offsetSeconds }
  }

  if (Number.isFinite(liveCurrentOffset)) {
    return {
      kind: 'seek-live-dvr',
      offsetSeconds,
      liveCurrentOffset: liveCurrentOffset as number,
    }
  }

  return { kind: 'live-outside-buffer', offsetSeconds }
}
