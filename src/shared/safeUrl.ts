import { isDevLoopbackHostname } from './devHosts.ts'

const TRUSTED_IMAGE_HOSTS = new Set([
  'cdn.7tv.app',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
  'cdn.streampulse.stream',
  'static-cdn.jtvnw.net',
  'clips-media-assets2.twitch.tv',
])

const TRUSTED_TWITCH_NAVIGATION_HOSTS = new Set([
  'twitch.tv',
  'www.twitch.tv',
  'clips.twitch.tv',
])

function parseHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.username || parsed.password) return null
    return parsed
  } catch {
    return null
  }
}

/** A local backend in development builds; store builds have none. */
function isLocalBackendOrigin(parsed: URL): boolean {
  return parsed.protocol === 'http:' && isDevLoopbackHostname(parsed.hostname)
}

/** Allow only known CDN images or the configured backend's own image/proxy paths. */
export function safeImageUrl(raw: string | undefined, backendUrl?: string): string | undefined {
  if (!raw) return undefined
  const parsed = parseHttpUrl(raw.trim())
  if (!parsed) return undefined

  if (parsed.protocol === 'https:' && !parsed.port && TRUSTED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return parsed.toString()
  }

  if (backendUrl) {
    const backend = parseHttpUrl(backendUrl.trim())
    if (backend && parsed.origin === backend.origin) {
      if (parsed.protocol === 'https:' || isLocalBackendOrigin(parsed)) return parsed.toString()
    }
  }

  return undefined
}

/** Allow links only to Twitch's public clip/video surfaces. */
export function safeTwitchNavigationUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const parsed = parseHttpUrl(raw.trim())
   if (!parsed || parsed.protocol !== 'https:' || parsed.port) return undefined
  if (!TRUSTED_TWITCH_NAVIGATION_HOSTS.has(parsed.hostname.toLowerCase())) return undefined
  return parsed.toString()
}
