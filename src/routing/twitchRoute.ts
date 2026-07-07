import { parseTwitchPage, type TwitchPageContext } from '../content/twitch.ts'

export type PulseExtensionMode =
  | { kind: 'live-channel'; channelLogin: string }
  | { kind: 'offline-channel-recap'; channelLogin: string }
  | { kind: 'vod-replay'; vodId: string; channelLogin?: string }
  | { kind: 'missing-data'; reason: string }
  | { kind: 'error'; message: string }

export function parseTwitchPathname(pathname: string): TwitchPageContext {
  return parseTwitchPage(pathname.replace(/\/+$/, '') || '/')
}

/** Resolve extension mode from a Twitch URL (pathname + optional search). */
export function resolveTwitchRoute(url: string): PulseExtensionMode {
  let parsed: URL
  try {
    parsed = new URL(url, 'https://www.twitch.tv')
  } catch {
    return { kind: 'missing-data', reason: 'invalid_url' }
  }

  const context = parseTwitchPathname(parsed.pathname)
  if (context.kind === 'vod' && context.vodId) {
    return {
      kind: 'vod-replay',
      vodId: context.vodId,
      channelLogin: context.login ?? undefined,
    }
  }
  if (context.kind === 'channel' && context.login) {
    return { kind: 'live-channel', channelLogin: context.login }
  }
  return { kind: 'missing-data', reason: 'unsupported_route' }
}

export function routeSessionKey(mode: PulseExtensionMode): string | null {
  if (mode.kind === 'vod-replay') return `vod:${mode.vodId}`
  if (mode.kind === 'live-channel' || mode.kind === 'offline-channel-recap') {
    return mode.channelLogin
  }
  return null
}

export function isSameRouteSession(a: PulseExtensionMode, b: PulseExtensionMode): boolean {
  const keyA = routeSessionKey(a)
  const keyB = routeSessionKey(b)
  return keyA != null && keyA === keyB
}

/** Runtime mode from route + live/offline signals (recap only on offline channel pages). */
export function resolveRuntimeExtensionMode(input: {
  route: PulseExtensionMode
  pageIsLive: boolean
  hasRecap: boolean
}): PulseExtensionMode {
  if (input.route.kind === 'vod-replay') return input.route
  if (input.route.kind === 'live-channel') {
    if (!input.pageIsLive && input.hasRecap) {
      return { kind: 'offline-channel-recap', channelLogin: input.route.channelLogin }
    }
    return input.route
  }
  return input.route
}

export function contextFromRoute(route: PulseExtensionMode): TwitchPageContext {
  if (route.kind === 'vod-replay') {
    return {
      kind: 'vod',
      login: route.channelLogin ?? null,
      vodId: route.vodId,
    }
  }
  if (route.kind === 'live-channel' || route.kind === 'offline-channel-recap') {
    return { kind: 'channel', login: route.channelLogin, vodId: null }
  }
  return { kind: 'non-channel', login: null, vodId: null }
}

/**
 * Login for prefetch when the URL is a pure live channel watch page (`/{login}` only).
 * Excludes directory, VOD, sub-routes (clips, videos, …), and other reserved paths.
 */
export function prefetchChannelLoginFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url, 'https://www.twitch.tv')
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  if (host !== 'twitch.tv' && !host.endsWith('.twitch.tv')) {
    return null
  }

  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length !== 1) return null

  const route = resolveTwitchRoute(url)
  if (route.kind !== 'live-channel') return null
  return route.channelLogin
}
