import { accountRequest } from './accountApi'
import { twitchSignInEnabled } from './twitchSignInFlag'

/**
 * A streamer adds StreamPulse to their own Twitch channel (backend:
 * internal/accounts/channel_optin.go). Adding is a Twitch flow with purpose
 * "channel" (twitchSignIn.ts) that also asks for channel:bot; the API then reads
 * that channel's chat over EventSub. These are the status and remove calls.
 *
 * Build-time switch: off unless the build sets VITE_CHANNEL_OPTIN=1, and only
 * with Sign in with Twitch on. Local sandbox only so far (`sandbox.py site
 * --eventsub`); the API answers 404 without its EventSub lane.
 */
export function channelOptInEnabled(): boolean {
  return import.meta.env.VITE_CHANNEL_OPTIN === '1' && twitchSignInEnabled()
}

/** "revoked": Twitch took the permission back, so the channel isn't read any more. */
export type AccountChannel = { login: string; addedAt: string; status: 'active' | 'revoked' }

const LOGIN = /^[a-z0-9_]{1,25}$/

/** Mirrors the API's answer; anything malformed reads as no channel. */
export function accountChannel(value: unknown): AccountChannel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { login, addedAt, status } = value as Record<string, unknown>
  if (typeof login !== 'string' || !LOGIN.test(login) || typeof addedAt !== 'string' || !Number.isFinite(Date.parse(addedAt))
    || (status !== 'active' && status !== 'revoked')) return null
  return { login, addedAt, status }
}

/** The signed-in account's channel, or null when none was added. */
export async function readAccountChannel(): Promise<AccountChannel | null> {
  const result = await accountRequest('/channel')
  return accountChannel(result.channel)
}

/** Stops reading the channel. The Twitch permission stays until the streamer removes it on Twitch. */
export async function removeAccountChannel(): Promise<void> {
  const result = await accountRequest('/channel/remove', {})
  if (result.status !== 'channel_removed') throw new Error('Channel remove failed')
}
