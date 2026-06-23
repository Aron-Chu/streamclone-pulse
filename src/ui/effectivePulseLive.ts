import type { PulsePayload } from '../shared/messages.ts'
import type { TwitchPageContext } from '../content/twitch.ts'

/** Match Streamclone web: Twitch page live state gates Pulse UI, not only analytics DB. */
export function effectivePulseIsLive(
  payload: PulsePayload | null,
  pageIsLive: boolean,
  context: TwitchPageContext,
): boolean {
  if (context.kind === 'vod') return Boolean(payload?.isLive)
  if (payload?.isLive) return true
  return context.kind === 'channel' && pageIsLive
}

/** Overlay adapters expect isLive=true while Streamclone catches up to a new broadcast. */
export function pulsePayloadForDisplay(
  payload: PulsePayload,
  pageIsLive: boolean,
  context: TwitchPageContext,
): PulsePayload {
  if (effectivePulseIsLive(payload, pageIsLive, context) && !payload.isLive) {
    return { ...payload, isLive: true, recap: null }
  }
  return payload
}
