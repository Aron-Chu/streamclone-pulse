import { normalizeLogin } from '../shared/login.ts'
import type { BackgroundRequest } from '../shared/messages.ts'

/** True when a Twitch tab URL is for this channel (multi-tab same login still matches). */
export function isSupportedTwitchUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'twitch.tv' || host === 'www.twitch.tv'
  } catch {
    return false
  }
}

export interface RuntimeSenderLike {
  id?: string
  url?: string
  frameId?: number
  tab?: { url?: string }
}

function isExtensionPageUrl(url: string | undefined, extensionId: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'chrome-extension:') return parsed.hostname === extensionId
    return parsed.protocol === 'moz-extension:' && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

export function isExtensionPageSender(sender: RuntimeSenderLike, extensionId: string): boolean {
  if (!sender.id || sender.id !== extensionId || !isExtensionPageUrl(sender.url, extensionId)) return false
  // Firefox may include the options/popup tab on a runtime message. It is
  // still trusted only when that tab is also an extension-owned page.
  return !sender.tab || isExtensionPageUrl(sender.tab.url, extensionId)
}

export function isTrustedTwitchTopFrameSender(sender: RuntimeSenderLike, extensionId: string): boolean {
  return Boolean(sender.id === extensionId && sender.frameId === 0 && isSupportedTwitchUrl(sender.tab?.url))
}

/**
 * Which senders may invoke each message.
 *
 * - `extension-page`: options/popup only. Account, device and watchlist
 *   operations live here so a Twitch content script can never reach them.
 * - `twitch-channel`: extension pages, or a top-frame Twitch tab whose URL
 *   matches the requested login.
 * - `twitch-any`: extension pages, or any top-frame Twitch tab.
 *
 * Exhaustive Record, not a set with a permissive fallback. Adding a message
 * type without classifying it is a type error, not a silent grant to the
 * content script.
 */
export type MessageSenderScope = 'extension-page' | 'twitch-channel' | 'twitch-any'

export const MESSAGE_SENDER_SCOPE: Record<BackgroundRequest['type'], MessageSenderScope> = {
  SUPPORTER_ACCOUNT: 'extension-page',
  SUPPORTER_ENTITLEMENT: 'extension-page',
  SUPPORTER_COSMETICS: 'extension-page',
  SUPPORTER_APPEARANCE: 'twitch-any',
  ENROLL_DEVICE: 'extension-page',
  GET_DEVICE_AUTH_STATUS: 'extension-page',
  ROTATE_DEVICE: 'extension-page',
  REVOKE_DEVICE: 'extension-page',
  LIST_WATCHLIST: 'extension-page',
  ADD_WATCHLIST: 'extension-page',
  REMOVE_WATCHLIST: 'extension-page',
  SYNC_WATCHLIST: 'extension-page',
  DELETE_BOOKMARK: 'extension-page',
  GET_PULSE_DEBUG_LOG: 'extension-page',
  CLEAR_PULSE_DEBUG_LOG: 'extension-page',
  TRACK: 'twitch-channel',
  UNTRACK: 'twitch-channel',
  GET_PULSE: 'twitch-channel',
  GET_COVERAGE: 'twitch-channel',
  GET_ALWAYS_TRACKED: 'twitch-channel',
  GET_CLIP: 'twitch-channel',
  HINT_VOD: 'twitch-channel',
  DISCOVER_LIVE_VOD: 'twitch-channel',
  LOAD_MISSED_MOMENTS: 'twitch-channel',
  GET_PULSE_BACKFILL_STATUS: 'twitch-channel',
  LIST_PAST_VODS: 'twitch-channel',
  LIST_BOOKMARKS: 'twitch-channel',
  SAVE_BOOKMARK: 'twitch-channel',
  HEALTH: 'twitch-any',
  OPEN_OPTIONS: 'twitch-any',
  REPORT_EXTENSION_DIAGNOSTIC: 'twitch-any',
  EMIT_EXTENSION_ANALYTICS: 'twitch-any',
  SET_AUTO_UPDATE: 'twitch-any',
  FETCH_EMOTE_IMAGE: 'twitch-any',
  GET_PULSE_VOD: 'twitch-any',
  APPEND_PULSE_DEBUG: 'twitch-any',
}

/** Own entries only, so inherited object keys cannot resolve to a scope. */
const SCOPE_BY_MESSAGE_TYPE = new Map<string, MessageSenderScope>(Object.entries(MESSAGE_SENDER_SCOPE))

/**
 * Authorizes one runtime message by sender. `login` is required only for
 * `twitch-channel` messages; pass the message's own login.
 */
export function isSenderAuthorizedForMessage(
  messageType: string,
  login: string | undefined,
  sender: RuntimeSenderLike,
  extensionId: string,
): boolean {
  if (!sender.id || sender.id !== extensionId) return false
  // Own-property lookup only. Plain indexing would resolve `__proto__` and
  // `toString` to inherited values and authorize an unclassified type.
  const scope = SCOPE_BY_MESSAGE_TYPE.get(messageType)
  if (scope !== 'extension-page' && scope !== 'twitch-channel' && scope !== 'twitch-any') return false
  if (scope === 'extension-page') return isExtensionPageSender(sender, extensionId)
  if (isExtensionPageSender(sender, extensionId)) return true
  if (!isTrustedTwitchTopFrameSender(sender, extensionId)) return false
  if (scope === 'twitch-any') return true
  return Boolean(login && tabUrlMatchesPulseLogin(sender.tab?.url, login))
}

export function tabUrlMatchesPulseLogin(url: string | undefined, login: string): boolean {
  const normalizedLogin = normalizeLogin(login)
  if (!isSupportedTwitchUrl(url) || !url || !normalizedLogin) return false
  try {
    const { pathname } = new URL(url)
    const path = pathname.toLowerCase()
    const needle = `/${normalizedLogin}`
    return path === needle || path.startsWith(`${needle}/`)
  } catch {
    return false
  }
}
