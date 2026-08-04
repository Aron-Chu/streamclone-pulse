import { normalizeLogin } from '../shared/login.ts'

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

export function isExtensionPageSender(sender: RuntimeSenderLike, extensionId: string): boolean {
  if (!sender.id || sender.id !== extensionId || sender.tab || !sender.url) return false
  try {
    const parsed = new URL(sender.url)
    return parsed.protocol === 'chrome-extension:' && parsed.hostname === extensionId
  } catch {
    return false
  }
}

export function isTrustedTwitchTopFrameSender(sender: RuntimeSenderLike, extensionId: string): boolean {
  return Boolean(sender.id === extensionId && sender.frameId === 0 && isSupportedTwitchUrl(sender.tab?.url))
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
