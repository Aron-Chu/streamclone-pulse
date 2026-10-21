import tape from './demoTape.json'

/** The made-up channel the demo plays (scripts/generate-demo-tape.mjs). */
export const DEMO_CHANNEL = {
  login: tape.channelLogin,
  name: tape.channelDisplayName,
  vodId: tape.vodId,
  streamId: tape.streamId,
} as const

function parse(raw: string): URL | null {
  try {
    return new URL(raw, typeof location === 'undefined' ? 'https://streampulse.stream' : location.href)
  } catch {
    return null
  }
}

function isTwitchHost(host: string): boolean {
  return host === 'twitch.tv' || host.endsWith('.twitch.tv')
}

/**
 * True for a link the panel opens that would leave for Twitch, or for a page
 * about the demo's made-up stream. Neither exists, so the demo stays put.
 * Other links (the site's own pages, the store listing) open as usual.
 */
export function isDemoExitUrl(raw: string): boolean {
  const url = parse(raw)
  if (!url) return false
  if (isTwitchHost(url.hostname)) return true
  const text = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`)
  return [DEMO_CHANNEL.login, DEMO_CHANNEL.vodId, DEMO_CHANNEL.streamId].some(id => Boolean(id) && text.includes(id))
}

const PORTAL_HOSTS = new Set(['streampulse.stream', 'www.streampulse.stream'])

/**
 * The panel links to the hosted site (https://streampulse.stream/...). On the
 * site, open the same page on the origin the visitor is on, so a local or
 * preview build keeps its links local. Other links are returned unchanged.
 */
export function toSiteUrl(raw: string): string {
  const url = parse(raw)
  if (!url || !PORTAL_HOSTS.has(url.hostname) || typeof location === 'undefined') return raw
  return `${location.origin}${url.pathname}${url.search}${url.hash}`
}

/** What the extension would have opened, said in one line. */
export function demoLeaveNote(raw: string): string {
  const url = parse(raw)
  if (url && isTwitchHost(url.hostname)) {
    return 'In the extension, this opens the stream on Twitch. The sample stream isn’t on Twitch, so the demo stays here.'
  }
  return 'In the extension, this opens the stream in StreamPulse Analytics. The sample stream isn’t there, so the demo stays here.'
}
