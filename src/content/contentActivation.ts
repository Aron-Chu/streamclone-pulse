import type { TwitchPageContext } from './twitch.ts'

export function shouldActivateOverlay(context: TwitchPageContext): boolean {
  if (context.kind === 'vod' && context.vodId) return true
  if (context.kind === 'channel' && context.login) return true
  return false
}

export function overlaySessionKey(context: TwitchPageContext): string | null {
  if (context.kind === 'vod' && context.vodId) return `vod:${context.vodId}`
  if (context.kind === 'channel' && context.login) return context.login
  return null
}

export function placeholderLoginForContext(context: TwitchPageContext): string {
  if (context.kind === 'channel' && context.login) return context.login
  if (context.kind === 'vod' && context.vodId) {
    return context.login ?? `__vod__:${context.vodId}`
  }
  return ''
}

/** Sync login for first VOD overlay paint — never wait on session storage. */
export function resolveVodActivationLogin(input: {
  contextLogin: string | null
  scrapedLogin: string | null
  vodId: string
}): string {
  const contextLogin = input.contextLogin?.trim().toLowerCase() || null
  if (contextLogin && !contextLogin.startsWith('__vod__:')) return contextLogin
  // A first-match DOM scrape can be SPA chrome, a sidebar, or a recommendation.
  // It is not proof of this VOD's owner, so keep the VOD placeholder.
  return placeholderLoginForContext({ kind: 'vod', login: null, vodId: input.vodId })
}
