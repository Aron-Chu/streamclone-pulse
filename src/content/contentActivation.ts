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
