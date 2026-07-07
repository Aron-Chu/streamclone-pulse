import type { PulsePayload } from '../shared/messages.ts'
import type { TwitchPageContext } from '../content/twitch.ts'

/** Match Streamclone web: Twitch page live state gates Pulse UI badge; charts require collector. */
export function effectivePulseIsLive(
  payload: PulsePayload | null,
  pageIsLive: boolean,
  context: TwitchPageContext,
): boolean {
  if (payload?.recap && !payload.isLive) return false
  if (context.kind === 'vod') return Boolean(payload?.isLive)
  if (context.kind === 'channel' && pageIsLive) return true
  return Boolean(payload?.isLive && payload?.tracking)
}

/** Overlay adapters expect isLive=true while Streamclone catches up to a new broadcast (tracked only). */
export function pulsePayloadForDisplay(
  payload: PulsePayload,
  pageIsLive: boolean,
  context: TwitchPageContext,
): PulsePayload {
  const hasFinishedRecap = Boolean(payload.recap && !payload.isLive)
  if (hasFinishedRecap) return payload
  if (payload.tracking && effectivePulseIsLive(payload, pageIsLive, context) && !payload.isLive) {
    return { ...payload, isLive: true, recap: null }
  }
  return payload
}
