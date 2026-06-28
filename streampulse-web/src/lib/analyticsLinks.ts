export type AnalyticsLinkContext = 'channel-row' | 'recent-session' | string

export interface AnalyticsHrefInput {
  login: string
  streamId?: string
  context?: AnalyticsLinkContext
}

export function buildAnalyticsHref({ login, streamId }: AnalyticsHrefInput): string {
  const safeLogin = encodeURIComponent(login.trim().toLowerCase())
  if (!streamId) return `/analytics/${safeLogin}`
  return `/analytics/${safeLogin}/streams/${encodeURIComponent(streamId)}`
}

export function analyticsActionLabel(context?: AnalyticsLinkContext): string {
  if (context === 'recent-session') return 'Open session'
  return 'Open analytics'
}