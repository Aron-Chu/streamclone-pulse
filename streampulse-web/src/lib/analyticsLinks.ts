export type AnalyticsLinkContext = 'channel-row' | 'recent-session' | string

export interface AnalyticsHrefInput {
  login: string
  streamId?: string
  offsetSeconds?: number
  context?: AnalyticsLinkContext
}

export function buildAnalyticsHref({ login, streamId, offsetSeconds }: AnalyticsHrefInput): string {
  const safeChannel = encodeURIComponent(login.trim().toLowerCase())
  // Canonical channel-session route is /analytics/{channel}/{streamId}.
  // The /s/{streamId} form is a backcompat redirect alias only.
  const base = streamId
    ? `/analytics/${safeChannel}/${encodeURIComponent(streamId)}`
    : `/analytics/${safeChannel}`
  if (offsetSeconds != null && offsetSeconds > 0) {
    return `${base}#t=${Math.floor(offsetSeconds)}`
  }
  return base
}

export function analyticsActionLabel(context?: AnalyticsLinkContext): string {
  if (context === 'recent-session') return 'Open session'
  return 'Open analytics'
}