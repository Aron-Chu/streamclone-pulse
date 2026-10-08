/**
 * StreamPulse Discord entry points.
 *
 * The invite is a build-time activation input (`VITE_PUBLIC_DISCORD_INVITE_URL`),
 * never a literal in source: every Discord link on the site is hidden unless the
 * build was given a well-formed Discord invite. The extension never embeds an
 * invite either; it links to the site's /discord page, which reads the same value.
 */

/** Site route the extension's "Join Discord" opens. */
export const DISCORD_PATH = '/discord'

const INVITE_CODE = /^[A-Za-z0-9-]{2,64}$/

/**
 * The canonical invite URL when `raw` is exactly an https Discord invite
 * (the short `discord.gg` host with one code segment, or `discord.com` with an
 * `invite` segment and a code); otherwise null. Anything else — another host,
 * http, a port, credentials, a query, a fragment, extra path segments — is
 * rejected rather than repaired, so a typo hides the links instead of
 * publishing a wrong destination.
 */
export function parseDiscordInviteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || /\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null
  if (value.includes('?') || value.includes('#')) return null
  const segments = url.pathname.split('/').slice(1)
  let code: string | undefined
  if (url.hostname === 'discord.gg' && segments.length === 1) code = segments[0]
  else if (url.hostname === 'discord.com' && segments.length === 2 && segments[0] === 'invite') code = segments[1]
  if (!code || !INVITE_CODE.test(code)) return null
  return url.href
}

/** The configured invite for this build, or null when Discord entry points must stay hidden. */
export function discordInviteUrl(): string | null {
  return parseDiscordInviteUrl(import.meta.env.VITE_PUBLIC_DISCORD_INVITE_URL)
}
