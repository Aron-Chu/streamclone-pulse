/**
 * True for the Twitch web hosts Pulse runs on.
 *
 * Lives in shared code so the content script can import it without pulling in
 * the worker's sender-authorization table.
 */
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
